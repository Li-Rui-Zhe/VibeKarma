import { useEffect, useRef, useState } from "react";
import { Cable, CircleStop, LoaderCircle, Send, Stamp, Terminal } from "lucide-react";
import { formatClock } from "../lib/format";
import type {
  ActivityItem,
  ChatMessage,
  FeedbackKind,
  SessionSnapshot,
} from "../types";

export interface ImpactState {
  id: string;
  kind: FeedbackKind;
  x: number;
  y: number;
}

interface CodexStageProps {
  messages: ChatMessage[];
  activities: ActivityItem[];
  session: SessionSnapshot;
  draft: string;
  busyAction: string | null;
  interactionMode: FeedbackKind | null;
  impact: ImpactState | null;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onInterrupt: () => void;
  onModeChange: (kind: FeedbackKind | null) => void;
  onStrike: (kind: FeedbackKind, point: { x: number; y: number }) => void;
  onImpactDone: () => void;
}

export function CodexStage({
  messages,
  activities,
  session,
  draft,
  busyAction,
  interactionMode,
  impact,
  onDraftChange,
  onSend,
  onInterrupt,
  onModeChange,
  onStrike,
  onImpactDone,
}: CodexStageProps) {
  const [pointer, setPointer] = useState({ x: 0, y: 0, visible: false });
  const conversationEnd = useRef<HTMLDivElement>(null);
  const recentMessages = messages.slice(-8);
  const latestActivity = activities[0];

  useEffect(() => {
    conversationEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    if (impact) playImpactTone(impact.kind);
  }, [impact]);

  const statusLabel = {
    disconnected: "未连接",
    connecting: "连接中",
    idle: "待命",
    working: "工作中",
    error: "连接异常",
  }[session.status];
  const canInteract = session.connected && busyAction === null;

  return (
    <section
      className={`interaction-stage interaction-stage--${interactionMode ?? "rest"}`}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top, visible: true });
      }}
      onPointerLeave={() => setPointer((current) => ({ ...current, visible: false }))}
    >
      <div className="desk-shadow" />
      <div
        className={`codex-window ${impact ? `codex-window--${impact.kind}` : ""}`}
        aria-label="Codex 工作窗口"
      >
        <header className="codex-window__bar">
          <div className="window-lights" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="codex-window__title">
            <Terminal size={14} />
            <strong>Codex</strong>
            <span>当前任务</span>
          </div>
          <span className={`window-status window-status--${session.status}`}>
            <i />{statusLabel}
          </span>
        </header>

        <div className="codex-window__body">
          <div className="conversation-ribbon">
            <span>{session.activeTurnId ? "任务进行中" : "当前对话"}</span>
            {session.activeTurnId && (
              <button
                className="icon-command"
                type="button"
                onClick={onInterrupt}
                disabled={busyAction === "interrupt"}
                aria-label="停止任务"
                title="停止任务"
              >
                <CircleStop size={17} />
              </button>
            )}
          </div>

          <div className="codex-conversation">
            {!recentMessages.length && (
              <div className="conversation-placeholder">
                <Terminal size={30} />
                <strong>Codex 窗口已就位</strong>
              </div>
            )}
            {recentMessages.map((message) => (
              <article className={`window-message window-message--${message.role}`} key={message.id}>
                <header>
                  <strong>{message.role === "assistant" ? "Codex" : "你"}</strong>
                  <time>{formatClock(message.timestamp)}</time>
                </header>
                <p>{message.text || (message.streaming ? "正在组织回复…" : "")}</p>
              </article>
            ))}
            <div ref={conversationEnd} />
          </div>

          <div className="activity-ticker" aria-live="polite">
            <span className={latestActivity?.status === "running" ? "is-running" : ""} />
            <strong>{latestActivity?.title ?? "没有进行中的动作"}</strong>
          </div>

          <div className="window-composer">
            <textarea
              rows={2}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
              placeholder={
                session.connected
                  ? session.activeTurnId
                    ? "Codex 正在工作"
                    : "给 Codex 一个任务"
                  : "连接 Codex 后开始"
              }
              disabled={!session.connected || Boolean(session.activeTurnId)}
            />
            <button
              className="send-command"
              type="button"
              onClick={onSend}
              disabled={
                !draft.trim() ||
                !session.connected ||
                Boolean(session.activeTurnId) ||
                busyAction === "send"
              }
              aria-label="发送"
              title="发送"
            >
              {busyAction === "send" ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
            </button>
          </div>
        </div>

        {interactionMode && (
          <button
            className="strike-layer"
            type="button"
            aria-label={interactionMode === "correction" ? "用鞭子抽 Codex 窗口" : "给 Codex 窗口盖奖励章"}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onStrike(interactionMode, {
                x: event.clientX ? event.clientX - rect.left : rect.width / 2,
                y: event.clientY ? event.clientY - rect.top : rect.height / 2,
              });
            }}
          />
        )}

        {impact && (
          <div
            className={`window-impact window-impact--${impact.kind}`}
            style={{ left: impact.x, top: impact.y }}
            onAnimationEnd={(event) => {
              if (event.currentTarget === event.target) onImpactDone();
            }}
          >
            {impact.kind === "correction" ? (
              <>
                <i className="whip-scar whip-scar--one" />
                <i className="whip-scar whip-scar--two" />
              </>
            ) : (
              <div className="reward-mark">
                <Stamp size={28} />
                <strong>做得好</strong>
              </div>
            )}
            {Array.from({ length: 8 }, (_, index) => (
              <i
                className="impact-particle"
                key={index}
                style={{ "--particle-index": index } as React.CSSProperties}
              />
            ))}
          </div>
        )}
      </div>

      <div className="interaction-tools" role="group" aria-label="反馈方式">
        <button
          className={`tool-button tool-button--correction ${interactionMode === "correction" ? "is-active" : ""}`}
          type="button"
          aria-pressed={interactionMode === "correction"}
          onClick={() => onModeChange(interactionMode === "correction" ? null : "correction")}
          disabled={!canInteract}
        >
          <Cable size={19} />
          <span>鞭打</span>
        </button>
        <button
          className={`tool-button tool-button--reward ${interactionMode === "reward" ? "is-active" : ""}`}
          type="button"
          aria-pressed={interactionMode === "reward"}
          onClick={() => onModeChange(interactionMode === "reward" ? null : "reward")}
          disabled={!canInteract}
        >
          <Stamp size={19} />
          <span>奖励</span>
        </button>
      </div>

      {interactionMode && pointer.visible && (
        <div
          className={`tool-cursor tool-cursor--${interactionMode}`}
          style={{ left: pointer.x, top: pointer.y }}
          aria-hidden="true"
        >
          {interactionMode === "correction" ? <WhipCursor /> : <Stamp size={32} />}
        </div>
      )}
    </section>
  );
}

function WhipCursor() {
  return (
    <svg viewBox="0 0 92 92" role="presentation">
      <path className="whip-cursor__lash" d="M71 12C36 13 76 46 37 48C12 49 24 72 7 79" />
      <path className="whip-cursor__handle" d="M72 10L84 22" />
      <path className="whip-cursor__grip" d="M80 19L88 27" />
    </svg>
  );
}

function playImpactTone(kind: FeedbackKind) {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === "reward" ? "sine" : "sawtooth";
    oscillator.frequency.setValueAtTime(kind === "reward" ? 480 : 180, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      kind === "reward" ? 780 : 74,
      context.currentTime + 0.16,
    );
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.065, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.21);
    oscillator.addEventListener("ended", () => void context.close());
  } catch {
    // Visual feedback remains complete when audio is unavailable.
  }
}
