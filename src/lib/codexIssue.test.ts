import { describe, expect, it } from "vitest";
import { CODEX_SUPPORT_PROMPT_MARKER, parseCodexIssue } from "./codexIssue";

describe("parseCodexIssue", () => {
  it("keeps the short summary separate from the copyable repair prompt", () => {
    const issue = parseCodexIssue(
      `检测到内部 CLI，但 Windows 阻止了启动。\n\n${CODEX_SUPPORT_PROMPT_MARKER}\n请安装外部 CLI 并完成验证。`,
    );
    expect(issue.summary).toBe("检测到内部 CLI，但 Windows 阻止了启动。");
    expect(issue.prompt).toBe("请安装外部 CLI 并完成验证。");
    expect(issue.prompt).not.toContain(CODEX_SUPPORT_PROMPT_MARKER);
    expect(issue.copyable).toBe(true);
  });

  it("uses an ordinary error as both summary and copy text", () => {
    expect(parseCodexIssue("  普通错误  ")).toEqual({
      summary: "普通错误",
      prompt: "普通错误",
      copyable: false,
    });
  });
});
