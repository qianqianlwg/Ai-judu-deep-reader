export type PostgresSearchOptions = {
  query: string;
  editionId: string;
  chapterId?: string;
  sourceType?: "book" | "translation" | "external";
  limit: number;
  embedding?: number[];
  rrfK?: number;
};

export type PostgresSearchRow = {
  paragraphId: string;
  chapterId: string;
  chapterTitle: string;
  text: string;
  keywordScore: number;
  vectorSimilarity: number;
  rrfScore: number;
};

type QueryPart = { text: string; values: unknown[] };

function scopeClause(options: PostgresSearchOptions, values: unknown[], alias: string): string {
  const clauses = [`${alias}.edition_id = $${values.push(options.editionId)}`];
  if (options.chapterId) clauses.push(`${alias}.chapter_id = $${values.push(options.chapterId)}`);
  if (options.sourceType) clauses.push(`${alias}.source_type = $${values.push(options.sourceType)}`);
  return clauses.join(" AND ");
}

function branchLimit(options: PostgresSearchOptions, values: unknown[]): string {
  values.push(Math.min(options.limit * 5, 500));
  return `$${values.length}`;
}

function keywordBranch(options: PostgresSearchOptions, values: unknown[]): QueryPart {
  const queryParam = `$${values.push(options.query)}`;
  const scope = scopeClause(options, values, "p");
  const limit = branchLimit(options, values);
  return {
    text: `SELECT p.paragraph_id AS "paragraphId", p.chapter_id AS "chapterId", c.title AS "chapterTitle", p.content AS text,
      ts_rank(p.search_document, plainto_tsquery('simple', ${queryParam})) AS "keywordScore",
      0::float AS "vectorSimilarity",
      row_number() OVER (ORDER BY ts_rank(p.search_document, plainto_tsquery('simple', ${queryParam})) DESC, p.paragraph_id) AS "keywordRank"
      FROM reader_paragraph_embeddings p JOIN chapters c ON c.id = p.chapter_id
      WHERE ${scope} AND p.search_document @@ plainto_tsquery('simple', ${queryParam})
      ORDER BY "keywordScore" DESC, p.paragraph_id LIMIT ${limit}`,
    values,
  };
}

function vectorBranch(options: PostgresSearchOptions, values: unknown[]): QueryPart {
  if (!options.embedding?.length) throw new Error("向量分支需要 embedding");
  values.push(`[${options.embedding.join(",")}]`);
  const vectorParam = `$${values.length}`;
  const scope = scopeClause(options, values, "p");
  const limit = branchLimit(options, values);
  return {
    text: `SELECT p.paragraph_id AS "paragraphId", p.chapter_id AS "chapterId", c.title AS "chapterTitle", p.content AS text,
      0::float AS "keywordScore", (1 - (p.embedding <=> ${vectorParam}::vector))::float AS "vectorSimilarity",
      row_number() OVER (ORDER BY p.embedding <=> ${vectorParam}::vector, p.paragraph_id) AS "vectorRank"
      FROM reader_paragraph_embeddings p JOIN chapters c ON c.id = p.chapter_id
      WHERE ${scope} AND p.embedding IS NOT NULL
      ORDER BY p.embedding <=> ${vectorParam}::vector, p.paragraph_id LIMIT ${limit}`,
    values,
  };
}

/**
 * 构造 PostgreSQL 的关键词 + pgvector 混合查询。
 * WHY：两个候选集分别排名，再用 RRF 合并，避免把不可比较的全文分数和余弦分数直接相加。
 */
export function buildPostgresSearchQuery(options: PostgresSearchOptions): { text: string; values: unknown[] } {
  if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error("检索条数必须是正整数");
  if (options.embedding && options.embedding.some((value) => !Number.isFinite(value))) throw new Error("embedding 必须是有限数字数组");

  const values: unknown[] = [];
  const keyword = keywordBranch(options, values);
  const hasVector = Boolean(options.embedding?.length);
  const vector = hasVector ? vectorBranch(options, values) : undefined;
  const rrfK = options.rrfK ?? 60;
  if (!Number.isFinite(rrfK) || rrfK < 0) throw new Error("RRF K 必须是非负数");
  values.push(rrfK, options.limit);
  const rrfKParam = `$${values.length - 1}`;
  const limitParam = `$${values.length}`;
  const branches = hasVector
    ? `keyword_candidates AS (${keyword.text}), vector_candidates AS (${vector?.text}),
      merged AS (
        SELECT COALESCE(k."paragraphId", v."paragraphId") AS "paragraphId",
          COALESCE(k."chapterId", v."chapterId") AS "chapterId",
          COALESCE(k."chapterTitle", v."chapterTitle") AS "chapterTitle",
          COALESCE(k.text, v.text) AS text,
          COALESCE(k."keywordScore", 0)::float AS "keywordScore",
          COALESCE(v."vectorSimilarity", 0)::float AS "vectorSimilarity",
          k."keywordRank", v."vectorRank"
        FROM keyword_candidates k FULL OUTER JOIN vector_candidates v USING ("paragraphId")
      )`
    : `keyword_candidates AS (${keyword.text}), merged AS (
        SELECT "paragraphId", "chapterId", "chapterTitle", text, "keywordScore", "vectorSimilarity", "keywordRank", NULL::bigint AS "vectorRank"
        FROM keyword_candidates
      )`;
  const vectorScore = hasVector ? ` + COALESCE(1.0 / (${rrfKParam} + "vectorRank"), 0)` : "";
  return {
    text: `WITH ${branches}
      SELECT *, (COALESCE(1.0 / (${rrfKParam} + "keywordRank"), 0)${vectorScore})::float AS "rrfScore"
      FROM merged
      ORDER BY "rrfScore" DESC, "keywordScore" DESC, "vectorSimilarity" DESC, "paragraphId"
      LIMIT ${limitParam}`,
    values,
  };
}
