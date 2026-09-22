import { NextRequest, NextResponse } from "next/server";
import {searchVectors} from "@/lib/vector-search";
import {readEmbeddingConfig} from "@/lib/embedding-store";
import { getDb } from "@/lib/db";
import { hybridSearch, type HybridSearchCandidate } from "@/lib/hybrid-search";
import { searchPostgres } from "@/lib/postgres-search-client";
import { sourceIdForParagraph } from "@/lib/citation-validation";
import {
  buildSearchResponse,
  createExcerpt,
  findConceptOccurrences,
  normalizeSearchQuery,
  searchParagraphs,
  type SearchParagraph,
} from "@/lib/book-search";

export const runtime = "nodejs";

type SourceType = "book" | "translation" | "external";

function readNumber(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function readEmbedding(value: string | null): number[] | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
      throw new Error("embedding 必须是非空数字数组");
    }
    return parsed;
  } catch (error: unknown) {
    throw new Error(`embedding 参数无效：${error instanceof Error ? error.message : "未知错误"}`);
  }
}

function readSourceType(value: string | null): SourceType | undefined {
  return value === "book" || value === "translation" || value === "external" ? value : undefined;
}

export async function GET(request: NextRequest) {
  const query = normalizeSearchQuery(request.nextUrl.searchParams.get("q") ?? "");
  const editionId = request.nextUrl.searchParams.get("editionId")?.trim() ?? "";
  const chapterId = request.nextUrl.searchParams.get("chapterId")?.trim() || undefined;
  const sourceType = readSourceType(request.nextUrl.searchParams.get("sourceType"));
  const mode = request.nextUrl.searchParams.get("mode") === "concept" ? "concept" : "search";
  const limit = readNumber(request.nextUrl.searchParams.get("limit"), 20, 1, 100);
  const contextRadius = readNumber(request.nextUrl.searchParams.get("context"), 1, 0, 3);

  if (!editionId) return NextResponse.json({ error: "缺少 editionId" }, { status: 400 });
  if (!query) return NextResponse.json({ error: "请输入关键词" }, { status: 400 });

  const retrieval=request.nextUrl.searchParams.get("retrieval");
  if(retrieval==="semantic"||retrieval==="hybrid"){
    if(query.length>2000)return NextResponse.json({error:"语义查询请控制在 2000 字以内"},{status:400});
    if(sourceType && sourceType!=="book")return NextResponse.json({error:"当前向量索引仅包含本书正文"},{status:400});
    try{const db=getDb();const results=await searchVectors(db,readEmbeddingConfig(db),{editionId,query,chapterId,limit,hybrid:retrieval==="hybrid",signal:request.signal});return NextResponse.json(buildSearchResponse({query,mode,results}));}
    catch(error:unknown){console.error("语义检索失败",{name:error instanceof Error?error.name:"UnknownError"});return NextResponse.json({error:error instanceof Error?error.message:"语义检索失败，请重试或切换关键词检索"},{status:503});}
  }
  let embedding: number[] | undefined;
  try {
    embedding = readEmbedding(request.nextUrl.searchParams.get("embedding"));
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "embedding 参数无效" }, { status: 400 });
  }

  if (process.env.DATABASE_URL) {
    try {
      const rows = await searchPostgres({ query, editionId, chapterId, sourceType, limit, embedding });
      const results = rows.map((row) => {
        const startOffset = row.text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
        const safeStart = startOffset >= 0 ? startOffset : 0;
        const matchedText = startOffset >= 0 ? row.text.slice(safeStart, safeStart + query.length) : query;
        return {
          paragraphId: row.paragraphId,
          chapterId: row.chapterId,
          chapterTitle: row.chapterTitle,
          paragraphIndex: 0,
          matchedText,
          startOffset: safeStart,
          endOffset: safeStart + matchedText.length,
          excerpt: createExcerpt(row.text, safeStart, matchedText.length),
          context: { before: [], after: [] },
          sourceId: sourceIdForParagraph(editionId, row.paragraphId),
          retrieval: { backend: "postgres" as const, keywordScore: row.keywordScore, vectorSimilarity: row.vectorSimilarity, rrfScore: row.rrfScore, vectorUsed: Boolean(embedding?.length) },
        };
      });
      return NextResponse.json(buildSearchResponse({ query, mode, results }));
    } catch (error: unknown) {
      console.error("PostgreSQL 检索失败，回退 SQLite", error);
    }
  }

  const db = getDb();
  const sql = `
    SELECT p.id, p.chapter_id AS chapterId, c.title AS chapterTitle,
      p.text, p.order_index AS paragraphIndex
    FROM paragraphs p
    JOIN chapters c ON c.id = p.chapter_id
    WHERE c.edition_id = ? ${chapterId ? "AND p.chapter_id = ?" : ""}
    ORDER BY c.order_index, p.order_index
  `;
  const rows = db.prepare(sql).all(...(chapterId ? [editionId, chapterId] : [editionId])) as unknown[];
  const paragraphs = rows.map((row) => row as SearchParagraph);
  const rawMatches = mode === "concept" ? findConceptOccurrences(paragraphs, query, limit * 5, contextRadius) : searchParagraphs(paragraphs, query, limit * 5, contextRadius);
  const candidates: HybridSearchCandidate[] = rawMatches.map((match) => ({ id: match.paragraphId, text: match.excerpt, keywordScore: 1 / (match.startOffset + 1), vectorSimilarity: 0, metadata: { editionId, chapterId: match.chapterId, paragraphId: match.paragraphId, sourceType: sourceType ?? "book" } }));
  const rankedIds = hybridSearch(candidates, { limit, filter: sourceType ? { sourceType } : undefined }).map((candidate) => candidate.id);
  const matches = rankedIds.map((id) => rawMatches.find((match) => match.paragraphId === id)).filter((match): match is typeof rawMatches[number] => Boolean(match));

  const results = matches.map((match) => ({ ...match, sourceId: sourceIdForParagraph(editionId, match.paragraphId), retrieval: { backend: "sqlite" as const, keywordScore: 0, vectorSimilarity: 0, rrfScore: 0, vectorUsed: false } }));
  return NextResponse.json(buildSearchResponse({ query, mode, results }));
}
