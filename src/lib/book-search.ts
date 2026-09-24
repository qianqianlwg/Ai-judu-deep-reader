export type SearchParagraph = {
  id: string;
  chapterId: string;
  chapterTitle: string;
  text: string;
  paragraphIndex: number;
};

export type SearchMatch = {
  paragraphId: string;
  chapterId: string;
  chapterTitle: string;
  paragraphIndex: number;
  matchedText: string;
  startOffset: number;
  endOffset: number;
  excerpt: string;
  context: SearchContext;
  sourceId?: string;
  retrieval?: SearchRetrieval;
};

export type SearchRetrieval = {
  backend: "sqlite";
  keywordScore: number;
  vectorSimilarity: number;
  rrfScore: number;
  vectorUsed: boolean;
};

export type SearchContext = {
  before: SearchParagraph[];
  after: SearchParagraph[];
};

export type SearchResponse = {
  query: string;
  mode: "search" | "concept";
  total: number;
  results: SearchMatch[];
};

export function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/gu, " ");
}

function contextFor(paragraphs: SearchParagraph[], index: number, radius: number): SearchContext {
  const paragraph = paragraphs[index];
  const sameChapter = (item: SearchParagraph): boolean => item.chapterId === paragraph.chapterId;
  return {
    before: paragraphs.slice(Math.max(0, index - radius), index).filter(sameChapter),
    after: paragraphs.slice(index + 1, index + radius + 1).filter(sameChapter),
  };
}

function createMatch(paragraphs: SearchParagraph[], index: number, query: string, radius: number): SearchMatch | undefined {
  const paragraph = paragraphs[index];
  const startOffset = paragraph.text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (startOffset < 0) return undefined;
  return {
    paragraphId: paragraph.id,
    chapterId: paragraph.chapterId,
    chapterTitle: paragraph.chapterTitle,
    paragraphIndex: paragraph.paragraphIndex,
    matchedText: paragraph.text.slice(startOffset, startOffset + query.length),
    startOffset,
    endOffset: startOffset + query.length,
    excerpt: createExcerpt(paragraph.text, startOffset, query.length),
    context: contextFor(paragraphs, index, radius),
  };
}

export function createExcerpt(text: string, startOffset: number, matchLength: number, radius = 80): string {
  const start = Math.max(0, startOffset - radius);
  const end = Math.min(text.length, startOffset + matchLength + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export function searchParagraphs(paragraphs: SearchParagraph[], query: string, limit = 20, radius = 1): SearchMatch[] {
  const normalized = normalizeSearchQuery(query).toLocaleLowerCase();
  if (!normalized) return [];
  const matches: SearchMatch[] = [];
  paragraphs.forEach((paragraph, index) => {
    if (matches.length >= limit) return;
    if (paragraph.text.toLocaleLowerCase().includes(normalized)) {
      const match = createMatch(paragraphs, index, normalized, radius);
      if (match) matches.push(match);
    }
  });
  return matches;
}

export function findConceptOccurrences(paragraphs: SearchParagraph[], concept: string, limit = 100, radius = 1): SearchMatch[] {
  return searchParagraphs(paragraphs, concept, limit, radius);
}

export function buildSearchResponse(input: Pick<SearchResponse, "query" | "mode" | "results">): SearchResponse {
  return { ...input, total: input.results.length };
}

// WHY：Agent 常返回空格分隔的关键词组；自动/混合检索先取完整短语，再按覆盖词数排序，不能把整组当作一个必需子串。
export function searchKeywordCandidates(paragraphs: SearchParagraph[], query: string, limit = 20, radius = 1): SearchMatch[] {
  const normalized = normalizeSearchQuery(query).toLocaleLowerCase();
  const terms = [...new Set(normalized.split(/\s+/u).filter(Boolean))].slice(0, 8);
  if (terms.length < 2) return searchParagraphs(paragraphs, query, limit, radius);
  return paragraphs.flatMap((paragraph, index) => {
    const exact = createMatch(paragraphs, index, normalized, radius);
    const hits = terms.filter(term => paragraph.text.toLocaleLowerCase().includes(term));
    const match = exact ?? (hits.length ? createMatch(paragraphs, index, hits[0], radius) : undefined);
    return match ? [{match, score: exact ? terms.length + 1 : hits.length, order:index}] : [];
  }).sort((a,b)=>b.score-a.score||a.order-b.order).slice(0,limit).map(item=>item.match);
}
