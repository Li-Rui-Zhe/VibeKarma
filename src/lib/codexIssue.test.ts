import { describe, expect, it } from "vitest";
import { cliUpdateFailure, CODEX_SUPPORT_PROMPT_MARKER, codexIssueGuide, parseCodexIssue } from "./codexIssue";

describe("parseCodexIssue", () => {
  it("keeps the short summary separate from the copyable repair prompt", () => {
    const issue = parseCodexIssue(
      `检测到内部 CLI，但 Windows 阻止了启动。\n\n${CODEX_SUPPORT_PROMPT_MARKER}\n请安装外部 CLI 并完成验证。`,
    );
    expect(issue.summary).toBe("检测到内部 CLI，但 Windows 阻止了启动。");
    expect(issue.prompt).toBe("请安装外部 CLI 并完成验证。");
    expect(issue.prompt).not.toContain(CODEX_SUPPORT_PROMPT_MARKER);
    expect(issue.copyable).toBe(true);
    expect(issue.kind).toBe("setup");
  });

  it("uses an ordinary error as both summary and copy text", () => {
    expect(parseCodexIssue("  普通错误  ")).toEqual({
      summary: "普通错误",
      prompt: "普通错误",
      copyable: false,
      kind: "internal",
    });
  });

  it("shows model compatibility advice and keeps fatal details in the copyable prompt", () => {
    const issue = parseCodexIssue(
      `[VIBEKARMA_CODEX_ISSUE:model]\n当前模型无法使用。\n\nCLI 版本：0.157.1\n\n${CODEX_SUPPORT_PROMPT_MARKER}\n请检查更新。\nERROR: gpt-6.1-sol is not supported`,
    );
    expect(issue.kind).toBe("model");
    expect(issue.summary).toContain("0.157.1");
    expect(issue.summary).not.toContain("VIBEKARMA");
    expect(issue.prompt).toContain("gpt-6.1-sol");
    expect(codexIssueGuide(issue.kind).action).toContain("更新实际调用的 CLI");
  });

  it("keeps network guidance distinct from installation and update guidance", () => {
    const issue = parseCodexIssue(
      `[VIBEKARMA_CODEX_ISSUE:network]\n请求超时。\n\n${CODEX_SUPPORT_PROMPT_MARKER}\n检查网络。`,
    );
    expect(issue.kind).toBe("network");
    expect(codexIssueGuide(issue.kind).title).toBe("Codex 连接遇到问题");
    expect(codexIssueGuide(issue.kind).action).toContain("网络和代理");
  });
});

describe("CLI update recovery", () => {
  it("makes network and wrong-copy errors copyable with the original update target", () => {
    const update = {
      path: "D:\\Codex A\\codex.exe", currentVersion: "0.157.1", latestVersion: "0.162.1",
      status: "available" as const, canUpdate: true, method: "官方独立安装", message: "有新版本",
    };
    for (const error of ["request timed out", "更新命令已经结束，但实际调用的 CLI 尚未达到目标版本"]) {
      const issue = parseCodexIssue(cliUpdateFailure(error, {
        available: true, source: "externalCli", path: "D:\\Codex B\\codex.exe", version: "0.160.1",
        updateHelp: null, message: "", // Re-detection must not replace the original failed target.
      }, update));
      expect(issue.kind).toBe("updateFailure");
      expect(issue.copyable).toBe(true);
      expect(issue.prompt).toContain(update.path);
      expect(issue.prompt).not.toContain("Codex B");
      expect(issue.prompt).toContain("0.157.1");
      expect(issue.prompt).toContain("0.162.1");
      expect(issue.prompt).toContain(error);
      expect(issue.prompt).toContain("代理");
      expect(issue.prompt).toContain("不要直接替换内部文件");
      expect(codexIssueGuide(issue.kind).title).toBe("CLI 更新未完成");
    }
  });

  it("offers repair instructions even when discovery fails, and hides credentials in logs", () => {
    const issue = parseCodexIssue(cliUpdateFailure(
      "无法连接 https://user:pass@example.com; Authorization: Bearer secret-token; api_key=sk-project-private; refresh_token=refresh-secret",
      null, null,
    ));
    expect(issue.copyable).toBe(true);
    expect(issue.prompt).toContain("未能获取");
    for (const secret of ["user:pass", "secret-token", "sk-project-private", "refresh-secret"]) {
      expect(issue.prompt).not.toContain(secret);
      expect(issue.summary).not.toContain(secret);
    }
  });
});
