import { describe, expect, it } from "vitest";
import { buildSearchResponse, createExcerpt, findConceptOccurrences, searchParagraphs, type SearchParagraph } from "./book-search";

const paragraphs: SearchParagraph[] = [
  { id: "p1", chapterId: "c1", chapterTitle: "第一章", paragraphIndex: 0, text: "分工提高劳动生产力。" },
  { id: "p2", chapterId: "c1", chapterTitle: "第一章", paragraphIndex: 1, text: "熟练、技巧和判断力都随分工而增长。" },
  { id: "p3", chapterId: "c2", chapterTitle: "第二章", paragraphIndex: 0, text: "交换使人能够获得自己需要的物品。" },
];

describe("book search", () => {
  it("finds keyword with stable offsets and neighboring context", () => {
    const results = searchParagraphs(paragraphs, "分工", 10, 1);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ paragraphId: "p1", startOffset: 0, endOffset: 2 });
    expect(results[0].context.after[0]?.id).toBe("p2");
    expect(results[1].context.before.some((item) => item.chapterId !== "c1")).toBe(false);
  });

  it("supports concept occurrences and chapter-independent search", () => {
    expect(findConceptOccurrences(paragraphs, "分工")).toHaveLength(2);
    expect(searchParagraphs(paragraphs, "交换")[0]?.chapterTitle).toBe("第二章");
  });

  it("normalizes blank queries and creates bounded excerpts", () => {
    expect(searchParagraphs(paragraphs, "   ")).toEqual([]);
    expect(createExcerpt("abcdefghij", 4, 2, 2)).toBe("…cdefgh…");
    expect(buildSearchResponse({ query: "分工", mode: "search", results: [] }).total).toBe(0);
  });
});
