export type SessionStatus = "disconnected" | "connecting" | "idle" | "working" | "error";

export interface AppSettings {
  workspace: string | null;
  codexPath: string | null;
  codexHome: string | null;
  extraEnv: Record<string, string>;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy: "untrusted" | "on-request" | "never";
  lastThreadId: string | null;
  lastThreadWorkspace: string | null;
}

export interface SessionSnapshot {
  connected: boolean;
  status: SessionStatus;
  threadId: string | null;
  activeTurnId: string | null;
  workspace: string | null;
  lastError: string | null;
}

export interface DiaryEntry {
  id: string;
  createdAt: string;
  kind: string;
  title: string;
  body: string;
  reason: string | null;
  path: string;
  threadId: string | null;
  turnId: string | null;
  generatedByCodex: boolean;
}

export interface AppSnapshot {
  settings: AppSettings;
  session: SessionSnapshot;
  diaries: DiaryEntry[];
  dataDir: string;
}

export type FeedbackKind = "reward" | "correction";

export interface FeedbackRequest {
  kind: FeedbackKind;
  reason: string;
}

export interface FeedbackReceipt {
  delivery: "steered" | "newTurn" | "silent";
  threadId: string;
  turnId: string | null;
  diaryQueued: boolean;
}

export interface CodexWindowInfo {
  ok: boolean;
  found: boolean;
  handle: number;
  processId: number;
  left: number;
  top: number;
  width: number;
  height: number;
  working: boolean;
  editorFound: boolean;
  editorHasDraft: boolean;
  error: string | null;
}

export interface OverlayAction {
  kind: FeedbackKind;
  x: number;
  y: number;
}

export interface CodexUiEvent {
  method: string;
  params: Record<string, unknown>;
}

export interface CodexLogEvent {
  level: string;
  message: string;
}

export interface ServerRequestEvent {
  requestId: string | number;
  method: string;
  params: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  streaming?: boolean;
}

export interface ActivityItem {
  id: string;
  type: "command" | "file" | "tool" | "search" | "system";
  title: string;
  detail: string;
  status: "running" | "completed" | "failed" | "waiting";
  timestamp: string;
}
