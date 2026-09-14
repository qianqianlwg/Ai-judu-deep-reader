import { describe, expect, it } from "vitest";
import { createReadingAnchor, findPageIndexForAnchor, paginateParagraphs } from "./pagination";

type TestParagraph = { id: string; text: string; chapterId: string; chapterTitle: string };

const paragraphs: TestParagraph[] = Array.from({ length: 5 }, (_, index) => ({
  id: `p${index + 1}`,
  text: "complex reading text ".repeat(8),
  chapterId: "c1",
  chapterTitle: "Chapter One",
}));

describe("paginateParagraphs", () => {
  it("splits pages by available height without losing paragraph text", () => {
    const pages = paginateParagraphs(paragraphs, { availableWidth: 420, availableHeight: 420 });
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap((page) => page.paragraphs).map((item) => item.text).join("")).toBe(paragraphs.map((item) => item.text).join(""));
  });

  it("starts a new page when the chapter changes", () => {
    const pages = paginateParagraphs([paragraphs[0], { ...paragraphs[1], id: "p2", chapterId: "c2", chapterTitle: "Chapter Two" }], { availableWidth: 600, availableHeight: 1000 });
    expect(pages).toHaveLength(2);
    expect(pages[1].isChapterStart).toBe(true);
  });

  it("merges paragraphs when enough space is available", () => {
    const pages = paginateParagraphs(paragraphs, { availableWidth: 600, availableHeight: 1000 });
    expect(pages.map((page) => page.pageNumber)).toEqual([1]);
    expect(pages[0].paragraphs).toHaveLength(5);
  });

  it("splits an oversized paragraph into fragments without cutting text", () => {
    const source: TestParagraph = { id: "long", text: "long paragraph. ".repeat(200), chapterId: "c1", chapterTitle: "Chapter One" };
    const pages = paginateParagraphs([source], { availableWidth: 320, availableHeight: 300, topReserve: 100 });
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap((page) => page.paragraphs).map((item) => item.text).join("")).toBe(source.text);
  });
});

describe("reading anchor restoration", () => {
  it("restores a split paragraph after re-pagination using its source offset", () => {
    const source: TestParagraph = { id: "long", text: "long paragraph. ".repeat(240), chapterId: "c1", chapterTitle: "Chapter One" };
    const oldPages = paginateParagraphs([source], { availableWidth: 320, availableHeight: 300, topReserve: 100 });
    const oldAnchor = createReadingAnchor(oldPages[1]);
    expect(oldAnchor).not.toBeNull();

    const newPages = paginateParagraphs([source], { availableWidth: 600, availableHeight: 300, topReserve: 100 });
    const restoredIndex = findPageIndexForAnchor(newPages, oldAnchor!);
    expect(restoredIndex).toBeGreaterThanOrEqual(0);
    const restoredPage = newPages[restoredIndex];
    expect(restoredPage.paragraphs.some((paragraph) => {
      const start = paragraph.sourceStartOffset ?? 0;
      const end = paragraph.sourceEndOffset ?? start + Array.from(paragraph.text).length;
      return oldAnchor!.offset >= start && oldAnchor!.offset < end;
    })).toBe(true);
  });

  it("distinguishes identical paragraph fragments by source offset", () => {
    const source: TestParagraph = { id: "p1", text: "abcdefghij ".repeat(80), chapterId: "c1", chapterTitle: "Chapter One" };
    const pages = paginateParagraphs([source], { availableWidth: 280, availableHeight: 260, topReserve: 100 });
    const fragment = pages.flatMap((page, pageIndex) => page.paragraphs.map((paragraph) => ({ pageIndex, paragraph }))).find(({ paragraph }) => (paragraph.sourceStartOffset ?? 0) > 0);
    expect(fragment).toBeDefined();
    expect(findPageIndexForAnchor(pages, { paragraphId: "p1", offset: fragment!.paragraph.sourceStartOffset! })).toBe(fragment!.pageIndex);
  });
});
