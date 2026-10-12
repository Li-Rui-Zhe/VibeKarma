import type { CodexCliInfo, CodexCliUpdateInfo } from "../types";

export const CODEX_SUPPORT_PROMPT_MARKER = "[VIBEKARMA_CODEX_SUPPORT_PROMPT]";

export interface CodexIssueText {
  summary: string;
  prompt: string;
  copyable: boolean;
  kind: "model" | "network" | "authentication" | "compatibility" | "execution" | "update" | "updateFailure" | "setup" | "internal";
}

export function parseCodexIssue(value: string): CodexIssueText {
  const category = value.match(/\[VIBEKARMA_CODEX_ISSUE:(model|network|authentication|compatibility|execution|update|updateFailure)\]\n?/);
  const kind = category?.[1] as CodexIssueText["kind"] | undefined;
  if (category) value = value.replace(category[0], "");
  const marker = `\n\n${CODEX_SUPPORT_PROMPT_MARKER}\n`;
  const index = value.indexOf(marker);
  if (index < 0) {
    const text = value.trim();
    return { summary: text, prompt: text, copyable: false, kind: kind ?? "internal" };
  }
  return {
    summary: value.slice(0, index).trim(),
    prompt: value.slice(index + marker.length).trim(),
    copyable: true,
    kind: kind ?? "setup",
  };
}

export function cliUpdateFailure(
  error: string,
  cli: CodexCliInfo | null,
  update: CodexCliUpdateInfo | null,
): string {
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const source = cli?.source === "desktopBundled" ? "桌面客户端内置 CLI"
    : cli?.source === "userConfigured" ? "手动指定 CLI" : cli?.source === "externalCli" ? "外部 CLI" : "尚未确认";
  const details = redactCredentials(parseCodexIssue(error).summary);
  const context = [
    `操作系统：${/Macintosh|Mac OS X/i.test(userAgent) ? "macOS" : /Windows/i.test(userAgent) ? "Windows" : "其他"}`,
    `来源：${source}`,
    `实际调用路径：${update?.path ?? cli?.path ?? "未能获取，请在 VibeKarma 设置中重新检测"}`,
    `更新前版本：${update?.currentVersion ?? cli?.version ?? "未能读取"}`,
    `目标版本：${update?.latestVersion ?? "未能获取"}`,
    `安装方式：${update?.method ?? "尚未确认，请先核实"}`,
  ].join("\n");
  const summary = `CLI 更新未完成。失败日记仍保留在本次运行中，可以修复后重试。\n\n${details}`;
  const prompt = `我在使用 VibeKarma，一键更新 Codex CLI 失败，请帮我在这台电脑上排查并修复。\n\n${context}\n\n错误详情：\n${details}\n\n请按以下步骤处理：\n1. 核实上述实际路径、安装方式和当前版本，检查网络、代理、下载服务以及安装目录权限。浏览器能访问不代表更新命令也能访问；需要代理时请确认命令使用了正确的代理。\n2. 外部 CLI 按原安装方式更新；如果路径属于 Codex 桌面客户端内部，请更新桌面客户端或配置外部 CLI，不要直接替换内部文件。不要只更新 PATH 中的另一份 CLI。\n3. 对实际路径运行 --version 和 exec --help 验证。不要擅自切换模型、改写 Provider 或输出密钥、登录凭据。\n4. 修复后让我回到 VibeKarma 点击“重新检测”，再点击“重试日记”；无需重新奖惩。待重试任务仅保留在本次应用运行期间。`;
  return `[VIBEKARMA_CODEX_ISSUE:updateFailure]\n${summary}\n\n${CODEX_SUPPORT_PROMPT_MARKER}\n${redactCredentials(prompt)}`;
}

function redactCredentials(value: string): string {
  return value
    .replace(/\bsk-[a-zA-Z0-9_-]+/g, "[已隐藏密钥]")
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi, "$1[已隐藏]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[=:]\s*["']?)[^\s"'&,;]+/gi, "$1[已隐藏]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[已隐藏凭据]@");
}

export function codexIssueGuide(kind: CodexIssueText["kind"]) {
  switch (kind) {
    case "model":
      return { title: "检查模型与 CLI 版本", action: "先更新实际调用的 CLI；仍失败时检查模型权限和 Provider。" };
    case "compatibility":
      return { title: "Codex CLI 需要更新", action: "更新实际调用的 CLI 后重新检测，再重试日记。" };
    case "network":
      return { title: "Codex 连接遇到问题", action: "先检查网络和代理，恢复后重试日记。超时也可能与模型列表刷新有关。" };
    case "authentication":
      return { title: "检查 Codex 登录状态", action: "检查当前 CLI 的登录状态和 Provider 配置。" };
    case "update":
      return { title: "Codex CLI 更新帮助", action: "按原安装方式更新。更新后重新检测即可，无需重启应用。" };
    case "updateFailure":
      return { title: "CLI 更新未完成", action: "检查网络或安装路径，也可以复制下面的说明，让 Codex 帮你修复。" };
    case "execution":
      return { title: "Codex 日记生成失败", action: "复制解决提示查看关键日志；使用新模型时建议检查 CLI 更新。" };
    case "setup":
      return { title: "Codex CLI 需要处理", action: "复制解决提示，让 Codex 帮你完成安装或修复。" };
    default:
      return { title: "日记或应用遇到问题", action: "可以重新检测；有失败日记时可直接重试。" };
  }
}
