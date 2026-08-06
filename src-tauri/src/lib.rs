mod codex;
mod codex_window;
mod models;
mod storage;

use std::{path::PathBuf, sync::Arc};

use codex::CodexManager;
use codex_window::CodexWindowInfo;
use models::{AppSettings, AppSnapshot, DiaryEntry, FeedbackReceipt, FeedbackRequest};
use storage::Storage;
use tauri::{Manager, State};

#[tauri::command]
async fn inspect_codex_window() -> Result<CodexWindowInfo, String> {
    codex_window::inspect().await
}

#[tauri::command]
async fn arm_codex_overlay(
    app: tauri::AppHandle,
    kind: String,
    target: CodexWindowInfo,
) -> Result<CodexWindowInfo, String> {
    codex_window::arm_overlay(&app, &kind, &target)
}

#[tauri::command]
async fn record_desktop_feedback(
    manager: State<'_, Arc<CodexManager>>,
    feedback: FeedbackRequest,
) -> Result<FeedbackReceipt, String> {
    let before = codex_window::inspect().await?;
    codex_window::ensure_visible_window(&before)?;
    let delivery = "silent";
    manager.inner().clone().queue_desktop_reflection(
        &feedback,
        delivery,
        before.context.clone(),
    )?;
    Ok(FeedbackReceipt {
        delivery: delivery.to_owned(),
        thread_id: format!("desktop-window-{}", before.process_id),
        turn_id: None,
        diary_queued: true,
    })
}

#[tauri::command]
fn set_main_window_mode(app: tauri::AppHandle, mode: String) -> Result<(), String> {
    codex_window::set_main_window_mode(&app, &mode)
}

#[tauri::command]
fn hide_codex_overlay(app: tauri::AppHandle) -> Result<(), String> {
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "透明覆盖窗口不存在".to_owned())?;
    overlay
        .hide()
        .map_err(|error| format!("无法关闭透明覆盖窗口：{error}"))
}

#[tauri::command]
async fn get_app_snapshot(manager: State<'_, Arc<CodexManager>>) -> Result<AppSnapshot, String> {
    Ok(manager.app_snapshot().await)
}

#[tauri::command]
fn save_settings(
    manager: State<'_, Arc<CodexManager>>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    manager.save_settings(settings)
}

#[tauri::command]
fn list_diaries(manager: State<'_, Arc<CodexManager>>) -> Vec<DiaryEntry> {
    manager.list_diaries()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let fallback_root = app.path().app_data_dir()?;
            let data_root = std::env::var_os("VIBEKARMA_DATA_DIR")
                .map(PathBuf::from)
                .or_else(|| {
                    PathBuf::from(r"D:\")
                        .exists()
                        .then(|| PathBuf::from(r"D:\VibeKarmaData"))
                })
                .unwrap_or(fallback_root);
            let storage = Arc::new(Storage::new(data_root).map_err(std::io::Error::other)?);
            let manager = Arc::new(CodexManager::new(app.handle().clone(), storage));
            app.manage(manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_snapshot,
            inspect_codex_window,
            arm_codex_overlay,
            record_desktop_feedback,
            set_main_window_mode,
            hide_codex_overlay,
            save_settings,
            list_diaries
        ])
        .run(tauri::generate_context!())
        .expect("error while running VibeKarma");
}
