export interface AppSettings {
  codexPath: string | null;
  codexHome: string | null;
  extraEnv: Record<string, string>;
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
  diaries: DiaryEntry[];
  dataDir: string;
  failedDiaryCount: number;
}

export type FeedbackKind = "reward" | "correction";

export interface FeedbackRequest {
  kind: FeedbackKind;
  reason: string;
}

export interface CodexCliInfo {
  available: boolean;
  source: "userConfigured" | "externalCli" | "desktopBundled" | null;
  path: string | null;
  version: string | null;
  updateHelp: string | null;
  message: string;
}

export interface CodexCliUpdateInfo {
  path: string | null;
  currentVersion: string | null;
  latestVersion: string | null;
  status: "unavailable" | "checkFailed" | "upToDate" | "available" | "unknownVersion";
  canUpdate: boolean;
  method: string | null;
  message: string;
}

export interface CodexCliUpdateResult {
  cli: CodexCliInfo;
  retriedCount: number;
}

export interface FeedbackReceipt {
  delivery: "silent";
  threadId: string;
  turnId: string | null;
  diaryQueued: boolean;
  contextWarning?: string | null;
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
  contextWarning?: string | null;
  error: string | null;
}

export interface OverlayAction {
  kind: FeedbackKind;
  x: number;
  y: number;
}

export interface CodexLogEvent {
  level: string;
  message: string;
}

export interface DiaryGenerationFailure {
  message: string;
  pendingCount: number;
}
