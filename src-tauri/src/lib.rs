mod codex;
mod codex_window;
mod models;
mod storage;

use std::{path::PathBuf, sync::Arc};

use codex::CodexManager;
use codex_window::CodexWindowInfo;
use models::{
    AppSettings, AppSnapshot, DiaryEntry, FeedbackReceipt, FeedbackRequest, SessionSnapshot,
};
use serde_json::Value;
use storage::Storage;
use tauri::{Manager, State};

#[tauri::command]
async fn inspect_codex_window() -> Result<CodexWindowInfo, String> {
    codex_window::inspect().await
}

#[tauri::command]
async fn arm_codex_overlay(app: tauri::AppHandle, kind: String) -> Result<CodexWindowInfo, String> {
    codex_window::arm_overlay(&app, &kind).await
}

#[tauri::command]
async fn send_desktop_feedback(
    manager: State<'_, Arc<CodexManager>>,
    feedback: FeedbackRequest,
) -> Result<FeedbackReceipt, String> {
    let reason = feedback.reason.trim();
    let before = codex_window::inspect().await?;
    codex_window::ensure_window(&before)?;
    let guidance = codex::desktop_feedback_guidance(
        feedback.kind,
        reason,
        feedback.note.trim(),
        before.working,
    );
    codex_window::send_text(&guidance).await?;

    let delivery = if before.working { "steered" } else { "newTurn" };
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
async fn connect_codex(manager: State<'_, Arc<CodexManager>>) -> Result<SessionSnapshot, String> {
    manager.inner().clone().connect().await
}

#[tauri::command]
async fn disconnect_codex(manager: State<'_, Arc<CodexManager>>) -> Result<(), String> {
    manager.disconnect().await
}

#[tauri::command]
async fn send_user_message(
    manager: State<'_, Arc<CodexManager>>,
    text: String,
) -> Result<Value, String> {
    manager.inner().clone().send_user_message(text).await
}

#[tauri::command]
async fn send_feedback(
    manager: State<'_, Arc<CodexManager>>,
    feedback: FeedbackRequest,
) -> Result<FeedbackReceipt, String> {
    manager.inner().clone().send_feedback(feedback).await
}

#[tauri::command]
async fn interrupt_turn(manager: State<'_, Arc<CodexManager>>) -> Result<(), String> {
    manager.interrupt_turn().await
}

#[tauri::command]
async fn respond_to_server_request(
    manager: State<'_, Arc<CodexManager>>,
    request_id: Value,
    result: Value,
) -> Result<(), String> {
    manager.respond_to_server_request(request_id, result).await
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
            send_desktop_feedback,
            set_main_window_mode,
            hide_codex_overlay,
            save_settings,
            connect_codex,
            disconnect_codex,
            send_user_message,
            send_feedback,
            interrupt_turn,
            respond_to_server_request,
            list_diaries
        ])
        .run(tauri::generate_context!())
        .expect("error while running VibeKarma");
}
