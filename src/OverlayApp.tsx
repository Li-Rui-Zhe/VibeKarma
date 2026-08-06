import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import rewardFlatbread from "./assets/reward-flatbread.png";
import { WhipPhysics, type WhipPhase } from "./components/WhipPhysics";
import { buildRewardShape, type RewardShape } from "./lib/rewardShape";
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

interface RewardReveal extends RewardShape {
  x: number;
  y: number;
}

interface WhipHit extends Point {
  id: string;
  angle: number;
  intensity: number;
}

interface PencilScratchTone {
  context: AudioContext;
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  stopped: boolean;
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
  const pencilScratch = useRef<PencilScratchTone | null>(null);
  const lastPencilSoundAt = useRef(0);

  const resetReward = useCallback(() => {
    stopPencilScratchTone(pencilScratch.current);
    pencilScratch.current = null;
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
    stopPencilScratchTone(pencilScratch.current);
    pencilScratch.current = startPencilScratchTone();
    lastPencilSoundAt.current = event.timeStamp;
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
    const distance = last ? Math.hypot(next.x - last.x, next.y - last.y) : 0;
    if (last && distance < 4) return;
    const elapsed = Math.max(8, event.timeStamp - lastPencilSoundAt.current);
    updatePencilScratchTone(pencilScratch.current, distance / elapsed);
    lastPencilSoundAt.current = event.timeStamp;
    drawingRef.current = [...drawingRef.current, next];
    setRewardPath(drawingRef.current);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (kind !== "reward" || !drawing || finishing.current) return;
    setDrawing(false);
    stopPencilScratchTone(pencilScratch.current);
    pencilScratch.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const points = drawingRef.current;
    const length = pathLength(points);
    const shape = buildRewardShape(points);
    if (length < 70 || !shape) {
      drawingRef.current = [];
      setRewardPath([]);
      setDrawHint("轮廓太小或太薄，再画饱满一点");
      return;
    }

    const bounds = pointBounds(points);
    const x = Math.min(
      window.innerWidth - shape.renderWidth / 2 - 12,
      Math.max(shape.renderWidth / 2 + 12, bounds.x + bounds.width / 2),
    );
    const y = Math.min(
      window.innerHeight - shape.renderHeight / 2 - 12,
      Math.max(shape.renderHeight / 2 + 12, bounds.y + bounds.height / 2),
    );
    setRewardReveal({ ...shape, x, y });
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
    playWhipSnapTone(intensity, point.x / window.innerWidth * 2 - 1);
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
            "--pie-width": `${rewardReveal.renderWidth}px`,
            "--pie-height": `${rewardReveal.renderHeight}px`,
            "--pie-size": `${Math.max(rewardReveal.renderWidth, rewardReveal.renderHeight)}px`,
          } as React.CSSProperties}
          aria-hidden="true"
        >
          <span className="reward-pie-impact__halo" />
          <svg
            className="reward-pie-impact__bread"
            viewBox={`0 0 ${rewardReveal.viewWidth} ${rewardReveal.viewHeight}`}
            preserveAspectRatio="none"
          >
            <defs>
              <clipPath id="reward-pie-shape">
                <path d={rewardReveal.path} />
              </clipPath>
              <radialGradient id="reward-pie-base" cx="44%" cy="38%" r="72%">
                <stop offset="0%" stopColor="#ffd972" />
                <stop offset="62%" stopColor="#eeb044" />
                <stop offset="100%" stopColor="#b96a16" />
              </radialGradient>
            </defs>
            <path className="reward-pie-impact__crust" d={rewardReveal.path} />
            <g clipPath="url(#reward-pie-shape)">
              <rect width="100%" height="100%" fill="url(#reward-pie-base)" />
              <image
                className="reward-pie-impact__texture"
                href={rewardFlatbread}
                x={-rewardReveal.viewWidth * 0.25}
                y={-rewardReveal.viewHeight * 0.25}
                width={rewardReveal.viewWidth * 1.5}
                height={rewardReveal.viewHeight * 1.5}
                preserveAspectRatio="xMidYMid slice"
              />
              <rect className="reward-pie-impact__glaze" width="100%" height="100%" />
            </g>
            <path className="reward-pie-impact__rim" d={rewardReveal.path} />
          </svg>
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

function playWhipSnapTone(intensity: number, pan: number) {
  try {
    const context = new AudioContext();
    const noise = context.createBufferSource();
    const highFilter = context.createBiquadFilter();
    const bodyFilter = context.createBiquadFilter();
    const highGain = context.createGain();
    const bodyGain = context.createGain();
    const thump = context.createOscillator();
    const thumpGain = context.createGain();
    const roomDelay = context.createDelay(0.12);
    const roomGain = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const stereo = context.createStereoPanner();
    const master = context.createGain();
    const now = context.currentTime;
    const strength = Math.min(1, Math.max(0.5, intensity));
    const duration = 0.22;
    const noiseBuffer = context.createBuffer(1, Math.round(context.sampleRate * duration), context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      const progress = index / samples.length;
      const tipCrack = Math.exp(-progress * 82) * 1.3;
      const leatherSlap = Math.exp(-progress * 16) * 0.58;
      const roughness = 0.82 + Math.sin(index * 0.31) * 0.18;
      samples[index] = (Math.random() * 2 - 1) * (tipCrack + leatherSlap) * roughness;
    }
    noise.buffer = noiseBuffer;
    highFilter.type = "highpass";
    highFilter.frequency.value = 2100 + strength * 1200;
    bodyFilter.type = "bandpass";
    bodyFilter.frequency.value = 430 + strength * 210;
    bodyFilter.Q.value = 0.86;
    highGain.gain.setValueAtTime(0.0001, now);
    highGain.gain.exponentialRampToValueAtTime(0.2 + strength * 0.18, now + 0.0015);
    highGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.085 + strength * 0.095, now + 0.004);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);

    thump.type = "sine";
    thump.frequency.setValueAtTime(105 + strength * 22, now);
    thump.frequency.exponentialRampToValueAtTime(43, now + 0.16);
    thumpGain.gain.setValueAtTime(0.0001, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.075 + strength * 0.075, now + 0.006);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);

    roomDelay.delayTime.value = 0.052;
    roomGain.gain.value = 0.055 + strength * 0.025;
    compressor.threshold.value = -20;
    compressor.knee.value = 4;
    compressor.ratio.value = 7;
    compressor.attack.value = 0.0008;
    compressor.release.value = 0.11;
    stereo.pan.value = Math.min(0.7, Math.max(-0.7, pan * 0.7));
    master.gain.value = 0.82;

    noise.connect(highFilter);
    noise.connect(bodyFilter);
    highFilter.connect(highGain);
    bodyFilter.connect(bodyGain);
    highGain.connect(compressor);
    bodyGain.connect(compressor);
    thump.connect(thumpGain);
    thumpGain.connect(compressor);
    bodyGain.connect(roomDelay);
    roomDelay.connect(roomGain);
    roomGain.connect(compressor);
    compressor.connect(stereo);
    stereo.connect(master);
    master.connect(context.destination);
    noise.start(now);
    noise.stop(now + duration);
    thump.start(now);
    thump.stop(now + 0.2);
    noise.addEventListener("ended", () => {
      window.setTimeout(() => closeAudioContext(context), 90);
    });
  } catch {
    // Keep the visual strike responsive when audio is unavailable.
  }
}

function startPencilScratchTone(): PencilScratchTone | null {
  try {
    const context = new AudioContext();
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const bufferDuration = 0.64;
    const buffer = context.createBuffer(
      1,
      Math.round(context.sampleRate * bufferDuration),
      context.sampleRate,
    );
    const samples = buffer.getChannelData(0);

    for (let index = 0; index < samples.length; index += 1) {
      const grain = 0.62 + Math.sin(index * 0.17) * 0.13 + Math.sin(index * 0.037) * 0.09;
      samples[index] = (Math.random() * 2 - 1) * grain;
    }

    source.buffer = buffer;
    source.loop = true;
    filter.type = "bandpass";
    filter.frequency.value = 1850;
    filter.Q.value = 0.78;
    gain.gain.value = 0.0001;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start();

    return { context, source, filter, gain, stopped: false };
  } catch {
    return null;
  }
}

function updatePencilScratchTone(tone: PencilScratchTone | null, speed: number) {
  if (!tone || tone.stopped) return;
  const now = tone.context.currentTime;
  const energy = Math.min(1, Math.max(0.12, speed / 1.15));
  const level = 0.024 + energy * 0.06;
  tone.gain.gain.cancelScheduledValues(now);
  tone.gain.gain.setValueAtTime(Math.max(0.0001, tone.gain.gain.value), now);
  tone.gain.gain.exponentialRampToValueAtTime(level, now + 0.008);
  tone.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.072);
  tone.filter.frequency.cancelScheduledValues(now);
  tone.filter.frequency.setTargetAtTime(1450 + energy * 1650, now, 0.012);
}

function stopPencilScratchTone(tone: PencilScratchTone | null) {
  if (!tone || tone.stopped) return;
  tone.stopped = true;
  const now = tone.context.currentTime;
  tone.gain.gain.cancelScheduledValues(now);
  tone.gain.gain.setValueAtTime(Math.max(0.0001, tone.gain.gain.value), now);
  tone.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
  tone.source.stop(now + 0.055);
  tone.source.addEventListener("ended", () => closeAudioContext(tone.context));
}

function playPieRevealTone() {
  try {
    const context = new AudioContext();
    const now = context.currentTime;
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    master.gain.value = 0.96;
    compressor.threshold.value = -22;
    compressor.knee.value = 6;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.16;
    master.connect(compressor);
    compressor.connect(context.destination);

    // A short, warm oven breath while the drawn outline fills with bread texture.
    const bakeNoise = context.createBufferSource();
    const bakeFilter = context.createBiquadFilter();
    const bakeGain = context.createGain();
    const bakeDuration = 0.52;
    const bakeBuffer = context.createBuffer(
      1,
      Math.round(context.sampleRate * bakeDuration),
      context.sampleRate,
    );
    const bakeSamples = bakeBuffer.getChannelData(0);
    for (let index = 0; index < bakeSamples.length; index += 1) {
      const progress = index / bakeSamples.length;
      const envelope = Math.sin(Math.PI * progress) * Math.exp(-progress * 0.9);
      bakeSamples[index] = (Math.random() * 2 - 1) * envelope;
    }
    bakeNoise.buffer = bakeBuffer;
    bakeFilter.type = "bandpass";
    bakeFilter.frequency.setValueAtTime(720, now);
    bakeFilter.frequency.exponentialRampToValueAtTime(1380, now + bakeDuration);
    bakeFilter.Q.value = 0.7;
    bakeGain.gain.setValueAtTime(0.0001, now);
    bakeGain.gain.exponentialRampToValueAtTime(0.052, now + 0.12);
    bakeGain.gain.exponentialRampToValueAtTime(0.0001, now + bakeDuration);
    bakeNoise.connect(bakeFilter);
    bakeFilter.connect(bakeGain);
    bakeGain.connect(master);

    // A rounded rising body gives the impression that the flatbread is puffing up.
    const rise = context.createOscillator();
    const riseGain = context.createGain();
    rise.type = "sine";
    rise.frequency.setValueAtTime(138, now);
    rise.frequency.exponentialRampToValueAtTime(238, now + 0.46);
    riseGain.gain.setValueAtTime(0.0001, now);
    riseGain.gain.exponentialRampToValueAtTime(0.112, now + 0.11);
    riseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.54);
    rise.connect(riseGain);
    riseGain.connect(master);

    // The soft low drop is the moment the finished bread lands on screen.
    const landing = context.createOscillator();
    const landingGain = context.createGain();
    landing.type = "sine";
    landing.frequency.setValueAtTime(112, now + 0.46);
    landing.frequency.exponentialRampToValueAtTime(54, now + 0.68);
    landingGain.gain.setValueAtTime(0.0001, now);
    landingGain.gain.setValueAtTime(0.0001, now + 0.45);
    landingGain.gain.exponentialRampToValueAtTime(0.24, now + 0.475);
    landingGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    landing.connect(landingGain);
    landingGain.connect(master);

    // Two restrained overtones add a small golden glint without becoming a coin jingle.
    const glintFrequencies = [659.25, 987.77];
    const glints = glintFrequencies.map((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + 0.53 + index * 0.11;
      const stop = start + 0.42;
      oscillator.type = index === 0 ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.985, stop);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(index === 0 ? 0.07 : 0.04, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, stop);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(start);
      oscillator.stop(stop);
      return oscillator;
    });

    bakeNoise.start(now);
    bakeNoise.stop(now + bakeDuration);
    rise.start(now);
    rise.stop(now + 0.56);
    landing.start(now + 0.45);
    landing.stop(now + 0.72);
    glints[glints.length - 1].addEventListener("ended", () => closeAudioContext(context));
  } catch {
    // The drawing and transformation remain complete when audio is unavailable.
  }
}

function closeAudioContext(context: AudioContext) {
  if (context.state !== "closed") {
    void context.close().catch(() => undefined);
  }
}
