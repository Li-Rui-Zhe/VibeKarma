import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import rewardFlatbread from "./assets/reward-flatbread.png";
import { WhipPhysics, type WhipPhase } from "./components/WhipPhysics";
import type { FeedbackKind, OverlayAction } from "./types";

interface Impact {
  kind: FeedbackKind;
  x: number;
  y: number;
}

interface Point {
  x: number;
  y: number;
}

interface RewardReveal {
  x: number;
  y: number;
  size: number;
}

interface WhipHit extends Point {
  id: string;
  angle: number;
  intensity: number;
}

export function OverlayApp() {
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [drawing, setDrawing] = useState(false);
  const [rewardPath, setRewardPath] = useState<Point[]>([]);
  const [rewardReveal, setRewardReveal] = useState<RewardReveal | null>(null);
  const [drawHint, setDrawHint] = useState("按住拖动，画一个饼");
  const [correctionPhase, setCorrectionPhase] = useState<WhipPhase>("active");
  const [whipTarget, setWhipTarget] = useState(() => ({
    x: window.innerWidth * 0.58,
    y: window.innerHeight * 0.46,
  }));
  const [whipHits, setWhipHits] = useState<WhipHit[]>([]);
  const drawingRef = useRef<Point[]>([]);
  const correctionPhaseRef = useRef<WhipPhase>("active");
  const pendingCorrectionAction = useRef<OverlayAction | null>(null);
  const finishing = useRef(false);
  const finishTimer = useRef<number | null>(null);
  const actionVersion = useRef(0);

  const resetReward = useCallback(() => {
    drawingRef.current = [];
    setDrawing(false);
    setRewardPath([]);
    setRewardReveal(null);
    setDrawHint("按住拖动，画一个饼");
  }, []);

  const changeCorrectionPhase = useCallback((phase: WhipPhase) => {
    correctionPhaseRef.current = phase;
    setCorrectionPhase(phase);
  }, []);

  const resetCorrection = useCallback(() => {
    pendingCorrectionAction.current = null;
    changeCorrectionPhase("active");
    setWhipHits([]);
  }, [changeCorrectionPhase]);

  const cancelOverlay = useCallback(() => {
    if (finishing.current) return;
    actionVersion.current += 1;
    if (finishTimer.current !== null) {
      window.clearTimeout(finishTimer.current);
      finishTimer.current = null;
    }
    finishing.current = false;
    setKind(null);
    setImpact(null);
    resetReward();
    resetCorrection();
    void emit("overlay-cancel", null).finally(() => invoke("hide_codex_overlay"));
  }, [resetCorrection, resetReward]);

  useEffect(() => {
    let alive = true;
    let stopListening: () => void = () => undefined;
    void listen<FeedbackKind>("overlay-arm", (event) => {
      if (!alive) return;
      finishing.current = false;
      setImpact(null);
      resetReward();
      resetCorrection();
      if (event.payload === "correction") {
        const initialTarget = {
          x: window.innerWidth * 0.58,
          y: window.innerHeight * 0.46,
        };
        setPointer(initialTarget);
        setWhipTarget(initialTarget);
      }
      setKind(event.payload);
    }).then((unlisten) => {
      stopListening = unlisten;
    });

    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelOverlay();
    };
    window.addEventListener("keydown", cancel);
    return () => {
      alive = false;
      if (finishTimer.current !== null) window.clearTimeout(finishTimer.current);
      stopListening();
      window.removeEventListener("keydown", cancel);
    };
  }, [cancelOverlay, resetCorrection, resetReward]);

  const finishAction = (action: OverlayAction, delay: number, showImpact = true) => {
    finishing.current = true;
    const version = ++actionVersion.current;
    if (showImpact) setImpact(action);
    finishTimer.current = window.setTimeout(() => {
      finishTimer.current = null;
      if (version !== actionVersion.current) return;
      void emit("overlay-action", action).finally(async () => {
        setKind(null);
        setImpact(null);
        resetReward();
        resetCorrection();
        await invoke("hide_codex_overlay");
      });
    }, delay);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!kind || finishing.current || event.button !== 0) return;
    if (kind === "correction") {
      event.preventDefault();
      const target = { x: event.clientX, y: event.clientY };
      setPointer(target);
      setWhipTarget(target);
      pendingCorrectionAction.current = { kind: "correction", ...target };
      finishing.current = true;
      changeCorrectionPhase("dropping");
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY };
    drawingRef.current = [start];
    setRewardPath([start]);
    setDrawing(true);
    setDrawHint("继续画，松手就兑现");
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const next = { x: event.clientX, y: event.clientY };
    setPointer(next);
    if (
      kind === "correction" &&
      correctionPhaseRef.current === "active" &&
      !finishing.current
    ) {
      setWhipTarget(next);
      return;
    }
    if (kind !== "reward" || !drawing || finishing.current) return;
    const last = drawingRef.current[drawingRef.current.length - 1];
    if (last && Math.hypot(next.x - last.x, next.y - last.y) < 4) return;
    drawingRef.current = [...drawingRef.current, next];
    setRewardPath(drawingRef.current);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (kind !== "reward" || !drawing || finishing.current) return;
    setDrawing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const points = drawingRef.current;
    const length = pathLength(points);
    const bounds = pointBounds(points);
    if (points.length < 6 || length < 70 || Math.max(bounds.width, bounds.height) < 34) {
      drawingRef.current = [];
      setRewardPath([]);
      setDrawHint("这个饼太小，再画大一点");
      return;
    }

    const size = Math.min(340, Math.max(170, Math.max(bounds.width, bounds.height) * 1.08));
    const x = Math.min(window.innerWidth - size / 2 - 12, Math.max(size / 2 + 12, bounds.x + bounds.width / 2));
    const y = Math.min(window.innerHeight - size / 2 - 12, Math.max(size / 2 + 12, bounds.y + bounds.height / 2));
    setRewardReveal({ x, y, size });
    setDrawHint("空气承诺，正在烘焙");
    playPieRevealTone();
    finishAction({ kind: "reward", x, y }, 1880);
  };

  const handleWhipStrike = useCallback((point: Point, intensity: number, angle: number) => {
    const hit: WhipHit = {
      ...point,
      id: crypto.randomUUID(),
      angle,
      intensity,
    };
    setWhipHits((current) => [...current.slice(-7), hit]);
    playWhipSnapTone(intensity);
  }, []);

  const handleWhipDropped = () => {
    const action = pendingCorrectionAction.current;
    if (!action) return;
    pendingCorrectionAction.current = null;
    finishAction(action, 0, false);
  };

  const correctionHint = correctionPhase === "dropping"
    ? "已放手…"
    : "高速甩动鼠标以此惩罚你那愚蠢的codex！单击放手结束，Esc撤回惩罚";
  const showToolCursor = Boolean(kind === "reward" && !impact);

  return (
    <div
      className={`desktop-overlay desktop-overlay--${kind ?? "idle"} ${impact ? "has-impact" : ""}`}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="application"
      aria-label={kind === "correction" ? "鞭打 Codex" : "在 Codex 上画一个大饼"}
    >
      {kind && !impact && (
        <div className={`overlay-exit-hint overlay-exit-hint--${kind}`}>
          {kind === "reward" ? `${drawHint} · Esc 退出` : correctionHint}
        </div>
      )}

      {kind === "correction" && !impact && (
        <WhipPhysics
          phase={correctionPhase}
          target={whipTarget}
          onStrike={handleWhipStrike}
          onDropped={handleWhipDropped}
        />
      )}

      {whipHits.map((hit) => (
        <div
          key={hit.id}
          className="physics-whip-hit"
          style={{
            left: hit.x,
            top: hit.y,
            "--hit-angle": `${hit.angle}deg`,
            "--hit-strength": hit.intensity,
            "--hit-ring-scale": 2.4 + hit.intensity * 0.9,
            "--hit-spark-distance": `${38 + hit.intensity * 20}px`,
          } as React.CSSProperties}
          aria-hidden="true"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) {
              setWhipHits((current) => current.filter(({ id }) => id !== hit.id));
            }
          }}
        >
          <span className="physics-whip-hit__ring" />
          <span className="physics-whip-hit__scar physics-whip-hit__scar--one" />
          <span className="physics-whip-hit__scar physics-whip-hit__scar--two" />
          {Array.from({ length: 5 }, (_, index) => (
            <i key={index} style={{ "--spark-angle": `${index * 72}deg` } as React.CSSProperties} />
          ))}
        </div>
      ))}

      {kind === "reward" && rewardPath.length > 0 && (
        <svg className="pie-drawing-layer" aria-hidden="true">
          <polyline points={rewardPath.map((point) => `${point.x},${point.y}`).join(" ")} />
        </svg>
      )}

      {showToolCursor && (
        <div
          className={`tool-cursor tool-cursor--${kind} ${drawing ? "is-drawing" : ""}`}
          style={{ left: pointer.x, top: pointer.y }}
          aria-hidden="true"
        >
          <PencilCursor />
        </div>
      )}

      {impact?.kind === "correction" && (
        <div className="whip-impact" style={{ left: impact.x, top: impact.y }} aria-hidden="true">
          <span className="whip-impact__swing" />
          <span className="whip-impact__scar whip-impact__scar--one" />
          <span className="whip-impact__scar whip-impact__scar--two" />
          {Array.from({ length: 7 }, (_, index) => (
            <i key={index} style={{ "--spark": `${index * 51}deg` } as React.CSSProperties} />
          ))}
        </div>
      )}

      {impact?.kind === "reward" && rewardReveal && (
        <div
          className="reward-pie-impact"
          style={{
            left: rewardReveal.x,
            top: rewardReveal.y,
            "--pie-size": `${rewardReveal.size}px`,
          } as React.CSSProperties}
          aria-hidden="true"
        >
          <span className="reward-pie-impact__halo" />
          <img className="reward-pie-impact__bread" src={rewardFlatbread} alt="" />
          <span className="reward-pie-impact__steam reward-pie-impact__steam--one" />
          <span className="reward-pie-impact__steam reward-pie-impact__steam--two" />
          <span className="reward-pie-impact__crumb reward-pie-impact__crumb--one" />
          <span className="reward-pie-impact__crumb reward-pie-impact__crumb--two" />
          <span className="reward-pie-impact__crumb reward-pie-impact__crumb--three" />
          <strong className="reward-pie-impact__message">这饼，居然落地了</strong>
        </div>
      )}
    </div>
  );
}

function PencilCursor() {
  return (
    <svg className="pencil-cursor" viewBox="0 0 72 72" role="presentation">
      <path className="pencil-cursor__shadow" d="M18 58 52 24" />
      <path className="pencil-cursor__body" d="m17 53 35-35 9 9-35 35-13 4Z" />
      <path className="pencil-cursor__band" d="m48 22 9 9" />
      <path className="pencil-cursor__wood" d="m13 66 4-13 9 9Z" />
      <path className="pencil-cursor__lead" d="m13 66 2-6 4 4Z" />
    </svg>
  );
}

function pathLength(points: Point[]) {
  return points.slice(1).reduce((total, point, index) => {
    const previous = points[index];
    return total + Math.hypot(point.x - previous.x, point.y - previous.y);
  }, 0);
}

function pointBounds(points: Point[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function playWhipSnapTone(intensity: number) {
  try {
    const context = new AudioContext();
    const noise = context.createBufferSource();
    const highFilter = context.createBiquadFilter();
    const bodyFilter = context.createBiquadFilter();
    const highGain = context.createGain();
    const bodyGain = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const now = context.currentTime;
    const duration = 0.145;
    const noiseBuffer = context.createBuffer(1, Math.round(context.sampleRate * duration), context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      const progress = index / samples.length;
      const transient = Math.exp(-progress * 38);
      const body = Math.exp(-progress * 9) * 0.36;
      samples[index] = (Math.random() * 2 - 1) * (transient + body);
    }
    noise.buffer = noiseBuffer;
    highFilter.type = "highpass";
    highFilter.frequency.value = 1650 + intensity * 500;
    bodyFilter.type = "bandpass";
    bodyFilter.frequency.value = 260;
    bodyFilter.Q.value = 0.72;
    highGain.gain.setValueAtTime(0.0001, now);
    highGain.gain.exponentialRampToValueAtTime(0.12 + intensity * 0.13, now + 0.002);
    highGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.052);
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.035 + intensity * 0.045, now + 0.006);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    compressor.threshold.value = -18;
    compressor.knee.value = 5;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.001;
    compressor.release.value = 0.07;

    noise.connect(highFilter);
    noise.connect(bodyFilter);
    highFilter.connect(highGain);
    bodyFilter.connect(bodyGain);
    highGain.connect(compressor);
    bodyGain.connect(compressor);
    compressor.connect(context.destination);
    noise.start(now);
    noise.stop(now + duration);
    noise.addEventListener("ended", () => closeAudioContext(context));
  } catch {
    // Keep the visual strike responsive when audio is unavailable.
  }
}

function playPieRevealTone() {
  try {
    const context = new AudioContext();
    const gain = context.createGain();
    const low = context.createOscillator();
    const high = context.createOscillator();
    const now = context.currentTime;

    low.type = "sine";
    low.frequency.setValueAtTime(150, now);
    low.frequency.exponentialRampToValueAtTime(310, now + 0.18);
    high.type = "triangle";
    high.frequency.setValueAtTime(420, now + 0.08);
    high.frequency.exponentialRampToValueAtTime(680, now + 0.26);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

    low.connect(gain);
    high.connect(gain);
    gain.connect(context.destination);
    low.start(now);
    high.start(now + 0.08);
    low.stop(now + 0.28);
    high.stop(now + 0.34);
    high.addEventListener("ended", () => closeAudioContext(context));
  } catch {
    // The drawing and transformation remain complete when audio is unavailable.
  }
}

function closeAudioContext(context: AudioContext) {
  if (context.state !== "closed") {
    void context.close().catch(() => undefined);
  }
}
