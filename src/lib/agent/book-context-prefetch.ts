import type { BookRetrievalResult, RetrievedSource } from "../book-retrieval";

export type BookContextPrefetch = { status: "completed" | "unavailable"; sources: RetrievedSource[]; reason?: string; retrieval?: BookRetrievalResult["retrieval"] };

function compact(text: string): string { return text.replace(/\s+/gu, "").toLowerCase(); }
function queryParts(selection: string): string[] {
  const text = selection.replace(/\s+/gu, " ").trim();
  if (!text) return [];
  // WHY：长选文只发送首尾两个短语义查询；不得把整段或聊天历史当作关键词或向量查询。
  return [...new Set([text.slice(0, 300), text.length > 450 ? text.slice(-300) : ""].filter(Boolean))];
}
export async function prefetchBookContext(options: {
  selectedText: string; selectedParagraphIds: readonly string[]; alreadyProvidedIds: readonly string[];
  retrieve: (input: { query: string; additionalQueries?: string[]; mode: "semantic"; limit: number; signal?: AbortSignal }) => Promise<BookRetrievalResult>;
  signal: AbortSignal;
}): Promise<BookContextPrefetch> {
  const queries = queryParts(options.selectedText);
  if (!queries.length) return { status: "unavailable", sources: [], reason: "没有可用于关联检索的选文" };
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(6000)]);
  try {
    const result = await options.retrieve({ query: queries[0], ...(queries[1] ? { additionalQueries: [queries[1]] } : {}), mode: "semantic", limit: 12, signal });
    if (result.retrieval.effectiveMode !== "semantic") return { status: "unavailable", sources: [], reason: result.retrieval.branches.find(branch => branch.reason)?.reason ?? "语义索引不可用", retrieval: result.retrieval };
    const excluded = new Set([...options.selectedParagraphIds, ...options.alreadyProvidedIds]);
    const fragments = options.selectedText.split(/\n\s*\n/gu).map(compact).filter(text => text.length >= 8);
    const sources = result.sources.filter(source => {
      if (excluded.has(source.paragraphId) || excluded.has(source.sourceId)) return false;
      const candidate = compact(source.text);
      // WHY：除选区段落 ID 外，跨段复制的同一选文也不作为新的关联证据回注。
      return !fragments.some(text => candidate === text || (text.length >= 32 && (candidate.includes(text) || (candidate.length >= 32 && text.includes(candidate)))));
    }).slice(0, 3).map(source => ({ ...source, text: source.text.slice(0, 650), endOffset: Math.min(source.endOffset, source.startOffset + 650) }));
    return { status: "completed", sources, retrieval: result.retrieval };
  } catch (error: unknown) {
    if (options.signal.aborted) throw error;
    console.warn("本书语义预检索失败", { reason: error instanceof Error ? error.name : "unknown" });
    return { status: "unavailable", sources: [], reason: "语义检索超时或异常；本轮可继续使用按需关键词工具" };
  }
}
