//! Tauri commands exposed to the frontend - simplified version for CI testing.
//!
//! Core functionality: VLM recognition. Capture and database features temporarily disabled.

use crate::error::{Error, Result};
use crate::vlm::{self, Provider, RecognizeRequest, RecognizeResponse};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};
use tauri::{AppHandle, State};
use uuid::Uuid;

/// Shared state across commands.
#[derive(Default)]
pub struct AppState {
    pub last_capture: Mutex<Option<PendingCapture>>,
}

#[derive(Clone)]
pub struct PendingCapture {
    pub id: String,
    pub image_path: PathBuf,
    pub width: u32,
    pub height: u32,
}

// ============================================================================
//  Recognition (core functionality)
// ============================================================================

#[tauri::command]
pub async fn recognize(
    app: AppHandle,
    mut req: RecognizeInput,
) -> Result<RecognizeResponse> {
    let png_bytes = if let Some(b64) = req.image_b64 {
        base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| Error::InvalidInput(format!("base64 decode: {e}")))?
    } else {
        return Err(Error::InvalidInput(
            "image_b64 is required for now (capture disabled in CI)".into(),
        ));
    };

    let provider: Provider = req.provider;
    let vlm_req = RecognizeRequest {
        provider: provider.clone(),
        model: req.model.unwrap_or_else(|| {
            if matches!(provider, Provider::Glm) {
                "glm-4.6v-flash".to_string()
            } else if matches!(provider, Provider::Openai) {
                "gpt-4o".to_string()
            } else {
                "gemini-2.0-flash".to_string()
            }
        }),
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
    pub image_b64: Option<String>,
    pub prompt: String,
    pub thinking: Option<bool>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
}

// ============================================================================
//  Placeholder commands (disabled for CI)
// ============================================================================

#[tauri::command]
pub async fn capture_region(_x: u32, _y: u32, _width: u32, _height: u32) -> Result<CaptureDto> {
    Err(Error::Other(anyhow::anyhow!("capture disabled in CI testing mode")))
}

#[tauri::command]
pub async fn capture_full_screen(_monitor_index: Option<usize>) -> Result<CaptureDto> {
    Err(Error::Other(anyhow::anyhow!("capture disabled in CI testing mode")))
}

#[derive(Serialize)]
pub struct CaptureDto {
    pub data_url: String,
    pub png_b64: String,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub async fn save_capture(_input: SaveCaptureInput) -> Result<CaptureRow> {
    Err(Error::Other(anyhow::anyhow!("database disabled in CI testing mode")))
}

#[derive(Deserialize)]
pub struct SaveCaptureInput {
    pub model: String,
    pub thinking: bool,
    pub rawText: String,
    pub editedText: Option<String>,
    pub promptVersion: Option<String>,
}

#[derive(Serialize)]
pub struct CaptureRow {
    pub id: String,
    pub created_at: String,
    pub model: String,
    pub raw_text: String,
    pub edited_text: String | null,
}

#[tauri::command]
pub async fn update_capture_text(
    _id: String,
    _field: String,
    _value: String,
) -> Result<()> {
    Err(Error::Other(anyhow::anyhow!("database disabled in CI testing mode")))
}

#[tauri::command]
pub async fn toggle_star(_id: String, _starred: bool) -> Result<()> {
    Err(Error::Other(anyhow::anyhow!("database disabled in CI testing mode")))
}

#[tauri::command]
pub async fn list_captures() -> Result<()> {
    Err(Error::Other(anyhow::anyhow!("database disabled in CI testing mode")))
}

#[tauri::command]
pub async fn get_capture(_id: String) -> Result<()> {
    Err(Error::Other(anyhow::anyhow!("database disabled in CI testing mode")))
}

#[tauri::command]
pub async fn delete_capture(_id: String, _hard: bool) -> Result<()> {
    Err(Error::Other(anyhow::anyhow!("database disabled in CI testing mode")))
}

#[tauri::command]
pub async fn compute_image_data_url(_image_path: String) -> Result<String> {
    Err(Error::Other(anyhow::anyhow!("file access disabled in CI testing mode")))
}

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
    Ok(())
}

// ============================================================================
//  Tray setup (disabled for CI)
// ============================================================================

pub fn setup_tray(_app: &tauri::AppHandle) -> Result<()> {
    Ok(())
}

// ============================================================================
//  Suppress unused warnings
// ============================================================================

#[allow(dead_code)]
fn _unused(_: &WebviewWindow) {}
