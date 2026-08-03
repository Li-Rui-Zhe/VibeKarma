use std::process::Stdio;
#[cfg(target_os = "windows")]
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow,
};
use tokio::process::Command;

const WINDOW_HELPER: &str = include_str!("../scripts/codex-window.ps1");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWindowInfo {
    pub ok: bool,
    pub found: bool,
    #[serde(default)]
    pub handle: i64,
    #[serde(default)]
    pub process_id: u32,
    #[serde(default)]
    pub left: i32,
    #[serde(default)]
    pub top: i32,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    #[serde(default)]
    pub working: bool,
    #[serde(default)]
    pub editor_found: bool,
    #[serde(default)]
    pub editor_has_draft: bool,
    #[serde(default, skip_serializing)]
    pub context: String,
    pub error: Option<String>,
}

#[derive(Clone, Copy)]
struct WindowBounds {
    left: i32,
    top: i32,
    width: u32,
    height: u32,
}

impl From<&CodexWindowInfo> for WindowBounds {
    fn from(info: &CodexWindowInfo) -> Self {
        Self {
            left: info.left,
            top: info.top,
            width: info.width,
            height: info.height,
        }
    }
}

pub async fn inspect() -> Result<CodexWindowInfo, String> {
    run_helper().await
}

pub fn arm_overlay(
    app: &AppHandle,
    kind: &str,
    target: &CodexWindowInfo,
) -> Result<CodexWindowInfo, String> {
    if !matches!(kind, "correction" | "reward") {
        return Err("未知的反馈方式".to_owned());
    }
    let mut info = target.clone();
    ensure_visible_window(&info)?;
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "透明覆盖窗口不存在".to_owned())?;
    let bounds = current_window_bounds(&info)?;
    apply_overlay_bounds(&overlay, bounds)?;
    info.left = bounds.left;
    info.top = bounds.top;
    info.width = bounds.width;
    info.height = bounds.height;
    overlay
        .show()
        .map_err(|error| format!("无法显示覆盖窗口：{error}"))?;
    overlay
        .set_focus()
        .map_err(|error| format!("无法激活覆盖窗口：{error}"))?;
    app.emit_to("overlay", "overlay-arm", kind)
        .map_err(|error| format!("无法启动互动效果：{error}"))?;
    track_window_bounds(overlay, info.handle);
    Ok(info)
}

fn apply_overlay_bounds(overlay: &WebviewWindow, bounds: WindowBounds) -> Result<(), String> {
    overlay
        .set_position(Position::Physical(PhysicalPosition::new(
            bounds.left,
            bounds.top,
        )))
        .map_err(|error| format!("无法对齐 Codex 窗口：{error}"))?;
    overlay
        .set_size(Size::Physical(PhysicalSize::new(
            bounds.width,
            bounds.height,
        )))
        .map_err(|error| format!("无法调整覆盖窗口：{error}"))
}

#[cfg(target_os = "windows")]
fn track_window_bounds(overlay: WebviewWindow, handle: i64) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(120)).await;
        let mut ticker = tokio::time::interval(Duration::from_millis(80));
        let mut hidden_polls = 0;
        loop {
            ticker.tick().await;
            match overlay.is_visible() {
                Ok(true) => hidden_polls = 0,
                Ok(false) => {
                    hidden_polls += 1;
                    if hidden_polls >= 3 {
                        break;
                    }
                    continue;
                }
                Err(_) => break,
            }
            let Some(bounds) = physical_window_bounds(handle) else {
                break;
            };
            let _ = apply_overlay_bounds(&overlay, bounds);
        }
    });
}

#[cfg(not(target_os = "windows"))]
fn track_window_bounds(_overlay: WebviewWindow, _handle: i64) {}

#[cfg(target_os = "windows")]
#[repr(C)]
struct NativeRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[cfg(target_os = "windows")]
#[link(name = "dwmapi")]
unsafe extern "system" {
    fn DwmGetWindowAttribute(
        window: isize,
        attribute: u32,
        value: *mut NativeRect,
        value_size: u32,
    ) -> i32;
}

#[cfg(target_os = "windows")]
#[link(name = "user32")]
unsafe extern "system" {
    fn GetWindowRect(window: isize, rect: *mut NativeRect) -> i32;
    fn GetWindowThreadProcessId(window: isize, process_id: *mut u32) -> u32;
}

#[cfg(target_os = "windows")]
fn physical_window_bounds(handle: i64) -> Option<WindowBounds> {
    const DWMWA_EXTENDED_FRAME_BOUNDS: u32 = 9;
    let mut rect = NativeRect {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    let window = handle as isize;
    let dwm_result = unsafe {
        DwmGetWindowAttribute(
            window,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect,
            std::mem::size_of::<NativeRect>() as u32,
        )
    };
    if dwm_result != 0 && unsafe { GetWindowRect(window, &mut rect) } == 0 {
        return None;
    }
    let width = rect.right.checked_sub(rect.left)?;
    let height = rect.bottom.checked_sub(rect.top)?;
    (width > 0 && height > 0).then_some(WindowBounds {
        left: rect.left,
        top: rect.top,
        width: width as u32,
        height: height as u32,
    })
}

#[cfg(target_os = "windows")]
fn current_window_bounds(info: &CodexWindowInfo) -> Result<WindowBounds, String> {
    let mut process_id = 0_u32;
    let thread_id =
        unsafe { GetWindowThreadProcessId(info.handle as isize, &mut process_id as *mut u32) };
    if thread_id == 0 || process_id != info.process_id {
        return Err("Codex 窗口已经关闭或发生变化，请重试".to_owned());
    }
    physical_window_bounds(info.handle)
        .ok_or_else(|| "暂时无法读取 Codex 窗口位置，请重试".to_owned())
}

#[cfg(not(target_os = "windows"))]
fn physical_window_bounds(_handle: i64) -> Option<WindowBounds> {
    None
}

#[cfg(not(target_os = "windows"))]
fn current_window_bounds(info: &CodexWindowInfo) -> Result<WindowBounds, String> {
    Ok(info.into())
}

pub fn set_main_window_mode(app: &AppHandle, mode: &str) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_owned())?;
    let (width, height, always_on_top) = match mode {
        "compact" => (580.0, 400.0, false),
        "diary" => (1000.0, 700.0, false),
        _ => return Err("未知的窗口模式".to_owned()),
    };
    window
        .set_size(Size::Logical(tauri::LogicalSize::new(width, height)))
        .map_err(|error| format!("无法调整主窗口：{error}"))?;
    window
        .set_always_on_top(always_on_top)
        .map_err(|error| format!("无法调整窗口层级：{error}"))?;
    window
        .center()
        .map_err(|error| format!("无法居中主窗口：{error}"))
}

pub(crate) fn ensure_visible_window(info: &CodexWindowInfo) -> Result<(), String> {
    if !info.ok || !info.found {
        return Err(info
            .error
            .clone()
            .unwrap_or_else(|| "没有找到正在显示的 Codex 窗口".to_owned()));
    }
    Ok(())
}

async fn run_helper() -> Result<CodexWindowInfo, String> {
    let script_bytes = WINDOW_HELPER
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect::<Vec<_>>();
    let encoded_script = STANDARD.encode(script_bytes);
    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoLogo")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-EncodedCommand")
        .arg(encoded_script)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let child = command
        .spawn()
        .map_err(|error| format!("无法启动 Windows 自动化：{error}"))?;
    let output = child
        .wait_with_output()
        .await
        .map_err(|error| format!("Windows 自动化没有正常结束：{error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let payload = stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .ok_or_else(|| {
            let stderr = String::from_utf8_lossy(&output.stderr);
            format!("Windows 自动化没有返回结果：{}", stderr.trim())
        })?;
    serde_json::from_str(payload).map_err(|error| format!("无法解析窗口检测结果：{error}"))
}

#[cfg(test)]
mod tests {
    use super::CodexWindowInfo;

    fn visible_window() -> CodexWindowInfo {
        CodexWindowInfo {
            ok: true,
            found: true,
            handle: 1,
            process_id: 1,
            left: 0,
            top: 0,
            width: 1000,
            height: 700,
            working: false,
            editor_found: false,
            editor_has_draft: true,
            context: String::new(),
            error: None,
        }
    }

    #[test]
    fn silent_feedback_does_not_require_an_editor_or_empty_draft() {
        super::ensure_visible_window(&visible_window())
            .expect("silent feedback only needs a visible Codex window");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn cached_overlay_target_rejects_a_stale_window_handle() {
        let mut info = visible_window();
        info.handle = 0;
        assert!(super::current_window_bounds(&info).is_err());
    }

    #[test]
    fn tauri_runtime_can_spawn_without_a_thread_local_tokio_reactor() {
        let task = tauri::async_runtime::spawn(async { 42 });
        let value = tauri::async_runtime::block_on(task)
            .expect("Tauri's global runtime should execute work from a synchronous thread");
        assert_eq!(value, 42);
    }

    #[tokio::test]
    async fn inspect_helper_returns_structured_window_state() {
        let info = super::inspect()
            .await
            .expect("Windows 窗口检测脚本应返回结构化结果");
        assert!(info.ok || info.error.is_some());
        if info.ok && info.found {
            let bounds = super::current_window_bounds(&info)
                .expect("the cached live Codex handle should resolve without another UI scan");
            assert!(bounds.width > 0 && bounds.height > 0);
        }
    }
}
