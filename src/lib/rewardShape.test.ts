import { describe, expect, it } from "vitest";
import { buildRewardShape } from "./rewardShape";

describe("buildRewardShape", () => {
  it("keeps the user's wide silhouette instead of forcing a square pie", () => {
    const shape = buildRewardShape([
      { x: 10, y: 20 },
      { x: 60, y: 5 },
      { x: 130, y: 8 },
      { x: 180, y: 24 },
      { x: 130, y: 52 },
      { x: 55, y: 50 },
      { x: 10, y: 20 },
    ]);

    expect(shape).not.toBeNull();
    expect(shape!.path.endsWith("Z")).toBe(true);
    expect(shape!.renderWidth).toBeGreaterThan(shape!.renderHeight * 2);
    expect(Math.max(shape!.renderWidth, shape!.renderHeight)).toBeLessThanOrEqual(340);
  });

  it("rejects a stroke that is too thin to become a filled bread", () => {
    expect(buildRewardShape([
      { x: 0, y: 0 },
      { x: 20, y: 1 },
      { x: 40, y: 0 },
      { x: 60, y: 1 },
      { x: 80, y: 0 },
      { x: 100, y: 1 },
    ])).toBeNull();
  });
});
