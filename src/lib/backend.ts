import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppSettings,
  AppSnapshot,
  CodexCliInfo,
  CodexLogEvent,
  CodexWindowInfo,
  DiaryEntry,
  FeedbackReceipt,
  FeedbackRequest,
  FeedbackKind,
  OverlayAction,
} from "../types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isTauriRuntime = (): boolean => Boolean(window.__TAURI_INTERNALS__);

const demoDiaries: DiaryEntry[] = [
  {
    id: "demo-diary-1",
    createdAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    kind: "奖励日记",
    title: "奖励日记：这次我记得先验证了",
    body:
      "今天我没有急着宣布完成，而是先把构建和测试都跑了一遍。看到结果安稳落地后，我才把结论交出去。\n\n这次奖励让我确认了一件事：谨慎并不会拖慢合作，反而省去了来回返工。我会继续保留这种节奏，先做事实检查，再给明确答复。",
    reason: "验证充分",
    path: "D:\\VibeKarmaData\\vibekarma.sqlite3",
    threadId: "demo-thread",
    turnId: "demo-turn",
    generatedByCodex: true,
  },
  {
    id: "demo-diary-2",
    createdAt: new Date(Date.now() - 1000 * 60 * 84).toISOString(),
    kind: "挨打日记",
    title: "挨打日记：我不该把范围越做越大",
    body:
      "今天我本来只需要修一个边界判断，却顺手整理起了旁边的模块。那一刻我把主动性用错了地方。\n\n用户提醒得很及时。我应该先守住明确的任务边界，把必要改动做稳，再讨论额外优化。接下来我会先收窄差异，只留下真正服务于问题的修改。",
    reason: "改动范围太大",
    path: "D:\\VibeKarmaData\\vibekarma.sqlite3",
    threadId: "demo-thread",
    turnId: "demo-turn-2",
    generatedByCodex: true,
  },
];

const demoSnapshot: AppSnapshot = {
  settings: {
    codexPath: null,
    codexHome: null,
    extraEnv: {},
  },
  diaries: demoDiaries,
  dataDir: "D:\\VibeKarmaData",
};

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

export const backend = {
  async snapshot(): Promise<AppSnapshot> {
    return isTauriRuntime() ? call<AppSnapshot>("get_app_snapshot") : structuredClone(demoSnapshot);
  },

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    return isTauriRuntime() ? call<AppSettings>("save_settings", { settings }) : settings;
  },

  async inspectCodexCli(): Promise<CodexCliInfo> {
    return isTauriRuntime()
      ? call<CodexCliInfo>("inspect_codex_cli")
      : {
          available: true,
          source: "externalCli",
          path: IS_DEMO_MACOS ? "/opt/homebrew/bin/codex" : "C:\\Users\\demo\\AppData\\Roaming\\npm\\codex.cmd",
          message: "正在使用：外部 Codex CLI（推荐）",
        };
  },

  async inspectCodexWindow(): Promise<CodexWindowInfo> {
    return isTauriRuntime()
      ? call<CodexWindowInfo>("inspect_codex_window")
      : {
          ok: true,
          found: true,
          handle: 1,
          processId: 1,
          left: 120,
          top: 80,
          width: 1280,
          height: 760,
          working: false,
          editorFound: true,
          editorHasDraft: false,
          error: null,
        };
  },

  async armCodexOverlay(kind: FeedbackKind, target: CodexWindowInfo): Promise<CodexWindowInfo> {
    return isTauriRuntime()
      ? call<CodexWindowInfo>("arm_codex_overlay", { kind, target })
      : this.inspectCodexWindow();
  },

  async recordDesktopFeedback(feedback: FeedbackRequest): Promise<FeedbackReceipt> {
    return isTauriRuntime()
      ? call<FeedbackReceipt>("record_desktop_feedback", { feedback })
      : {
          delivery: "silent",
          threadId: "desktop-preview",
          turnId: null,
          diaryQueued: true,
        };
  },

  async setWindowMode(mode: "compact" | "diary"): Promise<void> {
    if (isTauriRuntime()) await call<void>("set_main_window_mode", { mode });
  },

};

const IS_DEMO_MACOS = /Macintosh|Mac OS X/i.test(navigator.userAgent);

export async function subscribeOverlayAction(
  handler: (payload: OverlayAction) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return listen<OverlayAction>("overlay-action", (event) => handler(event.payload));
}

export async function subscribeOverlayCancel(handler: () => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return listen<null>("overlay-cancel", handler);
}

export async function subscribeBackendEvents(handlers: {
  onDiary: (payload: DiaryEntry) => void;
  onDiaryStart: (kind: string) => void;
  onLog: (payload: CodexLogEvent) => void;
}): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  const unlisteners = await Promise.all([
    listen<DiaryEntry>("diary-created", (event) => handlers.onDiary(event.payload)),
    listen<string>("diary-generation-started", (event) => handlers.onDiaryStart(event.payload)),
    listen<CodexLogEvent>("codex-log", (event) => handlers.onLog(event.payload)),
  ]);
  return () => unlisteners.forEach((unlisten) => unlisten());
}
