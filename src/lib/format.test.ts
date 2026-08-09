import { describe, expect, it } from "vitest";
import { formatDiaryDate } from "./format";

describe("formatDiaryDate", () => {
  it("keeps an invalid date unchanged", () => {
    expect(formatDiaryDate("不是日期")).toBe("不是日期");
  });

  it("formats a diary timestamp for the Chinese interface", () => {
    const localTimestamp = new Date(2026, 7, 3, 11, 23).toISOString();
    const formatted = formatDiaryDate(localTimestamp);
    expect(formatted).toContain("8月3日");
    expect(formatted).toContain("11:23");
  });
});
