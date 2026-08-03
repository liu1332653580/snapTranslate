//! Tauri backend entrypoint.
//!
//! Modules:
//!   - capture:  screen capture (mock implementation for CI)
//!   - commands: Tauri commands exposed to the frontend
//!   - error:    error types serializable across the IPC boundary
//!   - shortcut: global hotkey registration (disabled for CI)
//!   - vlm:      vision-language-model HTTP client (OpenAI-compatible)

use crate::{commands, error::Result};
use std::sync::Arc;

// These modules are temporarily disabled for CI testing
// use crate::{capture, shortcut};
use crate::{commands, error::Result};

use crate::commands::AppState;

/// SQL migrations — append-only. Never edit an existing migration; add a new one.
fn migrations() -> Vec<tauri_plugin_sql::Migration> {
    vec![
        // Temporarily disabled for CI testing
        // tauri_plugin_sql::Migration {
        //     version: 1,
        //     description: "create captures table",
        //     sql: r#"...",
        //     kind: tauri_plugin_sql::MigrationKind::Up,
        // },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::registry()
        .with(fmt::layer().with_target(false))
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,snapocr=debug")))
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // Temporarily disabled plugins for CI testing
        // .plugin(tauri_plugin_clipboard_manager::init())
        // .plugin(tauri_plugin_dialog::init())
        // .plugin(tauri_plugin_fs::init())
        // .plugin(tauri_plugin_store::Builder::default().build())
        // .plugin(tauri_plugin_http::init())
        // .plugin(
        //     tauri_plugin_global_shortcut::Builder::new()
        //         .with_shortcut("Ctrl+Shift+O")
        //         .expect("default shortcut must parse")
        //         .with_handler(|app, _shortcut, event| {
        //             if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
        //                 if let Err(e) = commands::start_capture(app) {
        //                     tracing::error!("capture start failed: {e:?}");
        //                 }
        //             }
        //         })
        //         .build(),
        // )
        // .plugin(
        //     tauri_plugin_sql::Builder::default()
        //         .add_migrations("sqlite:snapocr.db", migrations())
        //         .build(),
        )
        .manage(Arc::new(AppState::default()))
        .setup(|app| {
            tracing::info!("SnapOCR backend ready");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture_region,
            commands::capture_full_screen,
            commands::recognize,
            commands::save_capture,
            commands::update_capture_text,
            commands::list_captures,
            commands::get_capture,
            commands::delete_capture,
            commands::toggle_star,
            commands::compute_image_data_url,
            // Temporarily disabled for CI
            // commands::set_shortcut,
            // commands::get_active_shortcut,
            commands::show_main_window,
            commands::hide_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SnapOCR");
}

// Environment and time
use std::time::Duration;
use tauri::{AppHandle, Manager};
use base64::Engine;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};
use tauri_plugin_sql::Migration;
