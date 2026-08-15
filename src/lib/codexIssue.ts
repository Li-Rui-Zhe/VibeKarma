export const CODEX_SUPPORT_PROMPT_MARKER = "[VIBEKARMA_CODEX_SUPPORT_PROMPT]";

export interface CodexIssueText {
  summary: string;
  prompt: string;
  copyable: boolean;
}

export function parseCodexIssue(value: string): CodexIssueText {
  const marker = `\n\n${CODEX_SUPPORT_PROMPT_MARKER}\n`;
  const index = value.indexOf(marker);
  if (index < 0) {
    const text = value.trim();
    return { summary: text, prompt: text, copyable: false };
  }
  return {
    summary: value.slice(0, index).trim(),
    prompt: value.slice(index + marker.length).trim(),
    copyable: true,
  };
}
