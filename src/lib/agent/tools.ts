import type { ReadingDetail } from "../reading-detail";
import type { RetrievalReport } from "../retrieval-report";
import { tool } from "langchain";
import type { Analysis } from "../chat-stream";
import type { AnswerEmphasis } from "../answer-emphasis";
import { resolveAnswerEmphasis } from "../answer-emphasis-protocol";
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
    }, { name: TOOL_NAMES.searchBook, description: "按需检索当前书籍：支持并行关键词、语义和最多两个补充查询，返回真实原文、来源及每路耗时/降级情况。需要书内事实、其他章节或证据时主动使用；已有上下文足够时不必检索。不能建索引或访问其他书籍。示例：" + JSON.stringify({query:"相对价值形式",additionalQueries:["等价形式"],mode:"auto",chapterId:null,limit:5}), schema: searchBookSchema }),
    tool(async (input) => {
      // WHY：只允许扩展本轮已经真实提供的来源，不准用模型猜出的 ID 读取其他版本。
      if (!deps.sources.has(input.sourceId)) return { ok: false, code: "unknown_source", error: "来源未在本轮检索中出现，请先调用 search_book" };
      return register(await deps.read(input), "read");
    }, { name: TOOL_NAMES.readSource, description: "读取已检索来源及相邻段落，理解前后文。不能读取其他书籍或任意 ID。示例（sourceId须替换为本轮真实返回ID）：" + JSON.stringify({sourceId:"book:edition:paragraph:p1",neighbors:1}), schema: readSourceSchema }),
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
      const { answerEmphasis: proposal, ...fields } = input;
      let emphasis: AnswerEmphasis;
      try { emphasis = resolveAnswerEmphasis(deps.getVisibleAnswer?.() ?? "", proposal); }
      catch (error: unknown) { return { ok: false, code: "no_valid_emphasis", error: error instanceof Error ? error.message : "正文标注核验失败" }; }
      const analysis = { ...fields, concepts, provenanceVersion: 1 as const, citations, emphasis, emphasisSource: "agent" as const, ...(deps.anchor ? { anchor: deps.anchor } : {}) };
      // WHY：消息、版本和原文锚点由服务器绑定；模型只能填写分析内容，不能指定保存到其他消息。
      await deps.save(analysis);
      return { ok: true, analysisId: deps.messageId, saved: true, locationAvailable: Boolean(deps.anchor), result: analysis };
    }, { name: TOOL_NAMES.saveReadingAnalysis, description: "历史适配保存，不向主Agent绑定。使用统一answerEmphasis。示例：" + JSON.stringify({readingText:"劳动形成价值。",concepts:"无",answerEmphasis:{keywords:["劳动"],keySentences:"none"}}), schema: saveAnalysisSchema }),
    tool(async (input) => {
      const answer = deps.getVisibleAnswer?.() ?? "";
      if (!answer.trim() || !deps.saveEmphasis) return { ok: false, code: "answer_unavailable", error: "需要先完整输出本轮正文，才能标注重点" };
      // WHY：显式“无”是 Agent 的选择，也要保存；不允许代码生成、替换或补齐标注。
      let verified: AnswerEmphasis;
      try { verified = resolveAnswerEmphasis(answer, input.answerEmphasis); }
      catch (error: unknown) { return { ok: false, code: "no_valid_emphasis", error: error instanceof Error ? error.message : "正文标注核验失败" }; }
      await deps.saveEmphasis(verified);
      return { ok: true, marked: verified.marks.length };
    }, { name: TOOL_NAMES.markAnswerEmphasis, description: "完整回答后提交正文重点。answerEmphasis的keywords/keySentences分别为none或逐字引用数组，各最多16项、每项最多1000字符；无重点明确填none，不省略或传空数组。不提交kind/marks/occurrence，不改写正文。成功后不要重复回答。示例（正文为劳动形成价值。）：" + JSON.stringify({answerEmphasis:{keywords:["劳动"],keySentences:"none"}}), schema: markAnswerEmphasisSchema }),
  ] as const;
}
