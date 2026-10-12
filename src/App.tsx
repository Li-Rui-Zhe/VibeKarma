import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import {
  Check,
  Copy,
  ArrowUpRight,
  Download,
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
import { cliUpdateFailure, codexIssueGuide, parseCodexIssue } from "./lib/codexIssue";
import type {
  AppSnapshot,
  CodexCliInfo,
  CodexCliUpdateInfo,
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
  const [failedDiaryCount, setFailedDiaryCount] = useState(0);
  const [retryingDiaries, setRetryingDiaries] = useState(false);
  const [actionPulse, setActionPulse] = useState<FeedbackKind | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPath, setSettingsPath] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [openingContextPermissions, setOpeningContextPermissions] = useState(false);
  const [cliInfo, setCliInfo] = useState<CodexCliInfo | null>(null);
  const [cliChecking, setCliChecking] = useState(true);
  const [cliError, setCliError] = useState<string | null>(null);
  const [cliUpdateInfo, setCliUpdateInfo] = useState<CodexCliUpdateInfo | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [cliUpdating, setCliUpdating] = useState(false);
  const updateInFlightRef = useRef(false);
  const updateCheckSequenceRef = useRef(0);
  const feedbackHintRef = useRef("");
  const actionPulseTimerRef = useRef<number | null>(null);
  const cliFailurePromptedRef = useRef(false);
  const windowCheckInFlightRef = useRef(false);

  const refreshWindow = useCallback(async () => {
    if (windowCheckInFlightRef.current) return;
    windowCheckInFlightRef.current = true;
    setDetecting(true);
    try {
      setCodexWindow(await backend.inspectCodexWindow());
    } catch (error) {
      setCodexWindow(emptyWindow(String(error)));
    } finally {
      windowCheckInFlightRef.current = false;
      setDetecting(false);
    }
  }, []);

  const loadSnapshot = useCallback(async () => {
    setBootError(null);
    try {
      const nextSnapshot = await loadSnapshotWithRetry();
      setSnapshot(nextSnapshot);
      setFailedDiaryCount(nextSnapshot.failedDiaryCount);
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
      return info;
    } catch (error) {
      const message = String(error);
      const info: CodexCliInfo = {
        available: false,
        source: null,
        path: null,
        version: null,
        updateHelp: null,
        message,
      };
      setCliInfo(info);
      if (showFailure && !cliFailurePromptedRef.current) {
        cliFailurePromptedRef.current = true;
        setCliError(message);
      }
      return info;
    } finally {
      setCliChecking(false);
    }
  }, []);

  const refreshCliUpdate = useCallback(async (force = false) => {
    const sequence = ++updateCheckSequenceRef.current;
    setUpdateChecking(true);
    try {
      const info = await backend.checkCodexCliUpdate(force);
      if (sequence === updateCheckSequenceRef.current) setCliUpdateInfo(info);
    } catch {
      if (sequence === updateCheckSequenceRef.current) setCliUpdateInfo({
        path: null, currentVersion: null, latestVersion: null,
        status: "checkFailed", canUpdate: false, method: null,
        message: "暂时无法检查 CLI 更新，可以稍后重试。",
      });
    } finally {
      if (sequence === updateCheckSequenceRef.current) setUpdateChecking(false);
    }
  }, []);

  useEffect(() => { void refreshCliUpdate(); }, [refreshCliUpdate]);

  const recheckCli = async () => {
    if (cliChecking || cliUpdating) return;
    void refreshWindow();
    const info = await refreshCliInfo(false);
    if (info?.available) {
      setCliError(null);
      showToast(setToast, `CLI 已重新检测${info.version ? ` · ${info.version}` : ""}，尚未验证模型调用`);
      void refreshCliUpdate();
    } else if (info) {
      setCliError(info.message);
    }
  };

  const openContextPermissions = async () => {
    if (openingContextPermissions) return;
    setOpeningContextPermissions(true);
    try {
      await backend.openCodexContextPermissions();
      showToast(setToast, "请在辅助功能中允许 VibeKarma，开启后点击重新检测");
    } catch (error) {
      showToast(setToast, String(error));
    } finally {
      setOpeningContextPermissions(false);
    }
  };

  const retryFailedDiaries = async () => {
    if (retryingDiaries || cliChecking || cliUpdating) return;
    setRetryingDiaries(true);
    try {
      const info = await refreshCliInfo(false);
      if (!info?.available) {
        if (info) setCliError(info.message);
        return;
      }
      setCliError(null);
      setFailedDiaryCount(0);
      const count = await backend.retryFailedDiaries();
      showToast(setToast, count > 0 ? `正在重试 ${count} 篇日记，不会重复记录奖惩` : "没有待重试的日记");
    } catch (error) {
      setCliError(String(error));
      void loadSnapshot();
    } finally {
      setRetryingDiaries(false);
    }
  };

  const performCliUpdate = async () => {
    if (updateInFlightRef.current || updateChecking || cliChecking || reflectionCount > 0 || busy || !cliUpdateInfo?.canUpdate || !cliUpdateInfo.path || !cliUpdateInfo.currentVersion) return;
    updateInFlightRef.current = true;
    setCliUpdating(true);
    setCliError(null);
    setFailedDiaryCount(0);
    try {
      const result = await backend.updateCodexCli(cliUpdateInfo.path, cliUpdateInfo.currentVersion);
      setCliInfo(result.cli);
      showToast(setToast, `CLI 已更新至 ${result.cli.version ?? "新版本"}${result.retriedCount > 0 ? `，正在重试 ${result.retriedCount} 篇日记` : ""}`);
      void refreshCliUpdate();
    } catch (error) {
      setCliError(cliUpdateFailure(String(error), cliInfo, cliUpdateInfo));
      const next = await backend.snapshot().catch(() => null);
      if (next) setFailedDiaryCount(next.failedDiaryCount);
      void refreshCliInfo(false);
      void refreshCliUpdate();
    } finally {
      updateInFlightRef.current = false;
      setCliUpdating(false);
    }
  };

  const deliverFeedback = useCallback(async (kind: FeedbackKind) => {
    const reason = feedbackHintRef.current.trim();
    setBusy("feedback");
    try {
      const feedback: FeedbackRequest = { kind, reason };
      const receipt = await backend.recordDesktopFeedback(feedback);
      if (!isTauriRuntime()) {
        setSnapshot((current) => appendPreviewDiary(current, feedback));
      }
      feedbackHintRef.current = "";
      setFeedbackHint("");
      showToast(setToast, receipt.contextWarning ? "已记录反馈；未读取聊天内容，日记将参考原因和近期日记" : "已静默留痕，Codex 正在写日记");
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
      onDiaryFailed: (failure) => {
        if (!alive) return;
        setReflectionCount((count) => Math.max(0, count - 1));
        setFailedDiaryCount(failure.pendingCount);
        setCliError(failure.message);
        void refreshCliUpdate();
        showToast(setToast, "日记生成失败，处理后可以直接重试");
      },
      onLog: (log) => {
        if (alive && log.level === "error") {
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
  }, [deliverFeedback, refreshWindow, refreshCliUpdate]);

  useEffect(() => {
    if (settingsOpen && !cliUpdating) {
      void refreshCliInfo(false);
      void refreshCliUpdate();
    }
  }, [refreshCliInfo, refreshCliUpdate, settingsOpen, cliUpdating]);

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
    () => appStatus(codexWindow, detecting, cliInfo, cliChecking, cliUpdateInfo, cliUpdating),
    [cliChecking, cliInfo, codexWindow, detecting, cliUpdateInfo, cliUpdating],
  );
  const ready = Boolean(codexWindow?.ok && codexWindow.found && cliInfo?.available && !cliUpdating);
  const updateDisabled = cliChecking || updateChecking || reflectionCount > 0 || busy !== null || retryingDiaries;
  const updateControls = <CliUpdatePanel
    info={cliUpdateInfo} checking={updateChecking} updating={cliUpdating} disabled={updateDisabled}
    onCheck={() => void refreshCliUpdate(true)} onUpdate={() => void performCliUpdate()}
  />;

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
    if (!snapshot || settingsSaving || cliUpdating) return;
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
      void refreshCliUpdate();
      showToast(setToast, path.trim() ? "Codex CLI 路径已保存" : "已切换为自动检测");
    } catch (error) {
      const message = String(error);
      setCliInfo({ available: false, source: null, path: null, version: null, updateHelp: null, message });
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
              <small>{cliUpdating || cliUpdateInfo?.status === "available" ? "CLI 更新" : "当前任务"}</small>
              <strong>{status.title}</strong>
              <span>{status.detail}</span>
            </div>
            {cliInfo && !cliInfo.available ? (
              <button className="codex-status__action" type="button" onClick={() => setCliError(cliInfo.message)}>
                查看解决方案
              </button>
            ) : cliUpdating || cliUpdateInfo?.status === "available" ? (
              <button className="codex-status__action codex-status__action--update" type="button" disabled={cliUpdating || updateDisabled} onClick={() => cliUpdateInfo?.canUpdate ? void performCliUpdate() : setSettingsOpen(true)}>
                {cliUpdating ? <LoaderCircle className="spin" size={13} /> : <Download size={13} />}
                {cliUpdating ? "更新中…" : cliUpdateInfo?.canUpdate ? "一键更新" : "查看更新"}
              </button>
            ) : codexWindow?.contextWarning ? (
              <button className="codex-status__action" type="button" onClick={() => setSettingsOpen(true)}>查看原因</button>
            ) : (
              <WorkPulseIcon />
            )}
            <button
              className="icon-button icon-button--quiet"
              type="button"
              onClick={() => {
                void refreshWindow();
                if (!cliUpdating) {
                  void refreshCliInfo(false);
                  void refreshCliUpdate(true);
                }
              }}
              disabled={detecting || cliChecking || updateChecking || cliUpdating}
              title="重新检测"
            >
              <RefreshCw className={detecting || cliChecking || updateChecking ? "spin" : ""} size={17} />
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
            {failedDiaryCount > 0 ? (
              <button className="failed-diary-retry" type="button" disabled={retryingDiaries || cliChecking || cliUpdating} onClick={() => void retryFailedDiaries()}>
                重试失败日记（{failedDiaryCount}）
              </button>
            ) : (
              <span>
                {ready
                  ? `${IS_MACOS ? "Codex" : "ChatGPT.exe"} · PID ${codexWindow?.processId}`
                  : "等待 Codex 桌面窗口"}
              </span>
            )}
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
          saving={settingsSaving || cliUpdating}
          checking={cliChecking || cliUpdating}
          updateControls={updateControls}
          contextWarning={codexWindow?.contextWarning ?? null}
          openingContextPermissions={openingContextPermissions}
          onContextPermissions={() => void openContextPermissions()}
          onPathChange={setSettingsPath}
          onBrowse={() => void browseCodexCli()}
          onUseAutomatic={() => void persistCodexPath("")}
          onSave={() => void persistCodexPath(settingsPath)}
          onShowHelp={() => cliInfo && setCliError(cliInfo.message)}
          onUpdateHelp={() => cliInfo?.updateHelp && setCliError(cliInfo.updateHelp)}
          onRecheck={() => void recheckCli()}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {cliError && (
        <CodexErrorDialog
          message={cliError}
          checking={cliChecking || retryingDiaries || cliUpdating}
          updateControls={updateControls}
          failedDiaryCount={failedDiaryCount}
          onRetryDiaries={() => void retryFailedDiaries()}
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
          onRetry={() => void recheckCli()}
          onClose={() => setCliError(null)}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

interface CliUpdatePanelProps {
  info: CodexCliUpdateInfo | null;
  checking: boolean;
  updating: boolean;
  disabled: boolean;
  onCheck: () => void;
  onUpdate: () => void;
}

function CliUpdatePanel({ info, checking, updating, disabled, onCheck, onUpdate }: CliUpdatePanelProps) {
  return (
    <div className={`cli-update-panel ${info?.status === "available" ? "has-update" : ""}`} role="status">
      <div className="cli-update-panel__heading">
        <span className="cli-update-panel__icon" aria-hidden="true">{updating || checking ? <LoaderCircle className="spin" size={16} /> : info?.status === "upToDate" ? <Check size={16} /> : <Download size={16} />}</span>
        <div>
          <strong>{updating ? "正在更新 CLI" : checking ? "正在检查更新" : info?.status === "available" ? "有新版本可用" : info?.status === "upToDate" ? "CLI 已是最新版本" : "CLI 更新"}</strong>
          <p>{updating ? "正在下载并验证，完成后会自动重试失败日记。" : info?.message ?? "启动时自动检查 CLI 更新。"}</p>
        </div>
      </div>
      {info?.currentVersion && info.latestVersion && (
        <div className="cli-update-panel__versions">
          <span>{info.currentVersion}</span>{info.status === "available" ? <ArrowUpRight size={12} aria-hidden="true" /> : <small>官方稳定版</small>}<span>{info.latestVersion}</span>
          {info.method && <small>{info.method}</small>}
        </div>
      )}
      {info?.path && <details className="cli-update-panel__target"><summary>查看更新位置</summary><code>{info.path}</code><p>{info.canUpdate ? `将通过${info.method ?? "原安装方式"}更新此 CLI，并验证同一路径的版本。` : "请按原安装方式更新。内置 CLI 随桌面客户端更新。"}</p></details>}
      <p className="cli-update-panel__network">需要联网下载；连接失败时请检查网络与代理。</p>
      <div className="cli-update-panel__actions">
        <button className="dialog-button dialog-button--quiet" type="button" onClick={onCheck} disabled={checking || updating}>
          <RefreshCw className={checking ? "spin" : ""} size={13} />
          检查更新
        </button>
        {info?.status === "available" && info.canUpdate && (
          <button className="dialog-button dialog-button--primary" type="button" onClick={onUpdate} disabled={disabled || updating}>
            {updating ? <LoaderCircle className="spin" size={13} /> : <Download size={13} />}
            {updating ? "更新中…" : "一键更新"}
          </button>
        )}
      </div>
    </div>
  );
}

interface CodexSettingsDialogProps {
  path: string;
  info: CodexCliInfo | null;
  saving: boolean;
  checking: boolean;
  updateControls: React.ReactNode;
  contextWarning: string | null;
  openingContextPermissions: boolean;
  onContextPermissions: () => void;
  onPathChange: (path: string) => void;
  onBrowse: () => void;
  onUseAutomatic: () => void;
  onSave: () => void;
  onShowHelp: () => void;
  onUpdateHelp: () => void;
  onRecheck: () => void;
  onClose: () => void;
}

function CodexSettingsDialog({
  path,
  info,
  saving,
  checking,
  updateControls,
  contextWarning,
  openingContextPermissions,
  onContextPermissions,
  onPathChange,
  onBrowse,
  onUseAutomatic,
  onSave,
  onShowHelp,
  onUpdateHelp,
  onRecheck,
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

        <div className="settings-dialog__content">
          <p className="settings-dialog__recommendation">
            使用新模型前建议更新 CLI。更新成功后会自动重试失败日记，无需重新奖惩。
          </p>

          <div className={`cli-detection ${info?.available ? "is-ready" : "is-unavailable"}`}>
            {info?.available ? <Check size={16} /> : <LoaderCircle className={!info ? "spin" : ""} size={16} />}
            <div>
              <strong>{info ? parseCodexIssue(info.message).summary : "正在自动检测 Codex CLI"}</strong>
              {info?.available && <span>版本：{info.version ?? "未能读取版本"}</span>}
              {info?.path && <span title={info.path}>{info.path}</span>}
              {info?.updateHelp && (
                <button className="cli-detection__help" type="button" onClick={onUpdateHelp}>查看更新帮助</button>
              )}
              {info && !info.available && (
                <button className="cli-detection__help" type="button" onClick={onShowHelp}>
                  查看并复制解决提示
                </button>
              )}
            </div>
          </div>

          {updateControls}

          {IS_MACOS && (
            <section className={`context-access ${contextWarning ? "context-access--warning" : ""}`} aria-label="聊天内容读取">
              <strong>让日记参考当前聊天</strong>
              <p>{contextWarning ?? "读取 Codex 当前窗口的聊天文本，需要辅助功能授权。不会输入文字或读取未发送草稿。"}</p>
              <button className="dialog-button dialog-button--quiet" type="button" onClick={onContextPermissions} disabled={openingContextPermissions}>
                {openingContextPermissions ? "正在打开…" : "打开辅助功能设置"}
              </button>
              <small>允许 VibeKarma 后点击“重新检测”。若仍提示无权限，请退出并重新打开应用。</small>
            </section>
          )}

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
        </div>

        <footer className="dialog-actions">
          <button className="dialog-button dialog-button--quiet" type="button" onClick={onRecheck} disabled={checking || saving}>
            {checking ? "检测中…" : "重新检测"}
          </button>
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
  onRetryDiaries: () => void;
  failedDiaryCount: number;
  checking: boolean;
  updateControls: React.ReactNode;
  onClose: () => void;
}

function CodexErrorDialog({ message, onCopy, onOpenSettings, onRetry, onRetryDiaries, failedDiaryCount, checking, updateControls, onClose }: CodexErrorDialogProps) {
  const issue = parseCodexIssue(message);
  const guide = codexIssueGuide(issue.kind);
  return (
    <div className="dialog-backdrop dialog-backdrop--error" role="presentation">
      <section className="cli-error-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cli-error-title">
        <header className="dialog-header">
          <div>
            <small>{issue.copyable ? "CODEX CLI" : "VIBEKARMA"}</small>
            <h2 id="cli-error-title">{guide.title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭错误信息" title="关闭">
            <X size={18} />
          </button>
        </header>
        <div className="cli-error-content">
          {issue.kind !== "updateFailure" && updateControls}
          {issue.kind === "updateFailure" ? (
            <p>可一键复制下方说明，发给 Codex 排查网络或安装路径。</p>
          ) : issue.copyable ? (
            <div className="cli-error-guide">
              <strong>{guide.action}</strong>
              <em>点击“复制解决提示”，粘贴到 Codex 对话框并发送。</em>
            </div>
          ) : (
            <div className="cli-error-guide cli-error-guide--internal">
              <strong>{guide.action}</strong>
            </div>
          )}
          {issue.kind !== "updateFailure" && <div className="cli-error-summary">
            <small>检测结果</small>
            <span>{issue.summary}</span>
          </div>}
          {issue.copyable && (
            <details className="cli-repair-prompt" open={issue.kind === "updateFailure"}>
              <summary>发给 Codex 的修复说明</summary>
              <textarea aria-label="可复制的修复说明" readOnly value={issue.prompt} onFocus={(event) => event.currentTarget.select()} />
            </details>
          )}
          {failedDiaryCount > 0 && (
            <p>本次运行有 {failedDiaryCount} 篇日记待重试。处理后点击“重试日记”，无需重新奖惩；关闭应用后待重试任务不会保留。</p>
          )}
          {issue.kind === "updateFailure" && (
            <details className="cli-repair-options">
              <summary>错误详情与更新选项</summary>
              <div className="cli-error-summary"><span>{issue.summary}</span></div>
              {updateControls}
            </details>
          )}
        </div>
        <footer className="dialog-actions">
          <button className="dialog-button dialog-button--quiet" type="button" onClick={onRetry} disabled={checking}>
            <RefreshCw size={15} />
            {checking ? "检测中…" : "重新检测"}
          </button>
          {failedDiaryCount > 0 && (
            <button className="dialog-button dialog-button--quiet" type="button" onClick={onRetryDiaries} disabled={checking}>
              重试日记
            </button>
          )}
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
          ) : null}
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
  updateInfo: CodexCliUpdateInfo | null,
  updating: boolean,
) {
  if (updating) return { tone: "checking", title: "正在更新 Codex CLI", detail: "更新完成后会自动重试失败日记" };
  if (cliChecking && !cliInfo) return { tone: "checking", title: "正在检查 Codex CLI", detail: "确认日记功能是否可用" };
  if (cliInfo && !cliInfo.available) {
    return { tone: "offline", title: "Codex CLI 需要处理", detail: "点击查看解决方案" };
  }
  if (updateInfo?.status === "available") return {
    tone: "update", title: "Codex CLI 有新版本",
    detail: `${updateInfo.currentVersion} → ${updateInfo.latestVersion} · 建议更新后使用新模型`,
  };
  if (detecting && !info) return { tone: "checking", title: "正在寻找 Codex", detail: "检查桌面窗口" };
  if (!info?.found) return { tone: "offline", title: "没有找到 Codex", detail: "请先打开 Codex 桌面客户端" };
  if (info.contextWarning) return { tone: "update", title: "聊天内容暂未读取", detail: "奖惩可继续使用 · 日记将参考原因和近期日记" };
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
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch { /* Fall back to the desktop WebView's copy command. */ }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand("copy")) throw new Error("无法写入剪贴板");
  } finally { textarea.remove(); }
}

export default App;
