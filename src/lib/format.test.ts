import { describe, expect, it } from "vitest";
import { activityFromItem, parseExtraEnv, shortPath } from "./format";

describe("parseExtraEnv", () => {
  it("parses CCSwitch-style environment overrides", () => {
    expect(parseExtraEnv("OPENAI_BASE_URL=https://example.test\n# ignored\nTOKEN=a=b")).toEqual({
      OPENAI_BASE_URL: "https://example.test",
      TOKEN: "a=b",
    });
  });
});

describe("activityFromItem", () => {
  it("summarizes file changes", () => {
    const activity = activityFromItem({
      id: "item-1",
      type: "fileChange",
      status: "completed",
      changes: [{ path: "src/App.tsx" }, { path: "src/styles.css" }],
    });
    expect(activity?.title).toBe("修改 2 个文件");
    expect(activity?.detail).toContain("src/App.tsx");
  });
});

describe("shortPath", () => {
  it("keeps the final two path segments", () => {
    expect(shortPath("C:\\Users\\admin\\Desktop\\VibeKarma")).toBe("…/Desktop/VibeKarma");
  });
});

