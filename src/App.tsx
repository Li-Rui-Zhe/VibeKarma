import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Award,
  BookOpenText,
  ChevronLeft,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  X,
} from "lucide-react";
import { Brand } from "./components/Brand";
import { DiaryBook } from "./components/DiaryBook";
import { WhipIcon } from "./components/WhipIcon";
import {
  backend,
  isTauriRuntime,
  subscribeBackendEvents,
  subscribeOverlayAction,
} from "./lib/backend";
import type {
  AppSnapshot,
  CodexWindowInfo,
  DiaryEntry,
  FeedbackKind,
  FeedbackRequest,
} from "./types";

type View = "control" | "diary";

function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [codexWindow, setCodexWindow] = useState<CodexWindowInfo | null>(null);
  const [view, setView] = useState<View>("control");
  const [feedbackHint, setFeedbackHint] = useState("");
  const [detecting, setDetecting] = useState(true);
  const [busy, setBusy] = useState<"overlay" | "feedback" | null>(null);
  const [reflectionCount, setReflectionCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const feedbackHintRef = useRef("");

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

  const deliverFeedback = useCallback(async (kind: FeedbackKind) => {
    const reason = feedbackHintRef.current.trim();
    setBusy("feedback");
    try {
      const feedback: FeedbackRequest = { kind, reason, note: "" };
      const receipt = await backend.sendDesktopFeedback(feedback);
      if (!isTauriRuntime()) {
        setSnapshot((current) => appendPreviewDiary(current, feedback));
      }
      feedbackHintRef.current = "";
      setFeedbackHint("");
      showToast(
        setToast,
        receipt.delivery === "steered"
          ? "反馈已进入当前任务，Codex 正在写日记"
          : "反馈已发送，Codex 正在写日记",
      );
    } catch (error) {
      showToast(setToast, String(error));
    } finally {
      setBusy(null);
      void refreshWindow();
    }
  }, [refreshWindow]);

  useEffect(() => {
    let alive = true;
    void backend.snapshot().then((value) => {
      if (alive) setSnapshot(value);
    });
    void refreshWindow();
    const timer = window.setInterval(() => {
      if (alive && view === "control") void refreshWindow();
    }, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [refreshWindow, view]);

  useEffect(() => {
    let alive = true;
    let unlistenOverlay: () => void = () => undefined;
    let unlistenBackend: () => void = () => undefined;
    void subscribeOverlayAction((action) => {
      if (!alive) return;
      void deliverFeedback(action.kind);
    }).then((unlisten) => {
      unlistenOverlay = unlisten;
    });
    void subscribeBackendEvents({
      onSession: () => undefined,
      onCodex: () => undefined,
      onDiaryStart: () => {
        if (alive) setReflectionCount((count) => count + 1);
      },
      onRequest: () => undefined,
      onLog: (log) => {
        if (alive && log.level === "error") {
          if (log.message.includes("日记")) setReflectionCount(0);
          showToast(setToast, log.message);
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
      unlistenBackend();
    };
  }, [deliverFeedback]);

  useEffect(() => {
    const mode = view === "diary" ? "diary" : "compact";
    void backend.setWindowMode(mode);
  }, [view]);

  const status = useMemo(() => windowStatus(codexWindow, detecting), [codexWindow, detecting]);
  const ready = Boolean(
    codexWindow?.ok &&
      codexWindow.found &&
      codexWindow.editorFound &&
      !codexWindow.editorHasDraft,
  );

  const arm = async (kind: FeedbackKind) => {
    if (!ready || busy) return;
    setBusy("overlay");
    try {
      if (isTauriRuntime()) {
        setCodexWindow(await backend.armCodexOverlay(kind));
      } else {
        void deliverFeedback(kind);
      }
    } catch (error) {
      setBusy(null);
      showToast(setToast, String(error));
      void refreshWindow();
    }
  };

  if (!snapshot) {
    return (
      <main className="boot-screen">
        <Brand />
        <LoaderCircle className="spin" size={20} />
      </main>
    );
  }

  return (
    <div className={`karma-app karma-app--${view}`}>
      <header className="karma-header">
        {view === "diary" ? (
          <button className="icon-button" type="button" onClick={() => setView("control")} title="返回">
            <ChevronLeft size={19} />
          </button>
        ) : (
          <Brand />
        )}
        <div className="karma-header__title">
          {view === "diary" && <strong>Codex 的反省日记</strong>}
        </div>
        <button
          className={`diary-command ${view === "diary" ? "is-active" : ""}`}
          type="button"
          onClick={() => setView(view === "diary" ? "control" : "diary")}
          title="反省日记"
          aria-label={`反省日记，${snapshot.diaries.length} 篇`}
        >
          <BookOpenText size={18} />
          <span>{snapshot.diaries.length}</span>
        </button>
      </header>

      {view === "control" ? (
        <main className="control-view">
          <section className={`codex-status codex-status--${status.tone}`}>
            <span className="codex-status__signal" aria-hidden="true" />
            <div>
              <strong>{status.title}</strong>
              <span>{status.detail}</span>
            </div>
            <button
              className="icon-button icon-button--quiet"
              type="button"
              onClick={() => void refreshWindow()}
              disabled={detecting}
              title="重新检测"
            >
              <RefreshCw className={detecting ? "spin" : ""} size={17} />
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
              className="karma-action karma-action--correction"
              type="button"
              onClick={() => void arm("correction")}
              disabled={!ready || busy !== null}
            >
              <span className="karma-action__icon"><WhipIcon /></span>
              <span><strong>鞭一下</strong><small>纠正方向</small></span>
            </button>
            <button
              className="karma-action karma-action--reward"
              type="button"
              onClick={() => void arm("reward")}
              disabled={!ready || busy !== null}
            >
              <span className="karma-action__icon"><Award size={31} /></span>
              <span><strong>奖一下</strong><small>留下肯定</small></span>
            </button>
          </section>

          <footer className="control-footer">
            <span>{ready ? `ChatGPT.exe · PID ${codexWindow?.processId}` : "等待 Codex 桌面窗口"}</span>
            {(busy || reflectionCount > 0) && (
              <span className="armed-state">
                <LoaderCircle className="spin" size={13} />
                {reflectionCount > 0 ? "Codex 正在写日记" : busy === "overlay" ? "已就绪" : "正在发送"}
              </span>
            )}
          </footer>
        </main>
      ) : (
        <DiaryBook diaries={snapshot.diaries} dataDir={snapshot.dataDir} />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function windowStatus(info: CodexWindowInfo | null, detecting: boolean) {
  if (detecting && !info) return { tone: "checking", title: "正在寻找 Codex", detail: "检查桌面窗口" };
  if (!info?.found) return { tone: "offline", title: "没有找到 Codex", detail: "请先打开 Codex 桌面客户端" };
  if (!info.ok || !info.editorFound) {
    return { tone: "warning", title: "Codex 暂不可操作", detail: "窗口已找到，但输入框还未出现" };
  }
  if (info.editorHasDraft) {
    return { tone: "warning", title: "Codex 输入框有草稿", detail: "请先发送或清空尚未发送的内容" };
  }
  if (info.working) return { tone: "working", title: "Codex 正在工作", detail: "反馈会进入当前任务" };
  return { tone: "ready", title: "Codex 已就绪", detail: "反馈会作为一条新消息发送" };
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

export default App;
