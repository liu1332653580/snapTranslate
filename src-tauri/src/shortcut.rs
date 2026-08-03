//! Global shortcut management. Default is Ctrl+Shift+O (Cmd+Shift+O on macOS).
//! Users can override via Settings; we persist the new binding in the Store.

use crate::error::{Error, Result};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_store::StoreExt;

const STORE_KEY: &str = "global_shortcut";
const DEFAULT_SHORTCUT: &str = "Ctrl+Shift+O";

#[cfg(target_os = "macos")]
pub fn platform_default() -> &'static str {
    "Cmd+Shift+O"
}
#[cfg(not(target_os = "macos"))]
pub fn platform_default() -> &'static str {
    DEFAULT_SHORTCUT
}

/// Read user's configured shortcut, falling back to the platform default.
pub fn read_configured(app: &AppHandle) -> String {
    if let Ok(store) = app.store("settings.json") {
        if let Some(v) = store.get(STORE_KEY) {
            if let Some(s) = v.as_str() {
                if !s.is_empty() {
                    return s.to_string();
                }
            }
        }
    }
    platform_default().to_string()
}

/// Unregister all shortcuts and re-register the configured one. Called at startup
/// and whenever the user changes the binding.
pub fn sync_from_store(app: &AppHandle) -> Result<()> {
    let accel = read_configured(app);
    let parsed: Shortcut = accel
        .parse()
        .map_err(|e| Error::Config(format!("invalid shortcut '{accel}': {e}")))?;

    let gs = app.global_shortcut();
    gs.unregister_all()?;

    gs.on_shortcut(parsed, move |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            if let Err(e) = crate::commands::start_capture(app) {
                tracing::error!("shortcut capture failed: {e:?}");
            }
        }
    })?;

    tracing::info!("global shortcut registered: {accel}");
    Ok(())
}

/// Async wrapper for use from `tokio::spawn`.
pub async fn sync_from_store_async(app: AppHandle) -> Result<()> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || sync_from_store(&app))
        .await
        .map_err(|e| Error::Other(anyhow::anyhow!("join shortcut task: {e}")))?
}

/// Persist a new shortcut and re-register. Called from the Settings dialog.
pub fn set_and_register(app: &AppHandle, accel: &str) -> Result<()> {
    // Validate first — parse will fail loudly if the user typed garbage.
    let _: Shortcut = accel
        .parse()
        .map_err(|e| Error::InvalidInput(format!("invalid shortcut '{accel}': {e}")))?;

    let store = app
        .store("settings.json")
        .map_err(|e| Error::Config(format!("open store: {e}")))?;
    store.set(STORE_KEY, serde_json::json!(accel));
    store.save()
        .map_err(|e| Error::Config(format!("save store: {e}")))?;

    sync_from_store(app)
}
