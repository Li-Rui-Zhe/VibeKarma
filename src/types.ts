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
}

export type FeedbackKind = "reward" | "correction";

export interface FeedbackRequest {
  kind: FeedbackKind;
  reason: string;
}

export interface FeedbackReceipt {
  delivery: "silent";
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

export interface CodexLogEvent {
  level: string;
  message: string;
}
