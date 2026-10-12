use std::{
    collections::HashSet,
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

#[cfg(target_os = "windows")]
use std::ffi::OsStr;

use tokio::{process::Command, time::timeout};

use crate::models::{AppSettings, CodexCliInfo};

#[cfg(target_os = "macos")]
use super::macos as platform;
#[cfg(target_os = "windows")]
use super::windows as platform;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum CodexSource {
    UserConfigured,
    ExternalCli,
    DesktopBundled,
}

impl CodexSource {
    fn value(self) -> &'static str {
        match self {
            Self::UserConfigured => "userConfigured",
            Self::ExternalCli => "externalCli",
            Self::DesktopBundled => "desktopBundled",
        }
    }

    pub(super) fn label(self) -> &'static str {
        match self {
            Self::UserConfigured => "手动指定的 Codex CLI",
            Self::ExternalCli => "外部 Codex CLI（推荐）",
            Self::DesktopBundled => "Codex 桌面客户端内部 CLI（备用）",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum LaunchKind {
    Direct,
    #[cfg(target_os = "windows")]
    Batch,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ResolvedCodex {
    pub path: PathBuf,
    pub source: CodexSource,
    pub launch_kind: LaunchKind,
    pub version: Option<String>,
}

const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(3);
const SUPPORT_PROMPT_MARKER: &str = "[VIBEKARMA_CODEX_SUPPORT_PROMPT]";

pub(super) async fn inspect(settings: &AppSettings) -> CodexCliInfo {
    match resolve(settings).await {
        Ok(resolved) => CodexCliInfo {
            update_help: Some(super::diagnostics::update_help(&resolved)),
            available: true,
            source: Some(resolved.source.value().to_owned()),
            path: Some(resolved.path.to_string_lossy().into_owned()),
            version: resolved.version,
            message: format!("正在使用：{}", resolved.source.label()),
        },
        Err(message) => CodexCliInfo {
            available: false,
            source: None,
            path: None,
            version: None,
            update_help: None,
            message,
        },
    }
}

pub(super) async fn build_exec_command(
    settings: &AppSettings,
    workspace: &Path,
) -> Result<(Command, ResolvedCodex), String> {
    let resolved = resolve(settings).await?;
    let args = [
        OsString::from("exec"),
        OsString::from("--ephemeral"),
        OsString::from("--sandbox"),
        OsString::from("read-only"),
        OsString::from("--skip-git-repo-check"),
        OsString::from("--ignore-rules"),
        OsString::from("--color"),
        OsString::from("never"),
        OsString::from("-C"),
        workspace.as_os_str().to_owned(),
        OsString::from("-"),
    ];

    let command = build_program_command(&resolved.path, &args)?;
    Ok((command, resolved))
}

pub(super) fn build_program_command(path: &Path, args: &[OsString]) -> Result<Command, String> {
    #[cfg(target_os = "windows")]
    let mut command = platform::build_command(
        &resolved(path.to_path_buf(), CodexSource::ExternalCli),
        args,
    )?;
    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut command = Command::new(path);
        command.args(args);
        command
    };
    prepend_executable_dir_to_path(&mut command, path);
    Ok(command)
}

pub(super) fn with_install_help(summary: impl AsRef<str>) -> String {
    with_install_help_and_diagnostic(summary, None)
}

fn with_install_help_and_diagnostic(summary: impl AsRef<str>, _diagnostic: Option<&str>) -> String {
    let summary = summary.as_ref().trim();
    if summary.contains(SUPPORT_PROMPT_MARKER) {
        return summary.to_owned();
    }
    let (platform, install_instruction) = if cfg!(target_os = "windows") {
        (
            "Windows",
            "优先使用 OpenAI 官方 Windows 独立安装器；如不适用，再使用 npm 安装 @openai/codex。不要修改 C:\\Program Files\\WindowsApps 的权限，也不要复制桌面客户端内部文件。",
        )
    } else if cfg!(target_os = "macos") {
        (
            "macOS",
            "优先使用 OpenAI 官方独立安装方式安装 Codex CLI，不要复制或依赖桌面客户端内部文件。",
        )
    } else {
        (
            "Linux",
            "优先使用 OpenAI 官方独立安装方式安装 Codex CLI，不要复制或依赖桌面客户端内部文件。",
        )
    };
    format_install_help(summary, platform, install_instruction)
}

fn format_install_help(summary: &str, platform: &str, install_instruction: &str) -> String {
    format!(
        "{summary}\n\n{SUPPORT_PROMPT_MARKER}\n我正在 {platform} 上使用 VibeKarma，但应用无法调用 Codex CLI。\n\n请直接在我的电脑上完成以下处理：\n1. 检查外部 Codex CLI 是否已经安装且可以运行。\n2. 如果未安装或已经损坏，请按 OpenAI 官方文档安装或修复外部 Codex CLI。{install_instruction}\n3. 运行 `codex --version` 和 `codex exec --help` 验证。\n4. 完成后告诉我是否需要重启 VibeKarma。\n\n错误摘要：{summary}"
    )
}

pub(super) async fn resolve(settings: &AppSettings) -> Result<ResolvedCodex, String> {
    let configured = settings
        .codex_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(configured) = configured {
        validate_configured_text(configured)?;
    }
    if let Some(configured) = configured {
        let candidates = configured_candidates(configured);
        let mut failures = Vec::new();
        if let Some(resolved) =
            first_healthy(candidates, CodexSource::UserConfigured, &mut failures).await
        {
            return Ok(resolved);
        }
        return Err(with_install_help_and_diagnostic(
            "手动指定的 Codex CLI 无法运行。请重新选择可执行文件，或切换回自动检测。",
            failures.first().map(String::as_str),
        ));
    }

    let desktop = desktop_candidates();
    let external = without_desktop_candidates(external_candidates(), &desktop);
    let mut failures = Vec::new();

    if let Some(resolved) = first_healthy(external, CodexSource::ExternalCli, &mut failures).await {
        return Ok(resolved);
    }
    if let Some(resolved) = first_healthy(desktop, CodexSource::DesktopBundled, &mut failures).await
    {
        return Ok(resolved);
    }

    let summary = if cfg!(target_os = "windows")
        && failures.iter().any(|failure| {
            failure.contains("WindowsApps")
                && (failure.contains("os error 5") || failure.contains("Access is denied"))
        }) {
        "检测到 Codex 桌面客户端内部 CLI，但 Windows 阻止了 VibeKarma 直接启动它。请安装外部 Codex CLI。"
    } else if failures.is_empty() {
        "没有检测到可用的 Codex CLI。请安装外部 Codex CLI，或在设置中手动选择。"
    } else {
        "检测到了 Codex CLI，但健康检查没有通过。请修复或安装外部 Codex CLI。"
    };
    Err(with_install_help_and_diagnostic(
        summary,
        failures.first().map(String::as_str),
    ))
}

fn without_desktop_candidates(external: Vec<PathBuf>, desktop: &[PathBuf]) -> Vec<PathBuf> {
    let desktop_keys = desktop
        .iter()
        .map(|candidate| normalized_key(candidate))
        .collect::<HashSet<_>>();
    external
        .into_iter()
        .filter(|candidate| !desktop_keys.contains(&normalized_key(candidate)))
        .collect()
}

fn configured_candidates(value: &str) -> Vec<PathBuf> {
    let configured = PathBuf::from(value);
    if configured.is_absolute() || configured.components().count() > 1 {
        return vec![configured];
    }

    let names = configured_command_names(value, configured.extension().is_none());

    let mut candidates = vec![configured];
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(
            std::env::split_paths(&path)
                .flat_map(|directory| names.iter().map(move |name| directory.join(name))),
        );
    }
    candidates
}

#[cfg(target_os = "windows")]
fn configured_command_names(value: &str, has_no_extension: bool) -> Vec<String> {
    let mut names = vec![value.to_owned()];
    if has_no_extension {
        names.extend([
            format!("{value}.exe"),
            format!("{value}.cmd"),
            format!("{value}.bat"),
        ]);
    }
    names
}

#[cfg(not(target_os = "windows"))]
fn configured_command_names(value: &str, _has_no_extension: bool) -> [String; 1] {
    [value.to_owned()]
}

async fn first_healthy(
    candidates: Vec<PathBuf>,
    source: CodexSource,
    failures: &mut Vec<String>,
) -> Option<ResolvedCodex> {
    for path in deduplicate(candidates) {
        if !is_usable_cli(&path) {
            continue;
        }
        let mut candidate = resolved(path, source);
        match health_check(&candidate).await {
            Ok(version) => {
                candidate.version = version;
                return Some(candidate);
            }
            Err(error) => failures.push(format!("{}：{error}", candidate.path.display())),
        }
    }
    None
}

async fn health_check(resolved: &ResolvedCodex) -> Result<Option<String>, String> {
    let args = [OsString::from("--version")];

    #[cfg(target_os = "windows")]
    let mut command = platform::build_command(resolved, &args)?;

    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut command = Command::new(&resolved.path);
        command.args(&args);
        command
    };

    prepend_executable_dir_to_path(&mut command, &resolved.path);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let child = command
        .spawn()
        .map_err(|error| format!("无法启动：{error}"))?;
    let output = timeout(HEALTH_CHECK_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| "健康检查超时".to_owned())?
        .map_err(|error| format!("健康检查异常结束：{error}"))?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Ok(parse_version(&stdout).or_else(|| parse_version(&stderr)));
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let detail = stderr.trim();
    if detail.is_empty() {
        Err(format!("健康检查返回 {}", output.status))
    } else {
        Err(format!("健康检查失败：{}", truncate(detail, 180)))
    }
}

fn parse_version(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let line = line.trim();
        let value = line
            .strip_prefix("codex-cli ")
            .or_else(|| line.strip_prefix("OpenAI Codex v"))?
            .trim();
        (!value.is_empty()).then(|| truncate(value, 80))
    })
}

fn truncate(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_owned();
    }
    let mut output = value.chars().take(max_chars).collect::<String>();
    output.push('…');
    output
}

fn resolved(path: PathBuf, source: CodexSource) -> ResolvedCodex {
    ResolvedCodex {
        version: None,
        launch_kind: launch_kind(&path),
        path,
        source,
    }
}

#[cfg(test)]
fn first_usable(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    deduplicate(candidates)
        .into_iter()
        .find(|candidate| is_usable_cli(candidate))
}

fn deduplicate(candidates: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|candidate| seen.insert(normalized_key(candidate)))
        .collect()
}

fn normalized_key(path: &Path) -> OsString {
    #[cfg(target_os = "windows")]
    {
        OsString::from(path.to_string_lossy().to_ascii_lowercase())
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.as_os_str().to_owned()
    }
}

fn validate_configured_text(value: &str) -> Result<(), String> {
    if value
        .chars()
        .any(|character| matches!(character, '\0' | '\n' | '\r' | '"'))
    {
        return Err(with_install_help("Codex CLI 路径包含不允许的字符。"));
    }
    Ok(())
}

fn is_usable_cli(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path)
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }

    #[cfg(windows)]
    {
        matches!(
            path.extension()
                .and_then(OsStr::to_str)
                .map(|extension| extension.to_ascii_lowercase())
                .as_deref(),
            Some("exe" | "cmd" | "bat")
        )
    }
}

#[cfg(target_os = "windows")]
fn launch_kind(path: &Path) -> LaunchKind {
    if matches!(
        path.extension()
            .and_then(OsStr::to_str)
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("cmd" | "bat")
    ) {
        return LaunchKind::Batch;
    }
    LaunchKind::Direct
}

#[cfg(not(target_os = "windows"))]
fn launch_kind(_path: &Path) -> LaunchKind {
    LaunchKind::Direct
}

fn external_candidates() -> Vec<PathBuf> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        platform::external_candidates()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        candidates_on_path(&["codex"])
    }
}

fn desktop_candidates() -> Vec<PathBuf> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        platform::desktop_candidates()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Vec::new()
    }
}

pub(super) fn candidates_on_path(names: &[&str]) -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .flat_map(|directory| names.iter().map(move |name| directory.join(name)))
        .collect()
}

fn prepend_executable_dir_to_path(command: &mut Command, executable: &Path) {
    let Some(parent) = executable
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    else {
        return;
    };
    let mut paths = vec![parent.to_path_buf()];
    if let Some(current) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&current));
    }
    if let Ok(path) = std::env::join_paths(paths) {
        command.env("PATH", path);
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::{
        configured_candidates, deduplicate, first_healthy, first_usable, format_install_help,
        inspect, parse_version, with_install_help, without_desktop_candidates, CodexSource,
        SUPPORT_PROMPT_MARKER,
    };

    #[test]
    fn candidate_order_is_preserved() {
        let root = std::env::temp_dir().join(format!("vibekarma-resolver-{}", std::process::id()));
        let first = root.join(test_executable_name("first"));
        let second = root.join(test_executable_name("second"));
        fs::create_dir_all(&root).expect("temp directory should be created");
        write_executable(&first);
        write_executable(&second);

        assert_eq!(
            first_usable(vec![first.clone(), second]),
            Some(first.clone())
        );

        let _ = fs::remove_file(first);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn duplicate_candidates_do_not_change_priority() {
        let first = PathBuf::from("one/codex");
        let second = PathBuf::from("two/codex");
        assert_eq!(
            deduplicate(vec![first.clone(), first.clone(), second.clone()]),
            vec![first, second]
        );
    }

    #[test]
    fn desktop_binary_in_path_is_not_mislabeled_as_external() {
        let external = PathBuf::from("external/codex");
        let bundled = PathBuf::from("Codex.app/Contents/Resources/codex");
        assert_eq!(
            without_desktop_candidates(
                vec![bundled.clone(), external.clone()],
                std::slice::from_ref(&bundled),
            ),
            vec![external]
        );
    }

    #[test]
    fn install_help_contains_copyable_codex_prompt() {
        let message = with_install_help("找不到 Codex CLI");
        assert!(message.contains(SUPPORT_PROMPT_MARKER));
        assert!(message.contains("按 OpenAI 官方文档安装或修复外部 Codex CLI"));
        assert!(message.contains("codex --version"));
        assert!(message.contains("codex exec --help"));
        assert!(message.contains("找不到 Codex CLI"));
        assert!(!message.contains("完成登录"));
        assert!(!message.contains("诊断信息"));
    }

    #[test]
    fn cli_version_handles_banners_and_warnings() {
        assert_eq!(
            parse_version("warning: something\ncodex-cli 0.157.1\n"),
            Some("0.157.1".into())
        );
        assert_eq!(
            parse_version("OpenAI Codex v0.160.0"),
            Some("0.160.0".into())
        );
        assert_eq!(parse_version("unexpected output"), None);
    }

    #[tokio::test]
    async fn reinspection_reads_updated_version_at_the_configured_path() {
        let root = std::env::temp_dir().join(format!("vibekarma-version-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join(test_executable_name("codex"));
        let settings = crate::models::AppSettings {
            codex_path: Some(path.to_string_lossy().into_owned()),
            ..Default::default()
        };
        for version in ["0.157.1", "0.160.0"] {
            #[cfg(windows)]
            fs::write(
                &path,
                format!("@echo off\r\necho codex-cli {version}\r\nexit /b 0\r\n"),
            )
            .unwrap();
            #[cfg(not(windows))]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::write(&path, format!("#!/bin/sh\necho codex-cli {version}\n")).unwrap();
                fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
            }
            let info = inspect(&settings).await;
            assert!(info.available, "{}", info.message);
            assert_eq!(info.version.as_deref(), Some(version));
            assert_eq!(info.source.as_deref(), Some("userConfigured"));
            assert!(info.update_help.unwrap().contains(version));
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn macos_install_help_uses_platform_specific_copy() {
        let message = format_install_help(
            "没有检测到可用的 Codex CLI。",
            "macOS",
            "优先使用 OpenAI 官方独立安装方式安装 Codex CLI，不要复制或依赖桌面客户端内部文件。",
        );
        assert!(message.contains("我正在 macOS 上使用 VibeKarma"));
        assert!(message.contains("优先使用 OpenAI 官方独立安装方式"));
        assert!(!message.contains("WindowsApps"));
        assert!(!message.contains("npm 安装 @openai/codex"));
    }

    #[tokio::test]
    async fn unhealthy_candidate_is_skipped_without_user_action() {
        let root = std::env::temp_dir().join(format!("vibekarma priority {}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let broken = root.join(test_executable_name("broken"));
        let external = root.join(test_executable_name("healthy"));
        write_probe(&broken, false);
        write_probe(&external, true);

        let mut failures = Vec::new();
        let selected = first_healthy(
            vec![broken, external.clone()],
            CodexSource::ExternalCli,
            &mut failures,
        )
        .await
        .unwrap_or_else(|| panic!("healthy fallback should be selected: {failures:?}"));
        assert_eq!(selected.source, CodexSource::ExternalCli);
        assert_eq!(selected.path, external);
        assert_eq!(failures.len(), 1);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn bare_configured_command_keeps_command_name_compatibility() {
        let candidates = configured_candidates("codex");
        assert_eq!(candidates[0], PathBuf::from("codex"));
        #[cfg(target_os = "windows")]
        assert!(candidates.iter().any(|path| {
            path.file_name()
                .is_some_and(|name| name.eq_ignore_ascii_case("codex.cmd"))
        }));
    }

    fn write_probe(path: &std::path::Path, succeeds: bool) {
        #[cfg(windows)]
        fs::write(
            path,
            if succeeds {
                b"@exit /b 0\r\n".as_slice()
            } else {
                b"@exit /b 1\r\n".as_slice()
            },
        )
        .expect("test probe should be written");
        #[cfg(not(windows))]
        {
            fs::write(
                path,
                if succeeds {
                    b"#!/bin/sh\nexit 0\n".as_slice()
                } else {
                    b"#!/bin/sh\nexit 1\n".as_slice()
                },
            )
            .expect("test probe should be written");
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(path).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(path, permissions).unwrap();
        }
    }

    fn test_executable_name(stem: &str) -> String {
        #[cfg(windows)]
        {
            format!("{stem}.cmd")
        }
        #[cfg(not(windows))]
        {
            stem.to_owned()
        }
    }

    fn write_executable(path: &std::path::Path) {
        fs::write(path, b"test").expect("test executable should be written");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(path).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(path, permissions).unwrap();
        }
    }
}
