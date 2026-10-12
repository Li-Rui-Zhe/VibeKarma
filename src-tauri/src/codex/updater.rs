use std::{
    path::{Path, PathBuf},
    process::{Output, Stdio},
    time::{Duration, Instant},
};

use semver::Version;
use serde_json::Value;
use tokio::{process::Command, sync::Mutex, time::timeout};

use super::resolver::{self, CodexSource, ResolvedCodex};
use crate::models::{AppSettings, CodexCliInfo, CodexCliUpdateInfo};

const RELEASE_URL: &str = "https://releases.openai.com/codex/channels/latest";
const FALLBACK_RELEASE_URL: &str = "https://api.github.com/repos/openai/codex/releases/latest";
#[cfg(not(windows))]
const CHECK_TIMEOUT: Duration = Duration::from_secs(15);
const UPDATE_TIMEOUT: Duration = Duration::from_secs(300);
type CachedRelease = Option<(Instant, Result<String, String>)>;

#[derive(Default)]
pub(super) struct CliUpdater {
    latest: Mutex<CachedRelease>,
}

#[derive(Debug, PartialEq, Eq)]
enum UpdateMethod {
    Standalone {
        home: PathBuf,
    },
    Npm {
        prefix: PathBuf,
    },
    #[cfg(target_os = "macos")]
    Homebrew {
        brew: PathBuf,
    },
}

impl UpdateMethod {
    fn label(&self) -> &'static str {
        match self {
            Self::Standalone { .. } => "官方独立安装",
            Self::Npm { .. } => "npm",
            #[cfg(target_os = "macos")]
            Self::Homebrew { .. } => "Homebrew",
        }
    }
}

impl CliUpdater {
    pub(super) async fn check(&self, settings: &AppSettings, force: bool) -> CodexCliUpdateInfo {
        let resolved = match resolver::resolve(settings).await {
            Ok(resolved) => resolved,
            Err(_) => {
                return CodexCliUpdateInfo {
                    path: None,
                    current_version: None,
                    latest_version: None,
                    status: "unavailable".into(),
                    can_update: false,
                    method: None,
                    message: "请先配置可以运行的 Codex CLI，再检查更新。".into(),
                }
            }
        };
        let method = detect_method(&resolved);
        let latest = self.latest_version(force).await;
        update_info(&resolved, method.as_ref(), latest)
    }

    async fn latest_version(&self, force: bool) -> Result<String, String> {
        let mut cache = self.latest.lock().await;
        if !force {
            if let Some((at, result)) = cache.as_ref() {
                let lifetime = if result.is_ok() { 1800 } else { 60 };
                if at.elapsed() < Duration::from_secs(lifetime) {
                    return result.clone();
                }
            }
        }
        let result = fetch_latest_version().await;
        *cache = Some((Instant::now(), result.clone()));
        result
    }

    pub(super) async fn apply(
        &self,
        settings: &AppSettings,
        expected_path: &str,
        expected_version: &str,
        update_cache: &Path,
    ) -> Result<CodexCliInfo, String> {
        let resolved = resolver::resolve(settings).await?;
        if resolved.path != Path::new(expected_path)
            || resolved.version.as_deref() != Some(expected_version)
        {
            return Err("实际调用的 CLI 路径或版本已变化，请重新检查更新。".into());
        }
        let method = detect_method(&resolved).ok_or_else(|| unsupported_message(&resolved))?;
        let latest = self.latest_version(false).await?;
        let current = parse_version(expected_version)?;
        let target = parse_version(&latest)?;
        if current >= target {
            return Ok(resolver::inspect(settings).await);
        }
        let mut command = update_command(&resolved, &method).await?;
        std::fs::create_dir_all(update_cache)
            .map_err(|error| format!("无法创建 CLI 更新缓存目录：{error}"))?;
        command.env("NPM_CONFIG_CACHE", update_cache.join("npm"));
        #[cfg(windows)]
        command.env("TMP", update_cache).env("TEMP", update_cache);
        #[cfg(not(windows))]
        command.env("TMPDIR", update_cache);
        let output = run(&mut command, UPDATE_TIMEOUT).await?;
        if !output.status.success() {
            let detail = output_detail(&output);
            return Err(format!("Codex CLI 更新失败，未重试日记。请检查网络和安装目录写入权限，或按原安装方式手动更新。\n{detail}"));
        }
        // Verify the original visible path, not whichever `codex` happens to be on PATH.
        let info = resolver::inspect(settings).await;
        let after = info.version.as_deref().map(parse_version).transpose()?;
        if !info.available
            || info.path.as_deref() != Some(expected_path)
            || after.as_ref().is_none_or(|version| version < &target)
        {
            return Err("更新命令已经结束，但实际调用的 CLI 尚未达到目标版本。请检查是否手动指定了旧版本目录，或只更新了另一份 CLI；未重试日记。".into());
        }
        *self.latest.lock().await = None;
        Ok(info)
    }
}

fn parse_version(value: &str) -> Result<Version, String> {
    Version::parse(value.trim().strip_prefix('v').unwrap_or(value.trim()))
        .map_err(|_| "无法识别 CLI 版本，请按原安装方式检查更新。".to_owned())
}

fn update_info(
    resolved: &ResolvedCodex,
    method: Option<&UpdateMethod>,
    latest: Result<String, String>,
) -> CodexCliUpdateInfo {
    let mut info = CodexCliUpdateInfo {
        path: Some(resolved.path.to_string_lossy().into_owned()),
        current_version: resolved.version.clone(),
        latest_version: None,
        status: "checkFailed".into(),
        can_update: false,
        method: method.map(|method| method.label().into()),
        message: String::new(),
    };
    let latest = match latest {
        Ok(latest) => latest,
        Err(_) => {
            info.message =
                "暂时无法连接官方更新服务，可以稍后重新检查。日记功能仍可继续使用。".into();
            return info;
        }
    };
    info.latest_version = Some(latest.clone());
    let current = resolved
        .version
        .as_deref()
        .and_then(|value| parse_version(value).ok());
    match (current, parse_version(&latest)) {
        (Some(current), Ok(target)) if current >= target => {
            info.status = "upToDate".into();
            info.message = "当前 CLI 已是最新稳定版或更新的版本。".into();
        }
        (Some(_), Ok(_)) => {
            info.status = "available".into();
            info.can_update = method.is_some();
            info.message = if method.is_some() {
                format!("发现 CLI 新版本 {latest}，建议更新后使用新模型。")
            } else {
                unsupported_message(resolved)
            };
        }
        _ => {
            info.status = "unknownVersion".into();
            info.message = "无法比较当前 CLI 版本，请按原安装方式检查更新。".into();
        }
    }
    info
}

fn unsupported_message(resolved: &ResolvedCodex) -> String {
    if is_bundled(resolved) {
        "发现 CLI 新版本，请更新 Codex 桌面客户端，或改用外部 CLI。内部 CLI 随桌面客户端更新。"
            .into()
    } else {
        "发现 CLI 新版本，但无法确认当前安装方式。请查看更新帮助，按原安装方式更新这一路径的 CLI。"
            .into()
    }
}

fn detect_method(resolved: &ResolvedCodex) -> Option<UpdateMethod> {
    if is_bundled(resolved) {
        return None;
    }
    let visible = resolved
        .path
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    if visible.contains("/packages/standalone/releases/") {
        return None;
    }
    let path = normalized_canonical_path(&resolved.path)?;
    for ancestor in path.ancestors().skip(1).take(9) {
        if ancestor.join("codex-package.json").is_file() {
            let metadata: Value =
                serde_json::from_slice(&std::fs::read(ancestor.join("codex-package.json")).ok()?)
                    .ok()?;
            if metadata["variant"] == "codex" {
                if let Some(standalone) = ancestor.ancestors().find(|directory| {
                    directory
                        .file_name()
                        .is_some_and(|name| name == "standalone")
                        && directory
                            .parent()
                            .and_then(Path::file_name)
                            .is_some_and(|name| name == "packages")
                }) {
                    return Some(UpdateMethod::Standalone {
                        home: standalone.parent()?.parent()?.to_path_buf(),
                    });
                }
            }
        }
        // Windows npm wrappers live beside node_modules; Unix binaries may be package symlinks.
        let npm_wrapper = resolved
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                matches!(
                    name.to_ascii_lowercase().as_str(),
                    "codex" | "codex.exe" | "codex.cmd" | "codex.bat"
                )
            });
        let adjacent_package = if npm_wrapper && Some(ancestor) == path.parent() {
            ancestor.join("node_modules/@openai/codex")
        } else {
            PathBuf::new()
        };
        for package in [ancestor.to_path_buf(), adjacent_package] {
            if !package.ends_with("node_modules/@openai/codex") {
                continue;
            }
            let metadata = std::fs::read(package.join("package.json"))
                .ok()
                .and_then(|raw| serde_json::from_slice::<Value>(&raw).ok());
            if metadata
                .as_ref()
                .is_some_and(|metadata| metadata["name"] == "@openai/codex")
            {
                let parent = package.parent()?.parent()?.parent()?;
                let prefix = if parent.file_name().is_some_and(|name| name == "lib") {
                    parent.parent()?
                } else {
                    parent
                };
                return Some(UpdateMethod::Npm {
                    prefix: prefix.to_path_buf(),
                });
            }
        }
    }
    #[cfg(target_os = "macos")]
    for prefix in [Path::new("/opt/homebrew"), Path::new("/usr/local")] {
        if path.starts_with(prefix.join("Caskroom/codex")) {
            let brew = prefix.join("bin/brew");
            if brew.is_file() {
                return Some(UpdateMethod::Homebrew { brew });
            }
        }
    }
    None
}

fn is_bundled(resolved: &ResolvedCodex) -> bool {
    if resolved.source == CodexSource::DesktopBundled {
        return true;
    }
    // A manually selected binary or symlink must not bypass the app bundle guard.
    let path = normalized_canonical_path(&resolved.path)
        .unwrap_or_else(|| resolved.path.clone())
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    path.contains("/windowsapps/")
        || ["/codex.app/contents/", "/chatgpt.app/contents/"]
            .iter()
            .any(|bundle| path.contains(bundle))
}

fn normalized_canonical_path(path: &Path) -> Option<PathBuf> {
    let canonical = std::fs::canonicalize(path).ok()?;
    #[cfg(windows)]
    {
        let text = canonical.to_string_lossy();
        if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
            return Some(PathBuf::from(format!(r"\\{unc}")));
        }
        if let Some(path) = text.strip_prefix(r"\\?\") {
            return Some(PathBuf::from(path));
        }
    }
    Some(canonical)
}

async fn update_command(
    resolved: &ResolvedCodex,
    method: &UpdateMethod,
) -> Result<Command, String> {
    let mut command = match method {
        UpdateMethod::Standalone { home } => {
            let mut help = resolver::build_program_command(
                &resolved.path,
                &["update".into(), "--help".into()],
            )?;
            let output = run(&mut help, Duration::from_secs(5)).await?;
            if !output.status.success() {
                return Err("这份 CLI 尚不支持自更新，请使用更新帮助中的官方安装方式更新。".into());
            }
            let mut command = resolver::build_program_command(&resolved.path, &["update".into()])?;
            command
                .env("CODEX_HOME", home)
                .env("CODEX_NON_INTERACTIVE", "1");
            if let Some(bin) = resolved
                .path
                .parent()
                .filter(|bin| !bin.starts_with(home.join("packages/standalone")))
            {
                command.env("CODEX_INSTALL_DIR", bin);
            }
            command
        }
        UpdateMethod::Npm { prefix } => {
            let npm = find_npm(prefix)
                .ok_or_else(|| "未找到 npm，请使用原来的安装方式更新 CLI。".to_owned())?;
            resolver::build_program_command(
                &npm,
                &[
                    "install".into(),
                    "--global".into(),
                    "--prefix".into(),
                    prefix.as_os_str().to_owned(),
                    "@openai/codex@latest".into(),
                    "--no-audit".into(),
                    "--no-fund".into(),
                ],
            )?
        }
        #[cfg(target_os = "macos")]
        UpdateMethod::Homebrew { brew } => resolver::build_program_command(
            brew,
            &["upgrade".into(), "--cask".into(), "codex".into()],
        )?,
    };
    command.env_remove("CODEX_RELEASE");
    Ok(command)
}

fn find_npm(prefix: &Path) -> Option<PathBuf> {
    #[cfg(windows)]
    let names = ["npm.cmd", "npm.exe"];
    #[cfg(not(windows))]
    let names = ["npm"];
    [prefix.to_path_buf(), prefix.join("bin")]
        .into_iter()
        .flat_map(|directory| names.iter().map(move |name| directory.join(name)))
        .chain(resolver::candidates_on_path(&names))
        .into_iter()
        .find(|path| path.is_file())
}

async fn fetch_latest_version() -> Result<String, String> {
    #[cfg(windows)]
    {
        let powershell =
            PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
                .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let script = r#"$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try { $metadata=Invoke-RestMethod -Uri '__RELEASE_URL__' -TimeoutSec 8 } catch { $metadata=Invoke-RestMethod -Uri '__FALLBACK_URL__' -TimeoutSec 8 -Headers @{'User-Agent'='VibeKarma'} }; @{tag_name=$metadata.tag_name} | ConvertTo-Json -Compress"#
            .replace("__RELEASE_URL__", RELEASE_URL).replace("__FALLBACK_URL__", FALLBACK_RELEASE_URL);
        let mut command = resolver::build_program_command(
            &powershell,
            &[
                "-NoProfile".into(),
                "-NonInteractive".into(),
                "-Command".into(),
                script.into(),
            ],
        )?;
        let output = run(&mut command, Duration::from_secs(25)).await?;
        if !output.status.success() {
            return Err("无法连接官方 CLI 更新服务".into());
        }
        latest_from_metadata(&output.stdout)
    }
    #[cfg(not(windows))]
    {
        let curl = PathBuf::from("/usr/bin/curl");
        for url in [RELEASE_URL, FALLBACK_RELEASE_URL] {
            let args = [
                "--fail",
                "--silent",
                "--show-error",
                "--location",
                "--max-time",
                "10",
                "--max-filesize",
                "1048576",
                "--user-agent",
                "VibeKarma",
                url,
            ]
            .into_iter()
            .map(std::ffi::OsString::from)
            .collect::<Vec<_>>();
            let mut command = resolver::build_program_command(&curl, &args)?;
            if let Ok(output) = run(&mut command, CHECK_TIMEOUT).await {
                if output.status.success() {
                    if let Ok(version) = latest_from_metadata(&output.stdout) {
                        return Ok(version);
                    }
                }
            }
        }
        Err("无法连接官方 CLI 更新服务".into())
    }
}

fn latest_from_metadata(raw: &[u8]) -> Result<String, String> {
    let metadata: Value =
        serde_json::from_slice(raw).map_err(|_| "官方更新信息无法解析".to_owned())?;
    let value = metadata["tag_name"]
        .as_str()
        .and_then(|tag| tag.strip_prefix("rust-v"))
        .ok_or_else(|| "官方更新信息缺少版本号".to_owned())?;
    let version = parse_version(value)?;
    if !version.pre.is_empty() {
        return Err("官方稳定版更新信息包含预发布版本".into());
    }
    Ok(version.to_string())
}

async fn run(command: &mut Command, limit: Duration) -> Result<Output, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let child = command
        .spawn()
        .map_err(|error| format!("无法启动 CLI 更新检查或更新命令：{error}"))?;
    timeout(limit, child.wait_with_output())
        .await
        .map_err(|_| "CLI 更新检查或更新超时，请检查网络后重新检测版本。".to_owned())?
        .map_err(|error| format!("CLI 更新命令异常结束：{error}"))
}

fn output_detail(output: &Output) -> String {
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    );
    let chars = text.trim().chars().collect::<Vec<_>>();
    chars[chars.len().saturating_sub(1200)..].iter().collect()
}

#[cfg(test)]
mod tests {
    use super::super::resolver::LaunchKind;
    use super::*;

    fn cli(version: &str) -> ResolvedCodex {
        ResolvedCodex {
            path: "test/codex".into(),
            source: CodexSource::ExternalCli,
            launch_kind: LaunchKind::Direct,
            version: Some(version.into()),
        }
    }

    fn temp_root() -> PathBuf {
        let path = std::env::temp_dir().join(format!("vibekarma-updater-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn version_comparison_is_numeric_and_does_not_downgrade_prereleases() {
        assert_eq!(
            update_info(&cli("0.9.0"), None, Ok("0.10.0".into())).status,
            "available"
        );
        assert_eq!(
            update_info(&cli("0.160.1"), None, Ok("0.160.1".into())).status,
            "upToDate"
        );
        assert_eq!(
            update_info(&cli("0.161.0-alpha.1"), None, Ok("0.160.1".into())).status,
            "upToDate"
        );
        assert_eq!(
            update_info(&cli("0.160.1-alpha.1"), None, Ok("0.160.1".into())).status,
            "available"
        );
    }

    #[test]
    fn network_failure_and_unreadable_version_are_not_treated_as_outdated() {
        let offline = update_info(&cli("0.157.1"), None, Err("offline".into()));
        assert_eq!(offline.status, "checkFailed");
        assert!(!offline.can_update);
        assert_eq!(
            update_info(&cli("unknown"), None, Ok("0.160.1".into())).status,
            "unknownVersion"
        );
    }

    #[test]
    fn stable_metadata_rejects_unknown_tags_and_prereleases() {
        assert_eq!(
            latest_from_metadata(br#"{"tag_name":"rust-v0.160.1"}"#).unwrap(),
            "0.160.1"
        );
        assert!(latest_from_metadata(br#"{"tag_name":"rust-v0.161.0-alpha.1"}"#).is_err());
        assert!(latest_from_metadata(br#"{"tag_name":"untrusted"}"#).is_err());
    }

    #[test]
    fn custom_standalone_home_is_detected_without_assuming_user_profile() {
        let root = temp_root();
        let package = root.join("packages/standalone/current");
        let executable = package.join("bin/codex");
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(&executable, "fake").unwrap();
        std::fs::write(
            package.join("codex-package.json"),
            r#"{"variant":"codex","layoutVersion":1}"#,
        )
        .unwrap();
        let mut resolved = cli("0.157.1");
        resolved.path = executable;
        assert_eq!(
            detect_method(&resolved),
            Some(UpdateMethod::Standalone {
                home: normalized_canonical_path(&root).unwrap()
            })
        );
        resolved.source = CodexSource::DesktopBundled;
        assert_eq!(detect_method(&resolved), None);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn npm_prefix_is_explicit_and_unrelated_sibling_cli_is_not_updated() {
        let root = temp_root();
        let package = root.join("node_modules/@openai/codex");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(package.join("package.json"), r#"{"name":"@openai/codex"}"#).unwrap();
        let mut resolved = cli("0.157.1");
        resolved.path = root.join("codex.cmd");
        std::fs::write(&resolved.path, "fake").unwrap();
        assert_eq!(
            detect_method(&resolved),
            Some(UpdateMethod::Npm {
                prefix: normalized_canonical_path(&root).unwrap()
            })
        );
        resolved.path = root.join("unrelated.exe");
        std::fs::write(&resolved.path, "fake").unwrap();
        assert_eq!(detect_method(&resolved), None);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn manually_selected_internal_binaries_never_enable_self_update() {
        let root = temp_root();
        for relative in [
            "Codex.app/Contents/Resources/codex",
            "WindowsApps/OpenAI.Codex/Resources/codex.exe",
        ] {
            let mut resolved = cli("0.157.1");
            resolved.source = CodexSource::UserConfigured;
            resolved.path = root.join(relative);
            std::fs::create_dir_all(resolved.path.parent().unwrap()).unwrap();
            std::fs::write(&resolved.path, "fake").unwrap();
            assert_eq!(detect_method(&resolved), None);
            assert!(unsupported_message(&resolved).contains("桌面客户端"));
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn npm_symlinks_resolve_the_original_prefix_and_adjacent_npm() {
        let root = temp_root();
        let package = root.join("lib/node_modules/@openai/codex");
        std::fs::create_dir_all(package.join("bin")).unwrap();
        std::fs::create_dir_all(root.join("bin")).unwrap();
        std::fs::write(package.join("package.json"), r#"{"name":"@openai/codex"}"#).unwrap();
        std::fs::write(package.join("bin/codex.js"), "fake").unwrap();
        std::fs::write(root.join("bin/npm"), "fake").unwrap();
        std::os::unix::fs::symlink(package.join("bin/codex.js"), root.join("bin/codex")).unwrap();
        let mut resolved = cli("0.157.1");
        resolved.path = root.join("bin/codex");
        assert_eq!(
            detect_method(&resolved),
            Some(UpdateMethod::Npm {
                prefix: normalized_canonical_path(&root).unwrap()
            })
        );
        assert_eq!(find_npm(&root), Some(root.join("bin/npm")));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn cached_release_is_reused_without_network_access() {
        let updater = CliUpdater {
            latest: Mutex::new(Some((Instant::now(), Ok("0.160.1".into())))),
        };
        assert_eq!(updater.latest_version(false).await.unwrap(), "0.160.1");
    }

    fn fake_standalone(root: &Path) -> PathBuf {
        let package = root.join("packages/standalone/current");
        let bin = package.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(
            package.join("codex-package.json"),
            r#"{"variant":"codex","layoutVersion":1}"#,
        )
        .unwrap();
        std::fs::write(bin.join("version.txt"), "codex-cli 0.157.1\n").unwrap();
        #[cfg(windows)]
        let (name, script) = (
            "codex.cmd",
            r#"@echo off
if "%~1"=="--version" (
  type "%~dp0version.txt"
  exit /b 0
)
if "%~2"=="--help" exit /b 0
echo update-attempt> "%~dp0attempt.txt"
if exist "%~dp0fail-update" exit /b 9
if exist "%~dp0wrong-copy" exit /b 0
echo codex-cli 0.160.1> "%~dp0version.txt"
exit /b 0
"#,
        );
        #[cfg(not(windows))]
        let (name, script) = (
            "codex",
            r#"#!/bin/sh
bin="$(dirname "$0")"
if [ "$1" = "--version" ]; then cat "$bin/version.txt"; exit 0; fi
if [ "$2" = "--help" ]; then exit 0; fi
echo update-attempt > "$bin/attempt.txt"
if [ -f "$bin/fail-update" ]; then exit 9; fi
if [ -f "$bin/wrong-copy" ]; then exit 0; fi
echo 'codex-cli 0.160.1' > "$bin/version.txt"
"#,
        );
        let executable = bin.join(name);
        std::fs::write(&executable, script).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        executable
    }

    #[tokio::test]
    async fn update_verifies_the_original_path_and_rejects_failed_or_wrong_copy_updates() {
        for outcome in ["success", "fail-update", "wrong-copy"] {
            let root = temp_root();
            let executable = fake_standalone(&root);
            if outcome != "success" {
                std::fs::write(executable.parent().unwrap().join(outcome), "test").unwrap();
            }
            let settings = AppSettings {
                codex_path: Some(executable.to_string_lossy().into_owned()),
                ..Default::default()
            };
            let updater = CliUpdater {
                latest: Mutex::new(Some((Instant::now(), Ok("0.160.1".into())))),
            };
            let changed = updater
                .apply(&settings, "different/codex", "0.157.1", &root.join("cache"))
                .await;
            assert!(changed.unwrap_err().contains("路径或版本已变化"));
            assert!(!executable.parent().unwrap().join("attempt.txt").exists());
            let result = updater
                .apply(
                    &settings,
                    settings.codex_path.as_deref().unwrap(),
                    "0.157.1",
                    &root.join("cache"),
                )
                .await;
            match outcome {
                "success" => assert_eq!(result.unwrap().version.as_deref(), Some("0.160.1")),
                "fail-update" => assert!(result.unwrap_err().contains("更新失败")),
                _ => assert!(result.unwrap_err().contains("尚未达到目标版本")),
            }
            std::fs::remove_dir_all(root).unwrap();
        }
    }
}
