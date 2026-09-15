import { tool } from "langchain";
import type { Analysis } from "../chat-stream";
import type { ReadingAnchor } from "../reading-request";
import { isReadingTextLengthValid, normalizeReadingDetail, readingDetailSpec, type ReadingDetail } from "../reading-detail";
import { readSourceSchema, saveAnalysisSchema, searchBookSchema, type ReadSourceInput, type SearchBookInput } from "./schemas";

export type BookSource = { sourceId: string; paragraphId: string; chapterId: string; chapterTitle: string; text: string; excerpts?: string[] };
export type SavedReadingAnalysis = Analysis & { anchor?: ReadingAnchor };
export type ReadingToolDependencies = {
  messageId: string;
  selectedText: string;
  detail?: ReadingDetail;
  anchor?: ReadingAnchor;
  search: (input: SearchBookInput) => Promise<BookSource[]>;
  read: (input: ReadSourceInput) => Promise<BookSource[]>;
  save: (analysis: SavedReadingAnalysis) => Promise<void>;
  sources: Map<string, BookSource>;
};
export function createReadingTools(deps: ReadingToolDependencies) {
  const register = (sources: BookSource[]) => {
    for (const source of sources) {
      const previous = deps.sources.get(source.sourceId);
      // WHY：同段后续检索片段不能抹掉之前真正提供过的证据；分片分别校验，禁止拼接出虚构引文。
      const excerpts = [...new Set([...(previous?.excerpts ?? (previous ? [previous.text] : [])), source.text])];
      deps.sources.set(source.sourceId, { ...source, excerpts });
    }
    return { ok: true, sources };
  };
  return [
    tool(async (input) => register(await deps.search(input)), { name: "search_book", description: "在当前书籍版本内检索关键词，返回可引用且可跳转的原文来源。空结果不表示全书不存在概念，可改关键词。", schema: searchBookSchema }),
    tool(async (input) => {
      // WHY：只允许扩展本轮已经真实提供的来源，不准用模型猜出的 ID 读取其他版本。
      if (!deps.sources.has(input.sourceId)) return { ok: false, error: "来源未在本轮检索中出现，请先调用 search_book" };
      return register(await deps.read(input));
    }, { name: "read_source", description: "读取已检索来源及相邻段落，理解前后文。不能读取其他书籍或任意 ID。", schema: readSourceSchema }),
    tool(async (input) => {
      if (!deps.selectedText.trim()) return { ok: false, error: "本轮没有选文，不能保存句读。请自然回答用户。" };
      const detail = normalizeReadingDetail(deps.detail);
      if (!isReadingTextLengthValid(deps.selectedText, input.readingText, detail)) return { ok: false, error: "句读文本长度不符合" + readingDetailSpec(detail).label + "模式，请按约定比例重新生成", expected: readingDetailSpec(detail).instruction };
      const invalidConcepts = input.concepts.filter(c => !deps.selectedText.includes(c.name));
      if (invalidConcepts.length) return { ok: false, error: "以下概念未逐字出现在选文中，请修正", invalidConcepts: invalidConcepts.map(c => c.name) };
      const citations: NonNullable<Analysis["citations"]> = [];
      for (const citation of input.citations) {
        const source = deps.sources.get(citation.sourceId);
        if (!source || !(source.excerpts ?? [source.text]).some(excerpt => excerpt.includes(citation.quote))) return { ok: false, error: "引用不是本轮真实来源中的逐字原文，请检索或修正", sourceId: citation.sourceId };
        if (!citations.some(c => c.sourceId === citation.sourceId && c.quote === citation.quote)) citations.push({ ...citation, paragraphId: source.paragraphId, messageId: deps.messageId });
      }
      const analysis = { ...input, citations, ...(deps.anchor ? { anchor: deps.anchor } : {}) };
      // WHY：消息、版本和原文锚点由服务器绑定；模型只能填写分析内容，不能指定保存到其他消息。
      await deps.save(analysis);
      return { ok: true, analysisId: deps.messageId, saved: true, locationAvailable: Boolean(deps.anchor), result: analysis };
    }, { name: "save_reading_analysis", description: "保存选文的结构化句读和概念。参数是结构化字段，不是 JSON 正文。引用必须来自本轮 search_book/read_source；失败时根据错误修正参数。保存后仍须用自然语言回复用户。", schema: saveAnalysisSchema }),
  ] as const;
}
