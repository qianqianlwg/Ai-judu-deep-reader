import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getPostgresSearchIndexStatus } from "@/lib/postgres-search-client";
import { buildSearchIndexStatus } from "@/lib/search-status";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const editionId = request.nextUrl.searchParams.get("editionId")?.trim() ?? "";
  if (!editionId) return NextResponse.json({ error: "缺少 editionId" }, { status: 400 });
  if (process.env.DATABASE_URL) {
    try {
      const result = await getPostgresSearchIndexStatus(editionId);
      return NextResponse.json(buildSearchIndexStatus({ backend: "postgres", editionId, paragraphCount: result.paragraphCount, indexedCount: result.indexedCount, note: "PostgreSQL 索引可用；查询时传 embedding 才会启用向量分支。" }));
    } catch (error: unknown) { console.error("读取 PostgreSQL 索引状态失败，回退 SQLite", error); }
  }
  const row = getDb().prepare("SELECT COUNT(*) AS paragraphCount FROM paragraphs p JOIN chapters c ON c.id = p.chapter_id WHERE c.edition_id = ?").get(editionId) as { paragraphCount?: number } | undefined;
  const paragraphCount = Number(row?.paragraphCount ?? 0);
  return NextResponse.json(buildSearchIndexStatus({ backend: "sqlite", editionId, paragraphCount, indexedCount: 0, note: "当前使用 SQLite；尚未建立 pgvector 索引。" }));
}
