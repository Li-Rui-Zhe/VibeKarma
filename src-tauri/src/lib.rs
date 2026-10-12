mod codex;
mod codex_window;
mod models;
mod storage;

use std::{
    path::PathBuf,
    sync::{Arc, OnceLock},
};

use codex::CodexManager;
use codex_window::CodexWindowInfo;
use models::{
    AppSettings, AppSnapshot, CodexCliInfo, CodexCliUpdateInfo, CodexCliUpdateResult, DiaryEntry,
    FeedbackReceipt, FeedbackRequest,
};
use storage::Storage;
use tauri::{Manager, State};

#[derive(Default)]
struct CodexState {
    manager: OnceLock<Arc<CodexManager>>,
}

impl CodexState {
    fn get(&self) -> Result<Arc<CodexManager>, String> {
        self.manager
            .get()
            .cloned()
            .ok_or_else(|| "VibeKarma 正在初始化，请稍后重新检测。".to_owned())
    }
}

#[tauri::command]
async fn inspect_codex_window() -> Result<CodexWindowInfo, String> {
    codex_window::inspect().await
}

#[tauri::command]
async fn open_codex_context_permissions() -> Result<(), String> {
    codex_window::open_context_permissions().await
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
    state: State<'_, CodexState>,
    feedback: FeedbackRequest,
) -> Result<FeedbackReceipt, String> {
    let manager = state.get()?;
    let before = codex_window::inspect().await?;
    codex_window::ensure_visible_window(&before)?;
    let delivery = "silent";
    manager.queue_desktop_reflection(&feedback, delivery, before.context.clone())?;
    Ok(FeedbackReceipt {
        delivery: delivery.to_owned(),
        thread_id: format!("desktop-window-{}", before.process_id),
        turn_id: None,
        diary_queued: true,
        context_warning: before.context_warning,
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
async fn get_app_snapshot(state: State<'_, CodexState>) -> Result<AppSnapshot, String> {
    let manager = state.get()?;
    Ok(manager.app_snapshot().await)
}

#[tauri::command]
async fn save_settings(
    state: State<'_, CodexState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let manager = state.get()?;
    manager.save_settings(settings).await
}

#[tauri::command]
async fn inspect_codex_cli(state: State<'_, CodexState>) -> Result<CodexCliInfo, String> {
    let manager = state.get()?;
    Ok(manager.codex_cli_info().await)
}

#[tauri::command]
fn list_diaries(state: State<'_, CodexState>) -> Result<Vec<DiaryEntry>, String> {
    Ok(state.get()?.list_diaries())
}

#[tauri::command]
async fn retry_failed_diaries(state: State<'_, CodexState>) -> Result<usize, String> {
    Ok(state.get()?.retry_failed_reflections())
}

#[tauri::command]
async fn check_codex_cli_update(
    state: State<'_, CodexState>,
    force: bool,
) -> Result<CodexCliUpdateInfo, String> {
    Ok(state.get()?.check_cli_update(force).await)
}

#[tauri::command]
async fn update_codex_cli(
    state: State<'_, CodexState>,
    path: String,
    version: String,
) -> Result<CodexCliUpdateResult, String> {
    state.get()?.update_cli(&path, &version).await
}

pub fn run() {
    #[cfg(target_os = "macos")]
    let _ = fix_path_env::fix();

    tauri::Builder::default()
        .manage(CodexState::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let fallback_root = app.path().app_data_dir()?;
            let data_root = std::env::var_os("VIBEKARMA_DATA_DIR")
                .map(PathBuf::from)
                .or({
                    #[cfg(target_os = "windows")]
                    {
                        PathBuf::from(r"D:\")
                            .exists()
                            .then(|| PathBuf::from(r"D:\VibeKarmaData"))
                    }
                    #[cfg(not(target_os = "windows"))]
                    {
                        None
                    }
                })
                .unwrap_or(fallback_root);
            let storage = Arc::new(Storage::new(data_root).map_err(std::io::Error::other)?);
            let manager = Arc::new(CodexManager::new(app.handle().clone(), storage));
            app.state::<CodexState>()
                .manager
                .set(manager)
                .map_err(|_| std::io::Error::other("CodexManager 已经初始化"))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_snapshot,
            inspect_codex_window,
            open_codex_context_permissions,
            arm_codex_overlay,
            record_desktop_feedback,
            set_main_window_mode,
            hide_codex_overlay,
            save_settings,
            inspect_codex_cli,
            list_diaries,
            retry_failed_diaries,
            check_codex_cli_update,
            update_codex_cli
        ])
        .run(tauri::generate_context!())
        .expect("error while running VibeKarma");
}
