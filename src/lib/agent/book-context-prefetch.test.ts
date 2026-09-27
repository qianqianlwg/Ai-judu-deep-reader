import { describe, expect, it, vi } from "vitest";
import type { BookRetrievalResult, RetrievedSource } from "../book-retrieval";
import { prefetchBookContext } from "./book-context-prefetch";

type QueryInput = Parameters<Parameters<typeof prefetchBookContext>[0]["retrieve"]>[0];
const source = (paragraphId: string, text: string): RetrievedSource => ({ sourceId: "book:edition:paragraph:" + paragraphId, paragraphId, chapterId: paragraphId.startsWith("old") ? "chapter-1" : "chapter-5", chapterTitle: paragraphId.startsWith("old") ? "第一章" : "第五章", text, startOffset: 0, endOffset: text.length, channels: ["semantic"] });
const results = (sources: RetrievedSource[], effectiveMode: "semantic" | "none" = "semantic"): BookRetrievalResult => ({ results: [], sources, retrieval: { version: 1, requestedMode: "semantic", effectiveMode, queries: ["思想"], branches: [{ query: "思想", strategy: "semantic", status: effectiveMode === "none" ? "skipped" : "completed", count: sources.length, durationMs: 1, ...(effectiveMode === "none" ? { reason: "本书索引未完成" } : {}) }], durationMs: 1, sourceCount: sources.length, degraded: effectiveMode === "none" } });
describe("句读前关联原文", () => {
  it("长选文只发送首尾短查询；排除整个选区、已预载邻段和异处相同选文", async () => {
    const selection = "开篇的独特论证".repeat(55) + "\n\n" + "结尾的特有论述".repeat(55);
    const retrieve = vi.fn(async (input: QueryInput) => { expect(input.mode).toBe("semantic"); return results([source("selected-1", selection.slice(0, 100)), source("selected-2", selection.slice(-100)), source("neighbor", "邻段早已在上下文中"), source("duplicate", selection.split("\n\n")[0]), source("old-1", "第一章说明理性的界限，也论述世界整体的矛盾。"), source("old-2", "另一条关于理性界限的相关解释。")]); });
    const found = await prefetchBookContext({ selectedText: selection, selectedParagraphIds: ["selected-1", "selected-2"], alreadyProvidedIds: ["neighbor"], retrieve, signal: new AbortController().signal });
    expect(found.sources.map(item => item.paragraphId)).toEqual(["old-1", "old-2"]);
    expect(retrieve).toHaveBeenCalledOnce();
    const input = retrieve.mock.calls[0]![0];
    expect(input.mode).toBe("semantic");
    expect(input.query.length).toBeLessThanOrEqual(300);
    expect(input.additionalQueries?.[0].length).toBeLessThanOrEqual(300);
    expect(JSON.stringify(input)).not.toContain(selection);
  });
  it("索引未建立时显式降级，不私自用选文做关键词检索", async () => {
    const retrieve = vi.fn(async (input: QueryInput) => { expect(input.mode).toBe("semantic"); return results([], "none"); });
    expect(await prefetchBookContext({ selectedText: "当前段落", selectedParagraphIds: [], alreadyProvidedIds: [], retrieve, signal: new AbortController().signal })).toMatchObject({ status: "unavailable", reason: "本书索引未完成", sources: [] });
    expect(retrieve.mock.calls[0]![0].mode).toBe("semantic");
  });
  it("同一段落多次命中仍只取不超过三条关联来源，并截短注入内容", async () => {
    const retrieve = vi.fn(async (input: QueryInput) => { expect(input.mode).toBe("semantic"); return results([source("a", "甲".repeat(1000)), source("b", "乙".repeat(900)), source("c", "丙".repeat(800)), source("d", "丁".repeat(700))]); });
    const result = await prefetchBookContext({ selectedText: "独立的段落用于句读", selectedParagraphIds: [], alreadyProvidedIds: [], retrieve, signal: new AbortController().signal });
    expect(result.sources).toHaveLength(3);
    expect(result.sources.every(item => item.text.length <= 650)).toBe(true);
  });
});
