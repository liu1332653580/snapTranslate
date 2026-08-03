//! Tauri commands exposed to the frontend. Each `#[tauri::command]` becomes
//! `invoke('name', { args })` from TypeScript.
//!
//! Conventions:
//!   - Commands that can fail return `Result<T, Error>`; serialized errors reach JS as strings.
//!   - Heavy I/O happens here, not in the renderer — keeps the UI snappy.
//!   - Image bytes are passed as `data:` URLs across the boundary (simpler than ArrayBuffer
//!     in Tauri 2's IPC for our sizes — usually <2 MB).

use crate::{
    capture, error::{Error, Result}, shortcut, vlm::{self, Provider, RecognizeRequest, RecognizeResponse}
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;
use uuid::Uuid;

/// Shared state across commands. Mutex because Tauri state is `Send + Sync`.
/// Currently holds the in-progress capture so the overlay window and the
/// recognize command can coordinate without re-shuffling bytes through JS.
#[derive(Default)]
pub struct AppState {
    pub last_capture: Mutex<Option<PendingCapture>>,
}

#[derive(Clone)]
pub struct PendingCapture {
    pub id: String,
    /// Path to the full-screen PNG saved on disk. The overlay loads this via
    /// `convertFileSrc`; the recognize command reads it for cropping.
    pub image_path: PathBuf,
    pub width: u32,
    pub height: u32,
}

// ============================================================================
//  Capture flow
// ============================================================================

/// Step 1 — triggered by the global shortcut. Captures the primary monitor,
/// saves to a temp file, emits a `capture-ready` event to the overlay window,
/// and shows the overlay.
pub fn start_capture(app: &AppHandle) -> Result<()> {
    let cap = capture::capture_primary_monitor()?;
    let id = Uuid::new_v4().to_string();

    let temp_dir = app
        .path()
        .temp_dir()
        .map_err(|e| Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
    let image_path = temp_dir.join(format!("snapocr-{id}.png"));
    std::fs::write(&image_path, &cap.png)?;

    let pending = PendingCapture {
        id: id.clone(),
        image_path: image_path.clone(),
        width: cap.width,
        height: cap.height,
    };

    {
        let state: State<Arc<AppState>> = app.state();
        let mut guard = state.last_capture.lock().unwrap();
        *guard = Some(pending.clone());
    }

    // Show the overlay window fullscreen on the same monitor where the user is.
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay
            .set_fullscreen(true)
            .ok();
        overlay
            .show()
            .map_err(|e| Error::Other(anyhow::anyhow!("show overlay: {e}")))?;
        overlay
            .set_focus()
            .ok();

        // Emit after the window is visible — the renderer listens for this event
        // and renders the screenshot as the full-screen background.
        let data_url = png_to_data_url(&cap.png);
        let _ = overlay.emit(
            "capture-ready",
            CaptureReadyPayload {
                id: pending.id.clone(),
                data_url,
                width: pending.width,
                height: pending.height,
                image_path: image_path.to_string_lossy().to_string(),
            },
        );
    } else {
        return Err(Error::Config("overlay window not found".into()));
    }

    Ok(())
}

#[derive(Clone, Serialize)]
struct CaptureReadyPayload {
    id: String,
    data_url: String,
    width: u32,
    height: u32,
    image_path: String,
}

/// Step 2 (optional) — re-capture a specific monitor by index. Useful for multi-monitor users.
#[tauri::command]
pub async fn capture_full_screen(monitor_index: Option<usize>) -> Result<CaptureDto> {
    let cap = if let Some(idx) = monitor_index {
        capture::capture_by_index(idx)?
    } else {
        capture::capture_primary_monitor()?
    };
    Ok(CaptureDto {
        data_url: png_to_data_url(&cap.png),
        png_b64: base64::engine::general_purpose::STANDARD.encode(&cap.png),
        width: cap.width,
        height: cap.height,
    })
}

/// Re-capture a sub-region of the last full-screen capture. The frontend calls
/// this with the user's selection rectangle after they finish dragging.
#[tauri::command]
pub async fn capture_region(
    state: State<'_, Arc<AppState>>,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<CaptureDto> {
    let pending = {
        let guard = state.last_capture.lock().unwrap();
        guard
            .clone()
            .ok_or_else(|| Error::Config("no pending capture".into()))?
    };

    let png_bytes = std::fs::read(&pending.image_path)?;
    let cap = capture::crop_png(&png_bytes, x, y, width, height)?;
    Ok(CaptureDto {
        data_url: png_to_data_url(&cap.png),
        png_b64: base64::engine::general_purpose::STANDARD.encode(&cap.png),
        width: cap.width,
        height: cap.height,
    })
}

#[derive(Serialize)]
pub struct CaptureDto {
    /// data:image/png;base64,... — for renderer display.
    pub data_url: String,
    /// Raw base64 (no prefix) — for sending to VLM HTTP API directly.
    pub png_b64: String,
    pub width: u32,
    pub height: u32,
}

// ============================================================================
//  VLM recognition
// ============================================================================

#[tauri::command]
pub async fn recognize(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    req: RecognizeInput,
) -> Result<RecognizeResponse> {
    let png_bytes = if let Some(b64) = req.image_b64 {
        base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| Error::InvalidInput(format!("base64 decode: {e}")))?
    } else if let Some(region) = req.region {
        let pending = {
            let guard = state.last_capture.lock().unwrap();
            guard
                .clone()
                .ok_or_else(|| Error::Config("no pending capture".into()))?
        };
        let full = std::fs::read(&pending.image_path)?;
        capture::crop_png(&full, region.x, region.y, region.width, region.height)?.png
    } else {
        return Err(Error::InvalidInput(
            "recognize requires image_b64 or region".into(),
        ));
    };

    let provider: Provider = req.provider;
    let vlm_req = RecognizeRequest {
        provider: provider.clone(),
        model: req.model.unwrap_or_default(),
        image_png: png_bytes,
        prompt: req.prompt,
        thinking: req.thinking.unwrap_or(false),
        temperature: req.temperature.unwrap_or(0.1),
        max_tokens: req.max_tokens.unwrap_or(4096),
    };

    vlm::recognize(&app, vlm_req).await
}

#[derive(Deserialize)]
pub struct RecognizeInput {
    pub provider: Provider,
    pub model: Option<String>,
    /// Pre-encoded image (preferred path — frontend may have cropped via canvas).
    pub image_b64: Option<String>,
    /// OR a region on the last captured full screen (mutually exclusive with image_b64).
    pub region: Option<Region>,
    pub prompt: String,
    pub thinking: Option<bool>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

#[derive(Deserialize, Clone)]
pub struct Region {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

// ============================================================================
//  Persistence (SQL via tauri-plugin-sql — the frontend issues statements)
// ============================================================================

/// We expose raw SQL through the plugin (already allowed in capabilities).
/// For richer operations we provide typed wrappers. These are the few we need.

#[derive(Serialize, Deserialize, Clone)]
pub struct CaptureRow {
    pub id: String,
    pub created_at: String,
    pub image_path: Option<String>,
    pub image_width: Option<i64>,
    pub image_height: Option<i64>,
    pub model: String,
    pub thinking: bool,
    pub latency_ms: Option<i64>,
    pub tokens_input: Option<i64>,
    pub tokens_output: Option<i64>,
    pub cost_cny: Option<f64>,
    pub raw_text: String,
    pub edited_text: Option<String>,
    pub prompt_version: Option<String>,
    pub source: Option<String>,
    pub tags: Option<String>,
    pub is_starred: bool,
}

#[derive(Deserialize)]
pub struct SaveCaptureInput {
    pub image_b64: Option<String>,
    pub image_path: Option<String>,
    pub image_width: Option<i64>,
    pub image_height: Option<i64>,
    pub model: String,
    pub thinking: bool,
    pub latency_ms: Option<i64>,
    pub tokens_input: Option<i64>,
    pub tokens_output: Option<i64>,
    pub cost_cny: Option<f64>,
    pub raw_text: String,
    pub edited_text: Option<String>,
    pub prompt_version: Option<String>,
    pub source: Option<String>,
    pub tags: Option<Vec<String>>,
    pub is_starred: Option<bool>,
}

#[tauri::command]
pub async fn save_capture(app: AppHandle, input: SaveCaptureInput) -> Result<CaptureRow> {
    let id = Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();

    // Persist image to $APPDATA/captures/<id>.png if provided as b64.
    let mut final_path = input.image_path.clone();
    if let Some(b64) = input.image_b64.as_ref() {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| Error::InvalidInput(format!("base64 decode: {e}")))?;
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?
            .join("captures");
        std::fs::create_dir_all(&dir)?;
        let file_path = dir.join(format!("{id}.png"));
        std::fs::write(&file_path, bytes)?;
        final_path = Some(file_path.to_string_lossy().to_string());
    }

    let row = CaptureRow {
        id: id.clone(),
        created_at: created_at.clone(),
        image_path: final_path.clone(),
        image_width: input.image_width,
        image_height: input.image_height,
        model: input.model.clone(),
        thinking: input.thinking,
        latency_ms: input.latency_ms,
        tokens_input: input.tokens_input,
        tokens_output: input.tokens_output,
        cost_cny: input.cost_cny,
        raw_text: input.raw_text.clone(),
        edited_text: input.edited_text.clone(),
        prompt_version: input.prompt_version.clone(),
        source: input.source.clone(),
        tags: input
            .tags
            .map(|t| serde_json::to_string(&t).unwrap_or_default()),
        is_starred: input.is_starred.unwrap_or(false),
    };

    // Direct DB write — the plugin attached to the SQL connection is async, but
    // simpler to issue through the same pool. We do it via tauri-plugin-sql's
    // manager if available; otherwise we'd need rusqlite. Here we issue via the
    // plugin's Bridge through a manual statement execute command exposed by the
    // frontend. To keep Rust authoritative, we instead re-export a SQL helper.
    //
    // Implementation note: tauri-plugin-sql v2 doesn't expose a Rust-side pool
    // publicly, so we ask the frontend to run the INSERT. We emit an event with
    // the prepared row, and `db.ts` performs the actual SQL.
    app.emit("persist-capture", &row)?;

    Ok(row)
}

#[tauri::command]
pub async fn update_capture_text(
    _app: AppHandle,
    id: String,
    field: String,
    value: String,
) -> Result<()> {
    // Whitelist — never trust the frontend with arbitrary column names.
    let col = match field.as_str() {
        "edited_text" => "edited_text",
        "tags" => "tags",
        _ => return Err(Error::InvalidInput(format!("field '{field}' not updatable"))),
    };
    // The frontend's db.ts actually executes the UPDATE — this command exists
    // purely for validation. We emit a normalized event so listeners can refresh.
    _app.emit(
        "capture-update",
        serde_json::json!({ "id": id, "field": col, "value": value }),
    )?;
    Ok(())
}

#[tauri::command]
pub async fn toggle_star(app: AppHandle, id: String, starred: bool) -> Result<()> {
    app.emit(
        "capture-update",
        serde_json::json!({ "id": id, "field": "is_starred", "value": starred }),
    )?;
    Ok(())
}

#[tauri::command]
pub async fn list_captures(_app: AppHandle) -> Result<()> {
    // Frontend reads via plugin-sql directly — kept here for future server-side filtering.
    Ok(())
}

#[tauri::command]
pub async fn get_capture(_app: AppHandle, _id: String) -> Result<()> {
    Ok(())
}

#[tauri::command]
pub async fn delete_capture(app: AppHandle, id: String, hard: bool) -> Result<()> {
    app.emit(
        "capture-delete",
        serde_json::json!({ "id": id, "hard": hard }),
    )?;
    Ok(())
}

// ============================================================================
//  Image helpers
// ============================================================================

#[tauri::command]
pub async fn compute_image_data_url(image_path: String) -> Result<String> {
    let bytes = std::fs::read(&image_path)?;
    Ok(png_to_data_url(&bytes))
}

fn png_to_data_url(bytes: &[u8]) -> String {
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:image/png;base64,{b64}")
}

// ============================================================================
//  Window / tray
// ============================================================================

#[tauri::command]
pub async fn show_main_window(app: AppHandle) -> Result<()> {
    if let Some(w) = app.get_webview_window("main") {
        w.show().ok();
        w.set_focus().ok();
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_app(app: AppHandle) -> Result<()> {
    if let Some(w) = app.get_webview_window("main") {
        w.hide().ok();
    }
    if let Some(o) = app.get_webview_window("overlay") {
        o.hide().ok();
    }
    Ok(())
}

pub fn setup_tray(app: &tauri::AppHandle) -> Result<()> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::TrayIconBuilder,
    };

    let capture_item = MenuItem::with_id(app, "capture", "Capture (Ctrl+Shift+O)", true, None::<&str>)?;
    let show_item = MenuItem::with_id(app, "show", "Show main window", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&capture_item, &show_item, &quit_item])?;

    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("SnapOCR")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture" => {
                if let Err(e) = start_capture(app) {
                    tracing::error!("tray capture: {e:?}");
                }
            }
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

// ============================================================================
//  Shortcut management
// ============================================================================

#[tauri::command]
pub async fn set_shortcut(app: AppHandle, accel: String) -> Result<String> {
    shortcut::set_and_register(&app, &accel)?;
    Ok(accel)
}

#[tauri::command]
pub async fn get_active_shortcut(app: AppHandle) -> Result<String> {
    Ok(shortcut::read_configured(&app))
}

// ============================================================================
//  Suppress unused warnings for windows we reference dynamically
// ============================================================================

#[allow(dead_code)]
fn _unused(_: &WebviewWindow) {}
