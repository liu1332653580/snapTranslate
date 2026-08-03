//! Global shortcut management - disabled for CI testing.

use crate::error::{Error, Result};

/// Read user's configured shortcut - disabled for CI.
pub fn read_configured() -> String {
    "Ctrl+Shift+O".to_string()
}

/// Update shortcut - disabled for CI.
pub fn set_and_register(_app: &tauri::AppHandle, _accel: &str) -> Result<()> {
    Ok(())
}

/// Async wrapper - disabled for CI.
pub async fn sync_from_store_async(_app: tauri::AppHandle) -> Result<()> {
    Ok(())
}
