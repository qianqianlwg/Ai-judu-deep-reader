import type { ReadingDetail } from "../reading-detail";
import type { RetrievalReport } from "../retrieval-report";
import { tool } from "langchain";
import type { Analysis } from "../chat-stream";
import { anchorParts, type ReadingAnchor } from "../reading-anchors";
import { readSourceSchema, saveAnalysisSchema, searchBookSchema, type ReadSourceInput, type SearchBookInput } from "./schemas";

export type BookSource = { sourceId: string; paragraphId: string; chapterId: string; chapterTitle: string; text: string; channels?: ("keyword" | "semantic")[]; excerpts?: string[]; origin?: "context" | "search" | "read"; evidence?: { text: string; origin: "context" | "search" | "read" }[] };
export type SavedReadingAnalysis = Analysis & { anchor?: ReadingAnchor };
export type ReadingToolDependencies = {
  messageId: string;
  selectedText: string;
  detail?: ReadingDetail;
  anchor?: ReadingAnchor;
  search: (input: SearchBookInput) => Promise<BookSource[] | { sources: BookSource[]; retrieval: RetrievalReport }>;
  read: (input: ReadSourceInput) => Promise<BookSource[]>;
  save: (analysis: SavedReadingAnalysis) => Promise<void>;
  sources: Map<string, BookSource>;
};
export function createReadingTools(deps: ReadingToolDependencies) {
  const register = (sources: BookSource[], origin: "search" | "read") => {
    for (const source of sources) {
      const previous = deps.sources.get(source.sourceId);
      // WHY：同段后续检索片段不能抹掉之前真正提供过的证据；分片分别校验，禁止拼接出虚构引文。
      const evidence = [...(previous?.evidence ?? (previous ? [{ text: previous.text, origin: previous.origin ?? "context" }] : [])), { text: source.text, origin }];
      const excerpts = [...new Set(evidence.map(item => item.text))];
      // WHY：按实际提供的片段分别记录渠道；同段新命中的内容不能被旧预加载片段冒名，也不能跨片段拼接引文。
      deps.sources.set(source.sourceId, { ...source, origin: previous?.origin ?? origin, evidence, excerpts });
    }
    return { ok: true, sources };
  };
  return [
    tool(async (input) => {
      const result = await deps.search(input);
      if (Array.isArray(result)) return register(result, "search");
      const registered = register(result.sources, "search");
      return { ...registered, ok: result.retrieval.effectiveMode !== "none", retrieval: result.retrieval };
    }, { name: "search_book", description: "按需检索当前书籍：支持并行关键词、语义和最多两个补充查询，返回真实原文、来源及每路耗时/降级情况。需要书内事实、其他章节或证据时主动使用；已有上下文足够时不必检索。不能建索引或访问其他书籍。", schema: searchBookSchema }),
    tool(async (input) => {
      // WHY：只允许扩展本轮已经真实提供的来源，不准用模型猜出的 ID 读取其他版本。
      if (!deps.sources.has(input.sourceId)) return { ok: false, code: "unknown_source", error: "来源未在本轮检索中出现，请先调用 search_book" };
      return register(await deps.read(input), "read");
    }, { name: "read_source", description: "读取已检索来源及相邻段落，理解前后文。不能读取其他书籍或任意 ID。", schema: readSourceSchema }),
    tool(async (input) => {
      if (!deps.selectedText.trim()) return { ok: false, code: "missing_selection", error: "本轮没有选文，不能保存句读。请自然回答用户。" };
      const invalidConcepts = input.concepts.filter(c => !deps.selectedText.includes(c.name));
      if (invalidConcepts.length) return { ok: false, code: "invalid_concepts", error: "以下概念未逐字出现在选文中，请修正", invalidConcepts: invalidConcepts.map(c => c.name) };
      const citations: NonNullable<Analysis["citations"]> = [];
      for (const citation of input.citations) {
        const source = deps.sources.get(citation.sourceId);
        if (!source || !(source.excerpts ?? [source.text]).some(excerpt => excerpt.includes(citation.quote))) return { ok: false, code: "invalid_citation", error: "引用不是本轮真实来源中的逐字原文，请检索或修正", sourceId: citation.sourceId };
        // WHY：仅经服务端校验的选区片段可标为选文依据，模型不能自行声明来源渠道。
        const inSelection = deps.anchor && anchorParts(deps.anchor).some(part => part.paragraphId === source.paragraphId && part.selectedText.includes(citation.quote));
        const evidence = source.evidence ?? [{ text: source.text, origin: source.origin ?? "context" }];
        const matching = evidence.filter(item => item.text.includes(citation.quote));
        const origin = inSelection ? "selection" : matching.some(item => item.origin !== "search") ? "context" : "search";
        if (!citations.some(c => c.sourceId === citation.sourceId && c.quote === citation.quote)) citations.push({ ...citation, paragraphId: source.paragraphId, messageId: deps.messageId, origin });
      }
      const analysis = { ...input, provenanceVersion: 1 as const, citations, ...(deps.anchor ? { anchor: deps.anchor } : {}) };
      // WHY：消息、版本和原文锚点由服务器绑定；模型只能填写分析内容，不能指定保存到其他消息。
      await deps.save(analysis);
      return { ok: true, analysisId: deps.messageId, saved: true, locationAvailable: Boolean(deps.anchor), result: analysis };
    }, { name: "save_reading_analysis", description: "保存选文的结构化句读和概念。参数是结构化字段，不是 JSON 正文；readingText 应对应已经输出的完整释读，附加字段只填不重复的信息。引用必须来自本轮已提供的选文/邻段或 search_book/read_source 真实来源；失败时根据错误修正参数。先输出完整自然语言释读再保存；若先保存且还未输出正文，则随后输出正文。", schema: saveAnalysisSchema }),
  ] as const;
}
