use std::process::Stdio;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size};
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

pub async fn inspect() -> Result<CodexWindowInfo, String> {
    run_helper("inspect", None).await
}

pub async fn send_text(text: &str) -> Result<CodexWindowInfo, String> {
    let info = run_helper("send", Some(text)).await?;
    ensure_window(&info)?;
    Ok(info)
}

pub async fn arm_overlay(app: &AppHandle, kind: &str) -> Result<CodexWindowInfo, String> {
    if !matches!(kind, "correction" | "reward") {
        return Err("未知的反馈方式".to_owned());
    }
    let info = inspect().await?;
    ensure_window(&info)?;
    let overlay = app
        .get_webview_window("overlay")
        .ok_or_else(|| "透明覆盖窗口不存在".to_owned())?;
    overlay
        .set_position(Position::Physical(PhysicalPosition::new(
            info.left, info.top,
        )))
        .map_err(|error| format!("无法对齐 Codex 窗口：{error}"))?;
    overlay
        .set_size(Size::Physical(PhysicalSize::new(info.width, info.height)))
        .map_err(|error| format!("无法调整覆盖窗口：{error}"))?;
    overlay
        .show()
        .map_err(|error| format!("无法显示覆盖窗口：{error}"))?;
    overlay
        .set_focus()
        .map_err(|error| format!("无法激活覆盖窗口：{error}"))?;
    app.emit_to("overlay", "overlay-arm", kind)
        .map_err(|error| format!("无法启动互动效果：{error}"))?;
    Ok(info)
}

pub fn set_main_window_mode(app: &AppHandle, mode: &str) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在".to_owned())?;
    let (width, height, always_on_top) = match mode {
        "compact" => (500.0, 330.0, false),
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

pub(crate) fn ensure_window(info: &CodexWindowInfo) -> Result<(), String> {
    if !info.ok || !info.found {
        if info
            .error
            .as_deref()
            .is_some_and(|error| error.contains("unsent draft"))
        {
            return Err("Codex 输入框里有尚未发送的草稿，请先发送或清空它".to_owned());
        }
        return Err(info
            .error
            .clone()
            .unwrap_or_else(|| "没有找到正在显示的 Codex 窗口".to_owned()));
    }
    if !info.editor_found {
        return Err("找到了 Codex 窗口，但没有找到输入框".to_owned());
    }
    if info.editor_has_draft {
        return Err("Codex 输入框里有尚未发送的草稿，请先发送或清空它".to_owned());
    }
    Ok(())
}

async fn run_helper(action: &str, text: Option<&str>) -> Result<CodexWindowInfo, String> {
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
        .env("VIBEKARMA_ACTION", action)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(text) = text {
        command.env("VIBEKARMA_TEXT", text);
    }

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
    #[tokio::test]
    async fn inspect_helper_returns_structured_window_state() {
        let info = super::inspect()
            .await
            .expect("Windows 窗口检测脚本应返回结构化结果");
        assert!(info.ok || info.error.is_some());
    }
}
