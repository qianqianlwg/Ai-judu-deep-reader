import { describe, expect, it } from "vitest";
import { paginateMeasuredParagraphs, type PageMeasure } from "./measured-pagination";
import { createReadingAnchor, findPageIndexForAnchor } from "./pagination";
const source = [{ id: "p", chapterId: "c", chapterTitle: "标题", text: "中英Mixed😀文字，标点。".repeat(120) }];
const measure = (columns: number): PageMeasure => (parts, title) => (title ? 45 : 0) + parts.reduce((sum, p) => sum + Math.ceil(Array.from(p.text).length / columns) * 30 + 18, 0);
describe("按实测高度分页", () => {
  it("完整覆盖 UTF16 原文、无重复漏字且每页在选区栏上方", async () => {
    const fn = measure(25);
    const pages = await paginateMeasuredParagraphs(source, { height: 230, measure: fn });
    expect(pages.flatMap(p => p.paragraphs).map(p => p.text).join("")).toBe(source[0].text);
    let end = 0;
    for (const page of pages) {
      expect(fn(page.paragraphs, page.isChapterStart ? page.chapterTitle : undefined)).toBeLessThanOrEqual(228);
      for (const p of page.paragraphs) {
        expect(p.sourceStartOffset).toBe(end); expect(source[0].text.slice(p.sourceStartOffset, p.sourceEndOffset)).toBe(p.text);
        expect(p.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u); end = p.sourceEndOffset!;
      }
    }
  });
  it("宽窄往返后第二页开头完全一致，锚点不被临时新页首覆盖", async () => {
    const first = await paginateMeasuredParagraphs(source, { height: 230, measure: measure(25) });
    const anchor = createReadingAnchor(first[1])!;
    const wide = await paginateMeasuredParagraphs(source, { height: 230, measure: measure(40) });
    expect(findPageIndexForAnchor(wide, anchor)).toBeGreaterThanOrEqual(0);
    const restored = await paginateMeasuredParagraphs(source, { height: 230, measure: measure(25) });
    expect(findPageIndexForAnchor(restored, anchor)).toBe(1);
    expect(restored[1].paragraphs[0].text).toBe(first[1].paragraphs[0].text);
  });
  it("测量器对超长标题和区域过小明确报错，不静默裁切", async () => {
    await expect(paginateMeasuredParagraphs(source, { height: 20, measure: measure(10) })).rejects.toThrow("区域过小");
  });
  it("取消过时的分页任务", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(paginateMeasuredParagraphs(source, { height: 230, measure: measure(20), signal: controller.signal })).rejects.toThrow();
  });
});
