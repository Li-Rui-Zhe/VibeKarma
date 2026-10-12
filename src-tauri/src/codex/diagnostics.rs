use super::resolver::{CodexSource, ResolvedCodex};

const SUPPORT_MARKER: &str = "[VIBEKARMA_CODEX_SUPPORT_PROMPT]";

#[derive(Debug, PartialEq, Eq)]
enum FailureKind {
    Model,
    Network,
    Authentication,
    Compatibility,
    Other,
}

impl FailureKind {
    fn code(&self) -> &'static str {
        match self {
            Self::Model => "model",
            Self::Network => "network",
            Self::Authentication => "authentication",
            Self::Compatibility => "compatibility",
            Self::Other => "execution",
        }
    }

    fn summary(&self) -> &'static str {
        match self {
            Self::Model => "当前模型无法使用。可能是 CLI 版本与模型不兼容，也可能是模型名称、账号权限或 Provider 配置问题。请先检查并更新实际调用的 CLI。",
            Self::Network => "Codex 请求超时或连接失败。请先检查网络、代理和服务状态；仅凭超时不能判断 CLI 版本过旧。",
            Self::Authentication => "Codex 登录或授权失败。请检查实际调用的 CLI 使用的登录状态和 Provider 配置。",
            Self::Compatibility => "Codex CLI 不支持当前调用参数。请更新实际调用的 CLI 后重试。",
            Self::Other => "Codex CLI 执行失败，暂时无法确定原因。请检查错误详情；若近期切换了新模型，可先检查 CLI 更新。",
        }
    }
}

fn classify(stderr: &str, stdout: &str) -> FailureKind {
    let text = format!("{stderr}\n{stdout}").to_ascii_lowercase();
    // A model-list refresh warning can precede the actual fatal model error.
    if [
        "model_not_found",
        "unsupported model",
        "unknown model",
        "invalid model",
        "model is not supported",
        "model isn't supported",
        "model not supported",
        "does not support the model",
        "not supported with your",
        "not supported when",
    ]
    .iter()
    .any(|pattern| text.contains(pattern))
        || text.lines().any(|line| {
            line.contains("model")
                && (line.contains("does not exist")
                    || line.contains("do not have access")
                    || line.contains("don't have access"))
        })
    {
        return FailureKind::Model;
    }
    if [
        "401 unauthorized",
        "403 forbidden",
        "authentication_error",
        "invalid_api_key",
        "token_expired",
        "refresh_token",
        "please log in",
        "not logged in",
        "login required",
    ]
    .iter()
    .any(|pattern| text.contains(pattern))
    {
        return FailureKind::Authentication;
    }
    if [
        "unexpected argument",
        "unrecognized option",
        "unknown option",
        "unknown flag",
    ]
    .iter()
    .any(|pattern| text.contains(pattern))
    {
        return FailureKind::Compatibility;
    }
    if [
        "timed out",
        "timeout",
        "connection reset",
        "connection refused",
        "error sending request",
        "failed to connect",
        "dns error",
        "network is unreachable",
    ]
    .iter()
    .any(|pattern| text.contains(pattern))
    {
        return FailureKind::Network;
    }
    FailureKind::Other
}

pub(super) fn execution_failure(
    resolved: &ResolvedCodex,
    stderr: &str,
    stdout: &str,
    exit_status: &str,
) -> String {
    let kind = classify(stderr, stdout);
    // Keep both ends: the CLI banner is at the start, the fatal error is often at the end.
    let detail = format!("退出状态：{exit_status}\n{}", diagnostic_excerpt(stderr));
    let stdout_errors = stdout
        .lines()
        .filter(|line| {
            let line = line.trim().to_ascii_lowercase();
            line.starts_with("error:") || line.contains("\"type\":\"error\"")
        })
        .collect::<Vec<_>>()
        .join("\n");
    let detail = if stdout_errors.is_empty() {
        detail
    } else {
        format!("{detail}\n{}", diagnostic_excerpt(&stdout_errors))
    };
    format_help(kind.code(), kind.summary(), resolved, &detail)
}

pub(super) fn timeout_failure(resolved: &ResolvedCodex) -> String {
    format_help(
        "network",
        "日记生成超过 5 分钟，已停止等待。请检查网络、代理和 CLI 服务状态。",
        resolved,
        "VibeKarma 等待 Codex CLI 超时。",
    )
}

pub(super) fn update_help(resolved: &ResolvedCodex) -> String {
    format_help("update", "使用新模型前，建议检查并更新实际调用的 Codex CLI。更新后点击重新检测即可，无需重启 VibeKarma。", resolved, "用户主动检查 CLI 更新；尚未确认版本过旧。")
}

fn format_help(code: &str, summary: &str, resolved: &ResolvedCodex, detail: &str) -> String {
    let version = resolved.version.as_deref().unwrap_or("未能读取版本");
    let source = resolved.source.label();
    let path = resolved.path.display();
    let update = if resolved.source == CodexSource::DesktopBundled {
        "当前调用的是桌面客户端内部 CLI。请更新 Codex 桌面客户端，或安装官方外部 CLI 并在 VibeKarma 中重新检测；不要直接替换应用内部文件。"
    } else {
        "先确认这一路径对应的安装方式，再使用相同方式更新到官方稳定版。npm 安装可用 `npm install -g @openai/codex@latest`；Homebrew 安装可用 `brew update` 和 `brew upgrade --cask codex`；独立安装请按官方文档更新。不要对不同安装方式重复安装。"
    };
    let action = match code {
        "network" => "优先检查网络、代理和服务状态，不要仅因超时就重装 CLI。若近期切换新模型，再检查 CLI 更新。",
        "authentication" => "优先检查这一路径的 CLI 登录状态，以及 VibeKarma 使用的 CODEX_HOME 和 Provider 配置。不要输出密钥或登录凭据。",
        "model" => "检查 CLI 更新及错误中的模型名称；若更新后仍失败，继续检查模型是否存在、账号是否有权访问、Provider 是否支持。不要擅自更换模型或改写用户配置。",
        "compatibility" | "update" => "检查并更新实际调用的 CLI，不要擅自更换模型或改写用户配置。",
        _ => "根据错误详情定位原因；若与新模型有关，先检查 CLI 更新。不要擅自更换模型或改写用户配置。",
    };
    format!(
        "[VIBEKARMA_CODEX_ISSUE:{code}]\n{summary}\n\nCLI 版本：{version}\n来源：{source}\n路径：{path}\n\n{SUPPORT_MARKER}\n我在使用 VibeKarma，请帮助检查 Codex CLI。\n\n{summary}\nCLI 版本：{version}\n来源：{source}\n实际调用路径：{path}\n\n1. {action}\n2. 如需更新：{update}\n3. 对上面实际调用的路径运行 `--version` 和 `exec --help`，确认更新生效，避免只更新了 PATH 中的另一份 CLI。\n4. 回到 VibeKarma 点击“重新检测”；有失败日记时点击“重试日记”，无需重新奖惩。失败任务仅保留在本次应用运行期间。\n\n官方文档：https://developers.openai.com/codex/cli/\n\n错误详情：\n{detail}"
    )
}

fn diagnostic_excerpt(value: &str) -> String {
    let chars = value.trim().chars().collect::<Vec<_>>();
    if chars.len() <= 4_000 {
        return chars.into_iter().collect();
    }
    format!(
        "{}\n…（中间日志省略）…\n{}",
        chars[..1_000].iter().collect::<String>(),
        chars[chars.len() - 3_000..].iter().collect::<String>()
    )
}

#[cfg(test)]
mod tests {
    use super::super::resolver::LaunchKind;
    use super::*;

    fn cli() -> ResolvedCodex {
        ResolvedCodex {
            path: "test/codex".into(),
            source: CodexSource::ExternalCli,
            launch_kind: LaunchKind::Direct,
            version: Some("0.157.1".into()),
        }
    }

    #[test]
    fn fatal_model_error_after_refresh_timeout_takes_priority() {
        let stderr = format!("failed to refresh available models: request timed out\nOpenAI Codex v0.157.1\n{}\nERROR: The 'gpt-6.1-sol' model is not supported with your account.", "banner\n".repeat(900));
        let message = execution_failure(&cli(), &stderr, "", "exit code: 1");
        assert!(message.contains("ISSUE:model]"));
        assert!(message.contains("gpt-6.1-sol"));
        assert!(message.contains("0.157.1"));
        assert!(message.contains("test/codex"));
        assert!(message.contains("npm install -g @openai/codex@latest"));
    }

    #[test]
    fn timeout_alone_does_not_assert_old_cli() {
        assert_eq!(
            classify("failed to refresh available models: request timed out", ""),
            FailureKind::Network
        );
        let message = execution_failure(&cli(), "request timed out", "", "1");
        assert!(message.contains("仅凭超时不能判断 CLI 版本过旧"));
    }

    #[test]
    fn authentication_and_arguments_have_separate_actions() {
        assert_eq!(
            classify("401 Unauthorized", ""),
            FailureKind::Authentication
        );
        assert_eq!(
            classify("error: unexpected argument '--ephemeral' found", ""),
            FailureKind::Compatibility
        );
        assert_eq!(
            classify("model: gpt-6.1-sol", "unrelated error"),
            FailureKind::Other
        );
        assert_eq!(
            classify("", "ERROR: model does not exist"),
            FailureKind::Model
        );
    }

    #[test]
    fn desktop_update_help_does_not_recommend_modifying_bundled_cli() {
        let mut resolved = cli();
        resolved.source = CodexSource::DesktopBundled;
        let message = update_help(&resolved);
        assert!(message.contains("请更新 Codex 桌面客户端"));
        assert!(!message.contains("npm install -g"));
    }
}
