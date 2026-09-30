import type { ReadingDetail } from "../reading-detail";
import type { RetrievalReport } from "../retrieval-report";
import { tool } from "langchain";
import type { Analysis } from "../chat-stream";
import { EMPTY_ANSWER_EMPHASIS, validateAnswerEmphasis, type AnswerEmphasis } from "../answer-emphasis";
import { anchorParts, type ReadingAnchor } from "../reading-anchors";
import { readSourceSchema, saveAnalysisSchema, searchBookSchema, markAnswerEmphasisSchema, type ReadSourceInput, type SearchBookInput } from "./schemas";
import { TOOL_NAMES } from "./tool-choice";

export type BookSource = { sourceId: string; paragraphId: string; chapterId: string; chapterTitle: string; text: string; channels?: ("keyword" | "semantic")[]; excerpts?: string[]; origin?: "context" | "search" | "read"; evidence?: { text: string; origin: "context" | "search" | "read" }[] };
export type SavedReadingAnalysis = Analysis & { anchor?: ReadingAnchor; emphasis: AnswerEmphasis; emphasisSource: "agent" };
export type ReadingToolDependencies = {
  messageId: string;
  selectedText: string;
  detail?: ReadingDetail;
  anchor?: ReadingAnchor;
  search: (input: SearchBookInput) => Promise<BookSource[] | { sources: BookSource[]; retrieval: RetrievalReport }>;
  read: (input: ReadSourceInput) => Promise<BookSource[]>;
  save: (analysis: SavedReadingAnalysis) => Promise<void>;
  getVisibleAnswer?: () => string;
  saveEmphasis?: (emphasis: AnswerEmphasis) => Promise<void>;
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
    }, { name: TOOL_NAMES.searchBook, description: "按需检索当前书籍：支持并行关键词、语义和最多两个补充查询，返回真实原文、来源及每路耗时/降级情况。需要书内事实、其他章节或证据时主动使用；已有上下文足够时不必检索。不能建索引或访问其他书籍。", schema: searchBookSchema }),
    tool(async (input) => {
      // WHY：只允许扩展本轮已经真实提供的来源，不准用模型猜出的 ID 读取其他版本。
      if (!deps.sources.has(input.sourceId)) return { ok: false, code: "unknown_source", error: "来源未在本轮检索中出现，请先调用 search_book" };
      return register(await deps.read(input), "read");
    }, { name: TOOL_NAMES.readSource, description: "读取已检索来源及相邻段落，理解前后文。不能读取其他书籍或任意 ID。", schema: readSourceSchema }),
    tool(async (input) => {
      if (!deps.selectedText.trim()) return { ok: false, code: "missing_selection", error: "本轮没有选文，不能保存句读。请自然回答用户。" };
      const concepts = input.concepts === "无" ? [] : input.concepts;
      const invalidConcepts = concepts.filter(c => !deps.selectedText.includes(c.name));
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
      const { emphasis: proposal, ...fields } = input;
      const emphasis = proposal === "无" ? EMPTY_ANSWER_EMPHASIS : validateAnswerEmphasis(deps.getVisibleAnswer?.() ?? "", proposal);
      if (proposal !== "无" && emphasis.marks.length !== proposal.marks.length) return { ok: false, code: "no_valid_emphasis", error: "标注必须全部精确匹配本轮正文，请只修正工具参数；确实没有重点时填写 emphasis：无" };
      const analysis = { ...fields, concepts, provenanceVersion: 1 as const, citations, emphasis, emphasisSource: "agent" as const, ...(deps.anchor ? { anchor: deps.anchor } : {}) };
      // WHY：消息、版本和原文锚点由服务器绑定；模型只能填写分析内容，不能指定保存到其他消息。
      await deps.save(analysis);
      return { ok: true, analysisId: deps.messageId, saved: true, locationAvailable: Boolean(deps.anchor), result: analysis };
    }, { name: TOOL_NAMES.saveReadingAnalysis, description: "保存选文的结构化句读和概念。concepts 是必填字段：有核心概念时填写名称及本段定义；没有时填写字符串‘无’，不可省略。emphasis 同样必填：填写本轮可见回答中精确出现的少量关键词和一条完整关键句；确实没有时填写字符串‘无’。参数不是 JSON 正文，颜色由前端决定。引用必须来自本轮已提供的选文/邻段或 search_book/read_source 真实来源。先输出完整释读再保存；若先保存且尚无正文，则随后输出正文，已有正文不重复。", schema: saveAnalysisSchema }),
    tool(async (input) => {
      const answer = deps.getVisibleAnswer?.() ?? "";
      if (!answer.trim() || !deps.saveEmphasis) return { ok: false, code: "answer_unavailable", error: "需要先完整输出本轮正文，才能标注重点" };
      // WHY：显式“无”是 Agent 的选择，也要保存；不允许代码生成、替换或补齐标注。
      const verified = input.emphasis === "无" ? EMPTY_ANSWER_EMPHASIS : validateAnswerEmphasis(answer, input.emphasis);
      if (input.emphasis !== "无" && verified.marks.length !== input.emphasis.marks.length) {
        return { ok: false, code: "no_valid_emphasis", error: "标注未全部精确匹配本轮正文，请修正工具参数；确实没有重点时填写 emphasis：无" };
      }
      await deps.saveEmphasis(verified);
      return { ok: true, marked: verified.marks.length };
    }, { name: TOOL_NAMES.markAnswerEmphasis, description: "普通追问必用：完整回答后提交必填 emphasis，填写正文中的 1-3 个完整关键词和最多 1 条完整关键句；确实没有时填写字符串‘无’，不可省略或传空数组。只提交精确文本及出现次数；不指定颜色、不改写正文。已标注后不要再输出重复回答。", schema: markAnswerEmphasisSchema }),
  ] as const;
}
