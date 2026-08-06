import { describe, expect, it } from "vitest";
import type { DiaryEntry } from "../types";
import {
  buildBookSheets,
  getBookProgress,
  getFirstContentSpreadPage,
  getLastContentSpreadPage,
  paginateDiaryBody,
} from "./DiaryBook";

function diary(id: string, body = "今天只记这一小段。"): DiaryEntry {
  return {
    id,
    createdAt: "2026-07-30T12:00:00+08:00",
    kind: "奖励日记",
    title: `奖励日记：${id}`,
    body,
    reason: null,
    path: "",
    threadId: null,
    turnId: null,
    generatedByCodex: true,
  };
}

describe("diary book pagination", () => {
  it("keeps every visible character when a long diary continues onto more pages", () => {
    const body = [
      "第一段。".repeat(90),
      "第二段写得更长一些！".repeat(55),
      "最后一段结束。".repeat(50),
    ].join("\n\n");

    const pages = paginateDiaryBody(body);

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join("").replace(/\s/g, "")).toBe(body.replace(/\s/g, ""));
    expect(pages.every((page) => page.replace(/\s/g, "").length <= 365)).toBe(true);
  });

  it("fills continuation pages close to the page limit instead of breaking a quarter-page early", () => {
    const body = "这一句会自然结束。".repeat(180);
    const pages = paginateDiaryBody(body);

    expect(pages.length).toBeGreaterThan(2);
    expect(pages.slice(0, -1).every((page) => page.replace(/\s/g, "").length >= 300)).toBe(true);
    expect(pages.join("").replace(/\s/g, "")).toBe(body.replace(/\s/g, ""));
  });

  it("marks every continuation sheet except the final sheet", () => {
    const layout = buildBookSheets([diary("长日记", "这一段会继续。".repeat(160))]);
    const sheets = layout.sheets.filter((sheet) => sheet.type === "diary");

    expect(sheets.length).toBeGreaterThan(1);
    expect(sheets.slice(0, -1).every((sheet) => sheet.hasNextPart)).toBe(true);
    expect(sheets.at(-1)?.hasNextPart).toBe(false);
  });

  it("opens with the previous diary on the left and the newest diary on the right", () => {
    const layout = buildBookSheets([diary("之前"), diary("刚写")]);

    expect(layout.latestPage % 2).toBe(0);
    expect(layout.sheets[layout.latestPage - 2]).toMatchObject({
      type: "diary",
      diary: { id: "之前" },
    });
    expect(layout.sheets[layout.latestPage - 1]).toMatchObject({
      type: "diary",
      diary: { id: "刚写" },
      partIndex: 0,
    });
  });

  it("keeps any parity flyleaf at the front instead of between recent diaries", () => {
    const layout = buildBookSheets([diary("更早"), diary("之前"), diary("刚写")]);

    expect(layout.latestPage % 2).toBe(0);
    expect(layout.sheets[0]).toMatchObject({ type: "blank" });
    expect(layout.sheets[layout.latestPage - 2]).toMatchObject({
      type: "diary",
      diary: { id: "之前" },
    });
    expect(layout.sheets[layout.latestPage - 1]).toMatchObject({
      type: "diary",
      diary: { id: "刚写" },
    });
    expect(layout.sheets.filter((sheet) => sheet.type === "diary").at(-1)).toMatchObject({
      type: "diary",
      diary: { id: "刚写" },
    });
  });

  it("keeps both covers and flyleaves out of diary page numbering", () => {
    const layout = buildBookSheets([diary("更早"), diary("之前"), diary("刚写")]);
    const diarySheets = layout.sheets.filter((sheet) => sheet.type === "diary");

    expect(diarySheets.map((sheet) => sheet.pageNumber)).toEqual([1, 2, 3]);
    expect(layout.contentPageCount).toBe(3);
    expect(layout.physicalPageCount).toBe(layout.sheets.length + 2);
    expect(getBookProgress(layout, 0)).toBeNull();
    expect(getBookProgress(layout, layout.physicalPageCount - 1)).toBeNull();
  });

  it("adds an unnumbered back flyleaf so the back cover closes by itself", () => {
    const layout = buildBookSheets([diary("一篇写了两页")], () => ["第一页", "第二页"]);
    const backCoverPage = layout.physicalPageCount - 1;

    expect(backCoverPage % 2).toBe(1);
    expect(layout.sheets.at(-1)).toMatchObject({ type: "blank" });
    expect(getBookProgress(layout, layout.latestPage)).toEqual({ current: 2, total: 2 });
  });

  it("jumps to the first content spread instead of the front cover", () => {
    const withFlyleaf = buildBookSheets([diary("更早"), diary("之前"), diary("刚写")]);
    const withoutFlyleaf = buildBookSheets([diary("更早"), diary("刚写")]);
    const empty = buildBookSheets([]);

    expect(getFirstContentSpreadPage(withFlyleaf)).toBe(1);
    expect(getFirstContentSpreadPage(withoutFlyleaf)).toBe(1);
    expect(getFirstContentSpreadPage(empty)).toBeNull();
  });

  it("jumps to the last content spread instead of the back cover", () => {
    const onePage = buildBookSheets([diary("唯一一篇")]);
    const twoPages = buildBookSheets([diary("一篇写了两页")], () => ["第一页", "第二页"]);
    const empty = buildBookSheets([]);

    expect(getLastContentSpreadPage(onePage)).toBe(1);
    expect(getLastContentSpreadPage(twoPages)).toBe(3);
    expect(getLastContentSpreadPage(twoPages)).toBeLessThan(twoPages.physicalPageCount - 1);
    expect(getLastContentSpreadPage(empty)).toBeNull();
  });
});
