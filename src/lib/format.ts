import type { ActivityItem } from "../types";

export function formatClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDiaryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function shortPath(path: string | null): string {
  if (!path) return "未选择项目";
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join("/")}`;
}

export function parseExtraEnv(text: string): Record<string, string> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .reduce<Record<string, string>>((result, line) => {
      const separator = line.indexOf("=");
      if (separator <= 0) return result;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (key) result[key] = value;
      return result;
    }, {});
}

export function stringifyExtraEnv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function activityFromItem(item: Record<string, unknown>): ActivityItem | null {
  const id = String(item.id ?? crypto.randomUUID());
  const timestamp = new Date().toISOString();
  const statusValue = String(item.status ?? "inProgress");
  const status: ActivityItem["status"] =
    statusValue === "failed" || statusValue === "declined"
      ? "failed"
      : statusValue === "inProgress"
        ? "running"
        : "completed";

  switch (item.type) {
    case "commandExecution":
      return {
        id,
        type: "command",
        title: String(item.command ?? "正在执行命令"),
        detail: String(item.aggregatedOutput ?? item.output ?? ""),
        status,
        timestamp,
      };
    case "fileChange": {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const files = changes
        .map((change) =>
          typeof change === "object" && change !== null && "path" in change
            ? String(change.path)
            : "",
        )
        .filter(Boolean);
      return {
        id,
        type: "file",
        title: files.length ? `修改 ${files.length} 个文件` : "文件变更",
        detail: files.join("\n"),
        status,
        timestamp,
      };
    }
    case "mcpToolCall":
    case "dynamicToolCall":
      return {
        id,
        type: "tool",
        title: `${String(item.server ?? "Tool")}/${String(item.tool ?? "unknown")}`,
        detail: JSON.stringify(item.arguments ?? {}, null, 2),
        status,
        timestamp,
      };
    case "webSearch":
      return {
        id,
        type: "search",
        title: "网页搜索",
        detail: String(item.query ?? ""),
        status,
        timestamp,
      };
    default:
      return null;
  }
}

