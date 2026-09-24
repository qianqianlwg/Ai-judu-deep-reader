/**
 * 混合检索的纯函数层。
 *
 * WHY：先把排序、过滤和 RRF 与数据库解耦，SQLite MVP 可以继续使用，
 * 候选先各自排名再融合，不能直接相加不同量纲的原始分数。
 */
export type SearchMetadata = {
  bookId?: string;
  editionId?: string;
  chapterId?: string;
  paragraphId?: string;
  sourceType?: "book" | "translation" | "external";
  [key: string]: string | undefined;
};

export type HybridSearchCandidate = {
  id: string;
  text: string;
  keywordScore: number;
  vectorSimilarity: number;
  metadata: SearchMetadata;
};

export type HybridSearchFilter = Partial<SearchMetadata>;

export type HybridSearchOptions = {
  keywordWeight?: number;
  vectorWeight?: number;
  rrfK?: number;
  limit?: number;
  filter?: HybridSearchFilter;
};

export type HybridSearchResult = HybridSearchCandidate & {
  keywordRank: number | null;
  vectorRank: number | null;
  rrfScore: number;
  combinedScore: number;
};

const DEFAULT_OPTIONS: Required<Omit<HybridSearchOptions, "filter">> = {
  keywordWeight: 1,
  vectorWeight: 1,
  rrfK: 60,
  limit: 20,
};

export function filterSearchCandidates(
  candidates: readonly HybridSearchCandidate[],
  filter: HybridSearchFilter = {},
): HybridSearchCandidate[] {
  return candidates.filter((candidate) =>
    Object.entries(filter).every(([key, expected]) => candidate.metadata[key] === expected),
  );
}

export function normalizeScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, score);
}

export function rankCandidates(
  candidates: readonly HybridSearchCandidate[],
  score: (candidate: HybridSearchCandidate) => number,
): HybridSearchCandidate[] {
  return [...candidates].sort((left, right) => {
    const scoreDifference = normalizeScore(score(right)) - normalizeScore(score(left));
    return scoreDifference || left.id.localeCompare(right.id);
  });
}

export function reciprocalRank(rank: number, rrfK = 60): number {
  if (!Number.isInteger(rank) || rank < 1) throw new Error("RRF 排名必须从 1 开始");
  if (!Number.isFinite(rrfK) || rrfK < 0) throw new Error("RRF K 必须是非负数");
  return 1 / (rrfK + rank);
}

export function hybridSearch(
  candidates: readonly HybridSearchCandidate[],
  options: HybridSearchOptions = {},
): HybridSearchResult[] {
  const config = { ...DEFAULT_OPTIONS, ...options };
  validateOptions(config);

  const filtered = filterSearchCandidates(candidates, config.filter);
  const keywordRanking = rankCandidates(filtered, (candidate) => candidate.keywordScore);
  const vectorRanking = rankCandidates(filtered, (candidate) => candidate.vectorSimilarity);
  const keywordRanks = new Map(keywordRanking.map((candidate, index) => [candidate.id, index + 1]));
  const vectorRanks = new Map(vectorRanking.map((candidate, index) => [candidate.id, index + 1]));

  return filtered
    .map((candidate) => {
      const keywordRank = keywordRanks.get(candidate.id) ?? null;
      const vectorRank = vectorRanks.get(candidate.id) ?? null;
      const rrfScore =
        (keywordRank === null ? 0 : config.keywordWeight * reciprocalRank(keywordRank, config.rrfK)) +
        (vectorRank === null ? 0 : config.vectorWeight * reciprocalRank(vectorRank, config.rrfK));
      const combinedScore =
        config.keywordWeight * normalizeScore(candidate.keywordScore) +
        config.vectorWeight * normalizeScore(candidate.vectorSimilarity);
      return { ...candidate, keywordRank, vectorRank, rrfScore, combinedScore };
    })
    .sort((left, right) => right.rrfScore - left.rrfScore || right.combinedScore - left.combinedScore || left.id.localeCompare(right.id))
    .slice(0, config.limit);
}

function validateOptions(options: Required<Omit<HybridSearchOptions, "filter">> & { filter?: HybridSearchFilter }): void {
  if (options.keywordWeight < 0 || options.vectorWeight < 0 || options.keywordWeight + options.vectorWeight === 0) {
    throw new Error("关键词和向量权重必须非负且不能同时为零");
  }
  if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error("检索条数必须是正整数");
}
