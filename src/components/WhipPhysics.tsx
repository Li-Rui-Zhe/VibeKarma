import { useEffect, useRef } from "react";

interface Point {
  x: number;
  y: number;
}

interface RopeNode extends Point {
  oldX: number;
  oldY: number;
}

export type WhipPhase = "active" | "dropping";

interface WhipPhysicsProps {
  phase: WhipPhase;
  target: Point;
  onStrike: (point: Point, intensity: number, angle: number) => void;
  onDropped: () => void;
}

const SETTINGS = {
  segments: 28,
  segmentLength: 25,
  taper: 0.6,
  gravity: 1.2,
  dropGravity: 0.95,
  damping: 0.96,
  constraintPasses: 20,
  maximumStretch: 1.2,
  baseAngle: -1.12,
  horizontalAim: 0.4,
  verticalAim: 0.2,
  aimClamp: 2,
  handleSpring: 0.7,
  handleAngularDamping: 0.078,
  basePoseSegments: 2,
  baseStiffnessStart: 0.9,
  baseStiffnessEnd: 0.8,
  handleMaximumBend: 16,
  tipMaximumBend: 130,
  bendRigidityStart: 0.8,
  bendRigidityEnd: 0.12,
  wallBounce: 0.42,
  wallFriction: 0.86,
  crackSpeed: 235,
  crackCooldown: 200,
  firstCrackGrace: 350,
  arcWidth: 260,
  arcHeight: 185,
} as const;

export function WhipPhysics({ phase, target, onStrike, onDropped }: WhipPhysicsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(phase);
  const targetRef = useRef(target);
  const onStrikeRef = useRef(onStrike);
  const onDroppedRef = useRef(onDropped);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    onStrikeRef.current = onStrike;
  }, [onStrike]);

  useEffect(() => {
    onDroppedRef.current = onDropped;
  }, [onDropped]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");
    if (!context) return undefined;

    let frame = 0;
    let lastCrackAt = 0;
    let spawnedAt = performance.now();
    let previousMouse = { ...targetRef.current };
    let handleAngle: number = SETTINGS.baseAngle;
    let handleAngularVelocity = 0;
    let dropReported = false;
    let activePhase = phaseRef.current;
    const nodes = createWhip(targetRef.current);

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(window.innerWidth * ratio));
      canvas.height = Math.max(1, Math.round(window.innerHeight * ratio));
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const update = () => {
      const requestedPhase = phaseRef.current;
      if (requestedPhase !== activePhase) {
        activePhase = requestedPhase;
        if (activePhase === "active") {
          spawnedAt = performance.now();
          lastCrackAt = 0;
          dropReported = false;
        }
      }

      const dropping = activePhase === "dropping";
      const mouse = targetRef.current;
      if (!dropping) {
        const movementX = mouse.x - previousMouse.x;
        const movementY = mouse.y - previousMouse.y;
        const aimDelta = clamp(
          movementX * SETTINGS.horizontalAim + movementY * SETTINGS.verticalAim,
          -SETTINGS.aimClamp,
          SETTINGS.aimClamp,
        );
        const targetAngle = SETTINGS.baseAngle + aimDelta;
        handleAngularVelocity += wrapPi(targetAngle - handleAngle) * SETTINGS.handleSpring;
        handleAngularVelocity *= SETTINGS.handleAngularDamping;
        handleAngle = wrapPi(handleAngle + handleAngularVelocity);
      }

      integrate(nodes, dropping ? 0 : 1, dropping ? SETTINGS.dropGravity : SETTINGS.gravity);
      if (!dropping) pinHandle(nodes[0], mouse);
      capStretch(nodes);
      if (!dropping) applyWallCollisions(nodes);
      if (!dropping) applyBasePose(nodes, handleAngle);

      for (let pass = 0; pass < SETTINGS.constraintPasses; pass += 1) {
        constrainDistances(nodes, dropping);
        applyBendLimits(nodes);
        if (!dropping) applyBasePose(nodes, handleAngle);
        capStretch(nodes);
        if (!dropping) applyWallCollisions(nodes);
      }

      const tip = nodes[nodes.length - 1];
      const tipVelocity = Math.hypot(tip.x - tip.oldX, tip.y - tip.oldY);
      const now = performance.now();
      if (
        !dropping &&
        tipVelocity > SETTINGS.crackSpeed &&
        now - spawnedAt >= SETTINGS.firstCrackGrace &&
        now - lastCrackAt > SETTINGS.crackCooldown
      ) {
        lastCrackAt = now;
        onStrikeRef.current(
          {
            x: clamp(tip.x, 12, window.innerWidth - 12),
            y: clamp(tip.y, 12, window.innerHeight - 12),
          },
          clamp((tipVelocity - SETTINGS.crackSpeed) / 360 + 0.5, 0.5, 1),
          Math.atan2(tip.y - tip.oldY, tip.x - tip.oldX) * 180 / Math.PI,
        );
      }

      if (dropping && !dropReported && nodes.every((node) => node.y > window.innerHeight + 60)) {
        dropReported = true;
        onDroppedRef.current();
      }
      previousMouse = { ...mouse };
    };

    const animate = () => {
      update();
      draw(context, nodes);
      frame = window.requestAnimationFrame(animate);
    };

    resize();
    window.addEventListener("resize", resize);
    frame = window.requestAnimationFrame(animate);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="whip-physics-canvas" aria-hidden="true" />;
}

function createWhip(handle: Point): RopeNode[] {
  return Array.from({ length: SETTINGS.segments }, (_, index) => {
    const progress = index / (SETTINGS.segments - 1);
    const x = handle.x + progress * SETTINGS.arcWidth;
    const y = handle.y - Math.sin(progress * Math.PI * 0.75) * SETTINGS.arcHeight;
    return { x, y, oldX: x, oldY: y };
  });
}

function segmentLength(index: number) {
  const progress = index / (SETTINGS.segments - 1);
  return SETTINGS.segmentLength * (1 - progress * (1 - SETTINGS.taper));
}

function integrate(nodes: RopeNode[], start: number, gravity: number) {
  for (let index = start; index < nodes.length; index += 1) {
    const node = nodes[index];
    const velocityX = (node.x - node.oldX) * SETTINGS.damping;
    const velocityY = (node.y - node.oldY) * SETTINGS.damping;
    node.oldX = node.x;
    node.oldY = node.y;
    node.x += velocityX;
    node.y += velocityY + gravity;
  }
}

function pinHandle(root: RopeNode, mouse: Point) {
  root.x = mouse.x;
  root.y = mouse.y;
  root.oldX = mouse.x;
  root.oldY = mouse.y;
}

function applyBasePose(nodes: RopeNode[], angle: number) {
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  const guided = Math.min(SETTINGS.basePoseSegments, nodes.length - 1);
  for (let index = 1; index <= guided; index += 1) {
    const progress = (index - 1) / Math.max(guided - 1, 1);
    const stiffness = lerp(
      SETTINGS.baseStiffnessStart,
      SETTINGS.baseStiffnessEnd,
      progress,
    );
    const previous = nodes[index - 1];
    const node = nodes[index];
    const length = segmentLength(index - 1);
    node.x = lerp(node.x, previous.x + directionX * length, stiffness);
    node.y = lerp(node.y, previous.y + directionY * length, stiffness);
  }
}

function capStretch(nodes: RopeNode[]) {
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const current = nodes[index];
    const next = nodes[index + 1];
    const dx = next.x - current.x;
    const dy = next.y - current.y;
    const distance = Math.max(0.0001, Math.hypot(dx, dy));
    const maximum = segmentLength(index) * SETTINGS.maximumStretch;
    if (distance <= maximum) continue;
    const ratio = maximum / distance;
    next.x = current.x + dx * ratio;
    next.y = current.y + dy * ratio;
  }
}

function constrainDistances(nodes: RopeNode[], dropping: boolean) {
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const current = nodes[index];
    const next = nodes[index + 1];
    const dx = next.x - current.x;
    const dy = next.y - current.y;
    const distance = Math.max(0.0001, Math.hypot(dx, dy));
    const difference = (distance - segmentLength(index)) / distance * 0.5;
    const offsetX = dx * difference;
    const offsetY = dy * difference;
    if (index === 0 && !dropping) {
      next.x -= offsetX * 2;
      next.y -= offsetY * 2;
    } else {
      current.x += offsetX;
      current.y += offsetY;
      next.x -= offsetX;
      next.y -= offsetY;
    }
  }
}

function applyBendLimits(nodes: RopeNode[]) {
  for (let index = 1; index < nodes.length - 1; index += 1) {
    const previous = nodes[index - 1];
    const current = nodes[index];
    const next = nodes[index + 1];
    const firstX = previous.x - current.x;
    const firstY = previous.y - current.y;
    const secondX = next.x - current.x;
    const secondY = next.y - current.y;
    const firstLength = Math.max(0.0001, Math.hypot(firstX, firstY));
    const secondLength = Math.max(0.0001, Math.hypot(secondX, secondY));
    const firstNormalX = firstX / firstLength;
    const firstNormalY = firstY / firstLength;
    const secondNormalX = secondX / secondLength;
    const secondNormalY = secondY / secondLength;
    const jointAngle = Math.acos(clamp(
      firstNormalX * secondNormalX + firstNormalY * secondNormalY,
      -1,
      1,
    ));
    const progress = index / (nodes.length - 2);
    const maximumBend = lerp(
      SETTINGS.handleMaximumBend,
      SETTINGS.tipMaximumBend,
      progress,
    ) * Math.PI / 180;
    if (Math.PI - jointAngle <= maximumBend) continue;

    const cross = firstNormalX * secondNormalY - firstNormalY * secondNormalX;
    const direction = cross >= 0 ? 1 : -1;
    const targetAngle = Math.atan2(firstNormalY, firstNormalX) + direction * (Math.PI - maximumBend);
    const targetX = current.x + Math.cos(targetAngle) * secondLength;
    const targetY = current.y + Math.sin(targetAngle) * secondLength;
    const rigidity = lerp(
      SETTINGS.bendRigidityStart,
      SETTINGS.bendRigidityEnd,
      progress,
    );
    next.x = lerp(next.x, targetX, rigidity);
    next.y = lerp(next.y, targetY, rigidity);
  }
}

function applyWallCollisions(nodes: RopeNode[]) {
  for (let index = 1; index < nodes.length; index += 1) {
    const node = nodes[index];
    let velocityX = node.x - node.oldX;
    let velocityY = node.y - node.oldY;
    let hit = false;

    if (node.x < 0 || node.x > window.innerWidth) {
      node.x = clamp(node.x, 0, window.innerWidth);
      velocityX = -velocityX * SETTINGS.wallBounce;
      velocityY *= SETTINGS.wallFriction;
      hit = true;
    }
    if (node.y < 0 || node.y > window.innerHeight) {
      node.y = clamp(node.y, 0, window.innerHeight);
      velocityY = -velocityY * SETTINGS.wallBounce;
      velocityX *= SETTINGS.wallFriction;
      hit = true;
    }
    if (hit) {
      node.oldX = node.x - velocityX;
      node.oldY = node.y - velocityY;
    }
  }
}

function draw(context: CanvasRenderingContext2D, nodes: RopeNode[]) {
  context.clearRect(0, 0, window.innerWidth, window.innerHeight);
  context.fillStyle = "rgba(0, 0, 0, 0.011)";
  context.fillRect(0, 0, window.innerWidth, window.innerHeight);
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  drawFullSpline(context, nodes, "rgba(255, 248, 238, 0.96)", 11);
  drawSplineSection(context, nodes, 0, 2, "rgba(255, 248, 238, 0.96)", 18);
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const progress = index / Math.max(1, nodes.length - 2);
    const extraWidth = index < 2 ? 5 : 0;
    drawSplineSection(
      context,
      nodes,
      index,
      index + 1,
      "#7a272c",
      lerp(7, 5, progress) + extraWidth,
    );
  }
  context.restore();
}

function drawFullSpline(
  context: CanvasRenderingContext2D,
  nodes: Point[],
  color: string,
  width: number,
) {
  context.beginPath();
  context.moveTo(nodes[0].x, nodes[0].y);
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const curve = splineSegment(nodes, index);
    context.bezierCurveTo(curve.cp1.x, curve.cp1.y, curve.cp2.x, curve.cp2.y, curve.end.x, curve.end.y);
  }
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}

function drawSplineSection(
  context: CanvasRenderingContext2D,
  nodes: Point[],
  start: number,
  end: number,
  color: string,
  width: number,
) {
  context.beginPath();
  context.moveTo(nodes[start].x, nodes[start].y);
  for (let index = start; index < Math.min(end, nodes.length - 1); index += 1) {
    const curve = splineSegment(nodes, index);
    context.bezierCurveTo(curve.cp1.x, curve.cp1.y, curve.cp2.x, curve.cp2.y, curve.end.x, curve.end.y);
  }
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}

function splineSegment(nodes: Point[], index: number) {
  const previous = extrapolatedPoint(nodes, index - 1);
  const start = nodes[index];
  const end = nodes[index + 1];
  const next = extrapolatedPoint(nodes, index + 2);
  return {
    cp1: { x: start.x + (end.x - previous.x) / 6, y: start.y + (end.y - previous.y) / 6 },
    cp2: { x: end.x - (next.x - start.x) / 6, y: end.y - (next.y - start.y) / 6 },
    end,
  };
}

function extrapolatedPoint(nodes: Point[], index: number): Point {
  if (index < 0) {
    return { x: nodes[0].x * 2 - nodes[1].x, y: nodes[0].y * 2 - nodes[1].y };
  }
  if (index >= nodes.length) {
    const last = nodes[nodes.length - 1];
    const previous = nodes[nodes.length - 2];
    return { x: last.x * 2 - previous.x, y: last.y * 2 - previous.y };
  }
  return nodes[index];
}

function wrapPi(value: number) {
  let wrapped = value;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
