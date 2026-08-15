import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import {
  Check,
  Copy,
  FolderOpen,
  LoaderCircle,
  MessageSquareText,
  Minus,
  RefreshCw,
  Settings2,
  X,
} from "lucide-react";
import whipReference from "./assets/feedback-whip-reference.png";
import { Brand } from "./components/Brand";
import { DiaryBook } from "./components/DiaryBook";
import { DrawPieIcon } from "./components/DrawPieIcon";
import { DiaryTraceIcon, WorkPulseIcon } from "./components/EditorialIcons";
import {
  backend,
  isTauriRuntime,
  subscribeBackendEvents,
  subscribeOverlayAction,
  subscribeOverlayCancel,
} from "./lib/backend";
import { parseCodexIssue } from "./lib/codexIssue";
import type {
  AppSnapshot,
  CodexCliInfo,
  CodexWindowInfo,
  DiaryEntry,
  FeedbackKind,
  FeedbackRequest,
} from "./types";

type View = "control" | "diary";

const SNAPSHOT_TIMEOUT_MS = 5_000;
const SNAPSHOT_ATTEMPTS = 3;
const IS_MACOS = /Macintosh|Mac OS X/i.test(navigator.userAgent);

function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [codexWindow, setCodexWindow] = useState<CodexWindowInfo | null>(null);
  const [view, setView] = useState<View>("control");
  const [feedbackHint, setFeedbackHint] = useState("");
  const [detecting, setDetecting] = useState(true);
  const [busy, setBusy] = useState<"arming" | "overlay" | "feedback" | null>(null);
  const [reflectionCount, setReflectionCount] = useState(0);
  const [actionPulse, setActionPulse] = useState<FeedbackKind | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPath, setSettingsPath] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [cliInfo, setCliInfo] = useState<CodexCliInfo | null>(null);
  const [cliChecking, setCliChecking] = useState(true);
  const [cliError, setCliError] = useState<string | null>(null);
  const feedbackHintRef = useRef("");
  const actionPulseTimerRef = useRef<number | null>(null);
  const cliFailurePromptedRef = useRef(false);

  const refreshWindow = useCallback(async () => {
    setDetecting(true);
    try {
      setCodexWindow(await backend.inspectCodexWindow());
    } catch (error) {
      setCodexWindow(emptyWindow(String(error)));
    } finally {
      setDetecting(false);
    }
  }, []);

  const loadSnapshot = useCallback(async () => {
    setBootError(null);
    try {
      const nextSnapshot = await loadSnapshotWithRetry();
      setSnapshot(nextSnapshot);
      setSettingsPath(nextSnapshot.settings.codexPath ?? "");
    } catch (error) {
      setBootError(`初始化失败：${String(error)}`);
    }
  }, []);

  const refreshCliInfo = useCallback(async (showFailure = false) => {
    setCliChecking(true);
    try {
      const info = await backend.inspectCodexCli();
      setCliInfo(info);
      if (info.available) {
        cliFailurePromptedRef.current = false;
      } else if (showFailure && !cliFailurePromptedRef.current) {
        cliFailurePromptedRef.current = true;
        setCliError(info.message);
      }
    } catch (error) {
      const message = String(error);
      setCliInfo({
        available: false,
        source: null,
        path: null,
        message,
      });
      if (showFailure && !cliFailurePromptedRef.current) {
        cliFailurePromptedRef.current = true;
        setCliError(message);
      }
    } finally {
      setCliChecking(false);
    }
  }, []);

  const deliverFeedback = useCallback(async (kind: FeedbackKind) => {
    const reason = feedbackHintRef.current.trim();
    setBusy("feedback");
    try {
      const feedback: FeedbackRequest = { kind, reason };
      await backend.recordDesktopFeedback(feedback);
      if (!isTauriRuntime()) {
        setSnapshot((current) => appendPreviewDiary(current, feedback));
      }
      feedbackHintRef.current = "";
      setFeedbackHint("");
      showToast(setToast, "已静默留痕，Codex 正在写日记");
    } catch (error) {
      showToast(setToast, String(error));
    } finally {
      setBusy(null);
      void refreshWindow();
    }
  }, [refreshWindow]);

  useEffect(() => {
    let alive = true;
    void loadSnapshot();
    void refreshWindow();
    void refreshCliInfo(true);
    const timer = window.setInterval(() => {
      if (alive && view === "control") void refreshWindow();
    }, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [loadSnapshot, refreshCliInfo, refreshWindow, view]);

  useEffect(() => {
    let alive = true;
    let unlistenOverlay: () => void = () => undefined;
    let unlistenOverlayCancel: () => void = () => undefined;
    let unlistenBackend: () => void = () => undefined;
    void subscribeOverlayAction((action) => {
      if (!alive) return;
      void deliverFeedback(action.kind);
    }).then((unlisten) => {
      unlistenOverlay = unlisten;
    });
    void subscribeOverlayCancel(() => {
      if (!alive) return;
      setBusy(null);
      void refreshWindow();
    }).then((unlisten) => {
      unlistenOverlayCancel = unlisten;
    });
    void subscribeBackendEvents({
      onDiaryStart: () => {
        if (alive) setReflectionCount((count) => count + 1);
      },
      onLog: (log) => {
        if (alive && log.level === "error") {
          if (log.message.includes("日记")) setReflectionCount(0);
          const cliFailure = /Codex CLI|无法启动 Codex|没有找到可用的 Codex/.test(log.message);
          if (cliFailure) {
            setCliError(log.message);
          }
          showToast(setToast, cliFailure ? "Codex CLI 需要处理，请查看错误提示" : log.message);
        }
      },
      onDiary: (diary) => {
        if (!alive) return;
        setReflectionCount((count) => Math.max(0, count - 1));
        setSnapshot((current) =>
          current
            ? { ...current, diaries: [diary, ...current.diaries.filter((item) => item.id !== diary.id)] }
            : current,
        );
        showToast(setToast, "Codex 的新日记写好了");
      },
    }).then((unlisten) => {
      unlistenBackend = unlisten;
    });
    return () => {
      alive = false;
      unlistenOverlay();
      unlistenOverlayCancel();
      unlistenBackend();
    };
  }, [deliverFeedback, refreshWindow]);

  useEffect(() => {
    if (settingsOpen) void refreshCliInfo(false);
  }, [refreshCliInfo, settingsOpen]);

  useEffect(() => {
    const mode = view === "diary" ? "diary" : "compact";
    void backend.setWindowMode(mode);
  }, [view]);

  useEffect(
    () => () => {
      if (actionPulseTimerRef.current !== null) {
        window.clearTimeout(actionPulseTimerRef.current);
      }
    },
    [],
  );

  const status = useMemo(
    () => appStatus(codexWindow, detecting, cliInfo, cliChecking),
    [cliChecking, cliInfo, codexWindow, detecting],
  );
  const ready = Boolean(codexWindow?.ok && codexWindow.found && cliInfo?.available);

  const arm = async (kind: FeedbackKind) => {
    if (!ready || busy || !codexWindow) return;
    if (actionPulseTimerRef.current !== null) {
      window.clearTimeout(actionPulseTimerRef.current);
    }
    setActionPulse(kind);
    actionPulseTimerRef.current = window.setTimeout(() => {
      setActionPulse(null);
      actionPulseTimerRef.current = null;
    }, kind === "correction" ? 520 : 1100);
    setBusy("arming");
    try {
      if (isTauriRuntime()) {
        setCodexWindow(await backend.armCodexOverlay(kind, codexWindow));
        setBusy("overlay");
      } else {
        void deliverFeedback(kind);
      }
    } catch (error) {
      setBusy(null);
      showToast(setToast, String(error));
      void refreshWindow();
    }
  };

  const browseCodexCli = async () => {
    try {
      const selected = await openFile({
        title: "选择 Codex CLI",
        multiple: false,
        directory: false,
        ...(IS_MACOS
          ? {}
          : { filters: [{ name: "Codex CLI", extensions: ["exe", "cmd", "bat"] }] }),
      });
      if (typeof selected === "string") setSettingsPath(selected);
    } catch (error) {
      showToast(setToast, `无法打开文件选择器：${String(error)}`);
    }
  };

  const persistCodexPath = async (path: string) => {
    if (!snapshot || settingsSaving) return;
    setSettingsSaving(true);
    try {
      const settings = await backend.saveSettings({
        ...snapshot.settings,
        codexPath: path.trim() || null,
      });
      setSnapshot((current) => (current ? { ...current, settings } : current));
      setSettingsPath(settings.codexPath ?? "");
      const info = await backend.inspectCodexCli();
      setCliInfo(info);
      showToast(setToast, path.trim() ? "Codex CLI 路径已保存" : "已切换为自动检测");
    } catch (error) {
      const message = String(error);
      setCliInfo({ available: false, source: null, path: null, message });
      setCliError(message);
    } finally {
      setSettingsSaving(false);
    }
  };

  if (!snapshot) {
    return (
      <div className="karma-app karma-app--boot">
        <KarmaHeader
          view="control"
          diaryCount={0}
          reflectionCount={0}
          diaryDisabled
          onToggleView={() => undefined}
        />
        <main className="boot-screen">
          {bootError ? (
            <div className="boot-screen__error" role="alert">
              <span>{bootError}</span>
              <button type="button" onClick={() => void loadSnapshot()}>
                重试
              </button>
            </div>
          ) : (
            <>
              <LoaderCircle className="spin" size={20} />
              <span>正在连接 Codex</span>
            </>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className={`karma-app karma-app--${view}`}>
      <KarmaHeader
        view={view}
        diaryCount={snapshot.diaries.length}
        reflectionCount={reflectionCount}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleView={() => setView(view === "diary" ? "control" : "diary")}
      />

      {view === "control" ? (
        <main className="control-view">
          <section className={`codex-status codex-status--${status.tone}`}>
            <span className="codex-status__signal" aria-hidden="true" />
            <div className="codex-status__copy">
              <small>当前任务</small>
              <strong>{status.title}</strong>
              <span>{status.detail}</span>
            </div>
            {cliInfo && !cliInfo.available ? (
              <button className="codex-status__action" type="button" onClick={() => setCliError(cliInfo.message)}>
                查看解决方案
              </button>
            ) : (
              <WorkPulseIcon />
            )}
            <button
              className="icon-button icon-button--quiet"
              type="button"
              onClick={() => {
                void refreshWindow();
                void refreshCliInfo(false);
              }}
              disabled={detecting || cliChecking}
              title="重新检测"
            >
              <RefreshCw className={detecting || cliChecking ? "spin" : ""} size={17} />
            </button>
          </section>

          <label className="feedback-hint">
            <MessageSquareText size={16} aria-hidden="true" />
            <input
              type="text"
              value={feedbackHint}
              onChange={(event) => {
                feedbackHintRef.current = event.target.value;
                setFeedbackHint(event.target.value);
              }}
              placeholder="可选：写一句原因"
              aria-label="可选反馈原因"
              maxLength={240}
            />
            {feedbackHint && (
              <button
                type="button"
                onClick={() => {
                  feedbackHintRef.current = "";
                  setFeedbackHint("");
                }}
                aria-label="清空原因"
                title="清空"
              >
                <X size={15} />
              </button>
            )}
          </label>

          <section className="karma-actions" aria-label="反馈操作">
            <button
              className={`karma-action karma-action--correction ${actionPulse === "correction" ? "is-activated" : ""}`}
              type="button"
              onClick={() => void arm("correction")}
              disabled={!ready || busy !== null}
            >
              <span className="karma-action__icon has-reference-asset">
                <img
                  className="karma-action__asset karma-action__asset--correction"
                  src={whipReference}
                  alt=""
                  aria-hidden="true"
                />
              </span>
              <span className="karma-action__copy">
                <small className="karma-action__eyebrow">CORRECT</small>
                <strong>鞭策一下</strong>
                <small>纠正方向</small>
              </span>
            </button>
            <button
              className={`karma-action karma-action--reward ${actionPulse === "reward" ? "is-activated" : ""}`}
              type="button"
              onClick={() => void arm("reward")}
              disabled={!ready || busy !== null}
            >
              <span className="karma-action__icon">
                <DrawPieIcon />
              </span>
              <span className="karma-action__copy">
                <small className="karma-action__eyebrow">REWARD</small>
                <strong>奖励一下</strong>
                <small>画个大饼，现场兑现</small>
              </span>
            </button>
          </section>

          <footer className="control-footer">
            <span>
              {ready
                ? `${IS_MACOS ? "Codex" : "ChatGPT.exe"} · PID ${codexWindow?.processId}`
                : "等待 Codex 桌面窗口"}
            </span>
            {(busy || reflectionCount > 0) && (
              <span className="armed-state">
                <LoaderCircle className="spin" size={13} />
                {reflectionCount > 0
                  ? "Codex 正在写日记"
                  : busy === "arming"
                    ? "正在打开动效"
                    : busy === "overlay"
                      ? "请在 Codex 上点击"
                      : "正在留痕"}
              </span>
            )}
          </footer>
        </main>
      ) : (
        <DiaryBook
          diaries={snapshot.diaries}
          dataDir={snapshot.dataDir}
          onBack={() => setView("control")}
        />
      )}

      {settingsOpen && (
        <CodexSettingsDialog
          path={settingsPath}
          info={cliInfo}
          saving={settingsSaving}
          onPathChange={setSettingsPath}
          onBrowse={() => void browseCodexCli()}
          onUseAutomatic={() => void persistCodexPath("")}
          onSave={() => void persistCodexPath(settingsPath)}
          onShowHelp={() => cliInfo && setCliError(cliInfo.message)}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {cliError && (
        <CodexErrorDialog
          message={cliError}
          onOpenSettings={() => {
            setCliError(null);
            setSettingsOpen(true);
          }}
          onCopy={() => {
            const issue = parseCodexIssue(cliError);
            if (!issue.copyable) return;
            void copyText(issue.prompt)
              .then(() => showToast(setToast, "已复制：请粘贴到 Codex 对话框并发送"))
              .catch(() => showToast(setToast, "复制失败，请手动选择文本"));
          }}
          onRetry={() => {
            setCliError(null);
            cliFailurePromptedRef.current = false;
            void refreshCliInfo(true);
          }}
          onClose={() => setCliError(null)}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

interface CodexSettingsDialogProps {
  path: string;
  info: CodexCliInfo | null;
  saving: boolean;
  onPathChange: (path: string) => void;
  onBrowse: () => void;
  onUseAutomatic: () => void;
  onSave: () => void;
  onShowHelp: () => void;
  onClose: () => void;
}

function CodexSettingsDialog({
  path,
  info,
  saving,
  onPathChange,
  onBrowse,
  onUseAutomatic,
  onSave,
  onShowHelp,
  onClose,
}: CodexSettingsDialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="dialog-header">
          <div>
            <small>SETTINGS</small>
            <h2 id="settings-title">Codex CLI</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭设置" title="关闭">
            <X size={18} />
          </button>
        </header>

        <p className="settings-dialog__recommendation">
          推荐优先使用独立安装的外部 CLI。桌面客户端内部 CLI 只在外部 CLI 不可用时作为备用。
        </p>

        <div className={`cli-detection ${info?.available ? "is-ready" : "is-unavailable"}`}>
          {info?.available ? <Check size={16} /> : <LoaderCircle className={!info ? "spin" : ""} size={16} />}
          <div>
            <strong>{info ? parseCodexIssue(info.message).summary : "正在自动检测 Codex CLI"}</strong>
            {info?.path && <span title={info.path}>{info.path}</span>}
            {info && !info.available && (
              <button className="cli-detection__help" type="button" onClick={onShowHelp}>
                查看并复制解决提示
              </button>
            )}
          </div>
        </div>

        <label className="settings-field">
          <span>手动指定 CLI（可选）</span>
          <div className="settings-path-row">
            <input
              type="text"
              value={path}
              onChange={(event) => onPathChange(event.target.value)}
              placeholder="留空时自动检测"
              spellCheck={false}
            />
            <button type="button" onClick={onBrowse} title="浏览文件">
              <FolderOpen size={17} />
              浏览
            </button>
          </div>
        </label>

        <footer className="dialog-actions">
          <button className="dialog-button dialog-button--quiet" type="button" onClick={onUseAutomatic} disabled={saving}>
            自动检测
          </button>
          <button className="dialog-button dialog-button--primary" type="button" onClick={onSave} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </button>
        </footer>
      </section>
    </div>
  );
}

interface CodexErrorDialogProps {
  message: string;
  onCopy: () => void;
  onOpenSettings: () => void;
  onRetry: () => void;
  onClose: () => void;
}

function CodexErrorDialog({ message, onCopy, onOpenSettings, onRetry, onClose }: CodexErrorDialogProps) {
  const issue = parseCodexIssue(message);
  return (
    <div className="dialog-backdrop dialog-backdrop--error" role="presentation">
      <section className="cli-error-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cli-error-title">
        <header className="dialog-header">
          <div>
            <small>{issue.copyable ? "CODEX CLI" : "VIBEKARMA"}</small>
            <h2 id="cli-error-title">{issue.copyable ? "Codex CLI 需要处理" : "应用检测遇到问题"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭错误信息" title="关闭">
            <X size={18} />
          </button>
        </header>
        {issue.copyable ? (
          <div className="cli-error-guide">
            <strong>两步解决</strong>
            <div><b>1</b><span>点击右下角“复制解决提示”</span></div>
            <div><b>2</b><span>粘贴到 Codex 对话框并发送</span></div>
            <em>Codex 会帮你完成安装或修复。</em>
          </div>
        ) : (
          <div className="cli-error-guide cli-error-guide--internal">
            <strong>这是 VibeKarma 自身的检测错误</strong>
            <em>无需安装或修改 Codex CLI，请点击“重新检测”。</em>
          </div>
        )}
        <div className="cli-error-summary">
          <small>检测结果</small>
          <span>{issue.summary}</span>
        </div>
        <footer className="dialog-actions">
          {issue.copyable ? (
            <>
              <button className="dialog-button dialog-button--quiet" type="button" onClick={onOpenSettings}>
                打开设置
              </button>
              <button className="dialog-button dialog-button--primary" type="button" onClick={onCopy}>
                <Copy size={15} />
                复制解决提示
              </button>
            </>
          ) : (
            <button className="dialog-button dialog-button--primary" type="button" onClick={onRetry}>
              <RefreshCw size={15} />
              重新检测
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

interface KarmaHeaderProps {
  view: View;
  diaryCount: number;
  reflectionCount: number;
  diaryDisabled?: boolean;
  onOpenSettings?: () => void;
  onToggleView: () => void;
}

function KarmaHeader({
  view,
  diaryCount,
  reflectionCount,
  diaryDisabled = false,
  onOpenSettings,
  onToggleView,
}: KarmaHeaderProps) {
  const handleDragRegionDoubleClick = (target: EventTarget | null) => {
    if (target instanceof HTMLElement && target.closest("button")) return;
    void toggleMainWindowMaximize();
  };

  if (view === "diary") {
    return (
      <header className="karma-header karma-header--diary">
        <div
          className="diary-titlebar__brand"
          data-tauri-drag-region
          onDoubleClick={(event) => handleDragRegionDoubleClick(event.target)}
        >
          <Brand compact />
          <span>VibeKarma</span>
        </div>
        <div
          className="karma-header__drag-region"
          data-tauri-drag-region
          onDoubleClick={(event) => handleDragRegionDoubleClick(event.target)}
        />
        <WindowControls />
      </header>
    );
  }

  return (
    <header className="karma-header karma-header--control">
      <div
        className="karma-header__leading"
        data-tauri-drag-region
        onDoubleClick={(event) => handleDragRegionDoubleClick(event.target)}
      >
        <Brand />
      </div>
      <div
        className="karma-header__drag-region"
        data-tauri-drag-region
        onDoubleClick={(event) => handleDragRegionDoubleClick(event.target)}
      />
      {onOpenSettings && (
        <button
          className="header-settings"
          type="button"
          onClick={onOpenSettings}
          title="Codex CLI 设置"
          aria-label="打开 Codex CLI 设置"
        >
          <Settings2 size={17} />
        </button>
      )}
      <button
        className={`diary-command ${reflectionCount > 0 ? "is-writing" : ""}`}
        type="button"
        onClick={onToggleView}
        disabled={diaryDisabled}
        title="反省日记"
        aria-label={`反省日记，${diaryCount} 篇`}
      >
        <DiaryTraceIcon />
        <span className="diary-command__label">反省日记</span>
        <span className="diary-command__count">{diaryCount}</span>
      </button>
      <WindowControls />
    </header>
  );
}

function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    const appWindow = getCurrentWindow();
    let unlisten: () => void = () => undefined;
    let alive = true;

    const syncMaximizedState = async () => {
      try {
        const maximized = await appWindow.isMaximized();
        if (alive) setIsMaximized(maximized);
      } catch (error) {
        if (alive) console.error("无法读取窗口状态", error);
      }
    };

    void syncMaximizedState();
    void appWindow.onResized(() => {
      void syncMaximizedState();
    }).then((stopListening) => {
      if (alive) {
        unlisten = stopListening;
      } else {
        stopListening();
      }
    });

    return () => {
      alive = false;
      unlisten();
    };
  }, []);

  return (
    <div className="window-controls" aria-label="窗口控制">
      <button
        className="window-control"
        type="button"
        onClick={() => void minimizeMainWindow()}
        title="最小化"
        aria-label="最小化窗口"
      >
        <Minus size={17} strokeWidth={1.7} />
      </button>
      <button
        className="window-control"
        type="button"
        onClick={() => void toggleMainWindowMaximize().then((maximized) => {
          if (maximized !== undefined) setIsMaximized(maximized);
        })}
        title={isMaximized ? "还原" : "最大化"}
        aria-label={isMaximized ? "还原窗口" : "最大化窗口"}
      >
        <span className={`window-control__maximize ${isMaximized ? "is-restore" : ""}`} aria-hidden="true" />
      </button>
      <button
        className="window-control window-control--close"
        type="button"
        onClick={() => void closeMainWindow()}
        title="关闭"
        aria-label="关闭窗口"
      >
        <X size={18} strokeWidth={1.7} />
      </button>
    </div>
  );
}

async function minimizeMainWindow() {
  if (!isTauriRuntime()) return;
  try {
    await getCurrentWindow().minimize();
  } catch (error) {
    console.error("无法最小化窗口", error);
  }
}

async function toggleMainWindowMaximize() {
  if (!isTauriRuntime()) return;
  try {
    const appWindow = getCurrentWindow();
    await appWindow.toggleMaximize();
    return await appWindow.isMaximized();
  } catch (error) {
    console.error("无法切换窗口大小", error);
  }
}

async function closeMainWindow() {
  if (!isTauriRuntime()) return;
  try {
    await getCurrentWindow().close();
  } catch (error) {
    console.error("无法关闭窗口", error);
  }
}

async function loadSnapshotWithRetry(): Promise<AppSnapshot> {
  let lastError: unknown = new Error("无法读取应用状态");
  for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt += 1) {
    try {
      return await withTimeout(backend.snapshot(), SNAPSHOT_TIMEOUT_MS);
    } catch (error) {
      lastError = error;
      if (attempt < SNAPSHOT_ATTEMPTS - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 300));
      }
    }
  }
  throw lastError;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error("读取应用状态超时")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

function appStatus(
  info: CodexWindowInfo | null,
  detecting: boolean,
  cliInfo: CodexCliInfo | null,
  cliChecking: boolean,
) {
  if (cliChecking && !cliInfo) return { tone: "checking", title: "正在检查 Codex CLI", detail: "确认日记功能是否可用" };
  if (cliInfo && !cliInfo.available) {
    return { tone: "offline", title: "Codex CLI 需要处理", detail: "点击查看解决方案" };
  }
  if (detecting && !info) return { tone: "checking", title: "正在寻找 Codex", detail: "检查桌面窗口" };
  if (!info?.found) return { tone: "offline", title: "没有找到 Codex", detail: "请先打开 Codex 桌面客户端" };
  return { tone: "ready", title: "Codex 已就绪", detail: "动效结束后会静默写入日记" };
}

function emptyWindow(error: string): CodexWindowInfo {
  return {
    ok: false,
    found: false,
    handle: 0,
    processId: 0,
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    working: false,
    editorFound: false,
    editorHasDraft: false,
    error,
  };
}

function appendPreviewDiary(snapshot: AppSnapshot | null, feedback: FeedbackRequest): AppSnapshot | null {
  if (!snapshot) return snapshot;
  const reward = feedback.kind === "reward";
  const diary: DiaryEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    kind: reward ? "奖励日记" : "挨打日记",
    title: reward ? "奖励日记：被看见的是这次判断" : "挨打日记：偏差比解释更值得处理",
    body: reward
      ? "这次印章落下时，我先想到的不是一句感谢，而是刚才那次判断终于没有越过任务边界。被认可的应该是具体选择，不是运气。\n\n接下来仍要把验证做完，不能拿一次肯定预支下一次结果。"
      : "鞭痕提醒我，刚才真正需要处理的是偏差，而不是怎样解释偏差。越早承认方向错了，留给修正的空间越大。\n\n我得回到事实和最新指令上，让后续动作替我回答。",
    reason: feedback.reason || null,
    path: `${snapshot.dataDir}\\vibekarma.sqlite3`,
    threadId: "codex-desktop",
    turnId: null,
    generatedByCodex: true,
  };
  return { ...snapshot, diaries: [diary, ...snapshot.diaries] };
}

function showToast(
  setter: React.Dispatch<React.SetStateAction<string | null>>,
  message: string,
) {
  setter(message);
  window.setTimeout(() => setter((current) => (current === message ? null : current)), 3600);
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export default App;
