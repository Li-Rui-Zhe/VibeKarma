export interface RewardShapePoint {
  x: number;
  y: number;
}

export interface RewardShape {
  path: string;
  viewWidth: number;
  viewHeight: number;
  renderWidth: number;
  renderHeight: number;
}

const SHAPE_PADDING = 12;
const MIN_SHAPE_EDGE = 14;
const MIN_RENDER_SIZE = 170;
const MAX_RENDER_SIZE = 340;

export function buildRewardShape(points: RewardShapePoint[]): RewardShape | null {
  if (points.length < 6) return null;

  const bounds = pointBounds(points);
  if (Math.max(bounds.width, bounds.height) < 34 || Math.min(bounds.width, bounds.height) < MIN_SHAPE_EDGE) {
    return null;
  }

  const minDistance = Math.max(4, Math.max(bounds.width, bounds.height) / 90);
  const simplified = simplifyPoints(points, minDistance);
  if (simplified.length < 3) return null;

  const localPoints = simplified.map((point) => ({
    x: point.x - bounds.x + SHAPE_PADDING,
    y: point.y - bounds.y + SHAPE_PADDING,
  }));
  const viewWidth = bounds.width + SHAPE_PADDING * 2;
  const viewHeight = bounds.height + SHAPE_PADDING * 2;
  const viewMax = Math.max(viewWidth, viewHeight);
  const targetMax = Math.min(MAX_RENDER_SIZE, Math.max(MIN_RENDER_SIZE, viewMax * 1.08));
  const scale = targetMax / viewMax;

  return {
    path: smoothClosedPath(localPoints),
    viewWidth,
    viewHeight,
    renderWidth: viewWidth * scale,
    renderHeight: viewHeight * scale,
  };
}

function simplifyPoints(points: RewardShapePoint[], minDistance: number) {
  const simplified = [points[0]];
  for (const point of points.slice(1, -1)) {
    const previous = simplified[simplified.length - 1];
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= minDistance) {
      simplified.push(point);
    }
  }
  const last = points[points.length - 1];
  if (last !== simplified[simplified.length - 1]) simplified.push(last);
  return simplified;
}

function smoothClosedPath(points: RewardShapePoint[]) {
  const midpoint = (a: RewardShapePoint, b: RewardShapePoint) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const format = (value: number) => Number(value.toFixed(2));
  const last = points[points.length - 1];
  const start = midpoint(last, points[0]);
  const commands = [`M ${format(start.x)} ${format(start.y)}`];

  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const end = midpoint(point, next);
    commands.push(`Q ${format(point.x)} ${format(point.y)} ${format(end.x)} ${format(end.y)}`);
  });
  commands.push("Z");
  return commands.join(" ");
}

function pointBounds(points: RewardShapePoint[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
