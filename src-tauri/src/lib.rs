// SnapOCR Tauri backend entrypoint.
//
// Modules:
//   - capture:  screen capture (xcap-based, multi-monitor aware)
//   - vlm:      vision-language-model HTTP client (OpenAI-compatible)
//   - commands: Tauri commands exposed to the frontend
//   - error:    error types serializable across the IPC boundary
//   - shortcut: global hotkey registration

mod capture;
mod commands;
mod error;
mod shortcut;
mod vlm;

use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use crate::commands::AppState;

/// SQL migrations — append-only. Never edit an existing migration; add a new one.
fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create captures table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS captures (
                    id            TEXT PRIMARY KEY,
                    created_at    TEXT NOT NULL,
                    image_path    TEXT,
                    image_width   INTEGER,
                    image_height  INTEGER,
                    model         TEXT NOT NULL,
                    thinking      INTEGER NOT NULL DEFAULT 0,
                    latency_ms    INTEGER,
                    tokens_input  INTEGER,
                    tokens_output INTEGER,
                    cost_cny      REAL,
                    raw_text      TEXT NOT NULL,
                    edited_text   TEXT,
                    prompt_version TEXT,
                    source        TEXT,         -- 'screenshot' | 'paste' | 'file'
                    tags          TEXT,         -- JSON array
                    is_starred    INTEGER NOT NULL DEFAULT 0,
                    is_deleted    INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_captures_created_at ON captures(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_captures_model ON captures(model);
                CREATE INDEX IF NOT EXISTS idx_captures_starred ON captures(is_starred) WHERE is_starred = 1;
            "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create eval_samples table",
            sql: r#"
                CREATE TABLE IF NOT EXISTS eval_samples (
                    id            TEXT PRIMARY KEY,
                    image_path    TEXT NOT NULL,
                    ground_truth  TEXT NOT NULL,
                    category      TEXT,
                    source        TEXT,
                    created_at    TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_eval_category ON eval_samples(category);
            "#,
            kind: MigrationKind::Up,
        },
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
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut("Ctrl+Shift+O")
                .expect("default shortcut must parse")
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Err(e) = commands::start_capture(app) {
                            tracing::error!("capture start failed: {e:?}");
                        }
                    }
                })
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:snapocr.db", migrations())
                .build(),
        )
        .manage(Arc::new(AppState::default()))
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                use tauri::WebviewWindow;
                let window: WebviewWindow = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // Register tray — kept minimal, all interaction is via the main window.
            commands::setup_tray(app)?;

            // Wire user-configurable shortcut reload — when store changes, re-register.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = shortcut::sync_from_store(&handle).await {
                    tracing::warn!("failed to sync shortcut from store: {e:?}");
                }
            });

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
            commands::set_shortcut,
            commands::get_active_shortcut,
            commands::show_main_window,
            commands::hide_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SnapOCR");
}
