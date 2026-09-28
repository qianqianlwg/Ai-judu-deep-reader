import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readStoredBookKnowledge } from "@/lib/knowledge-reader";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const editionId = request.nextUrl.searchParams.get("editionId")?.trim();
  if (!editionId || editionId.length > 200) return NextResponse.json({ error: "请提供有效的 editionId。" }, { status: 400 });
  try {
    const db = getDb();
    if (!db.prepare("SELECT id FROM editions WHERE id = ?").get(editionId)) return NextResponse.json({ error: "未找到这本书的版本。" }, { status: 404 });
    return NextResponse.json(readStoredBookKnowledge(db, editionId), { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    console.error("读取本书知识卡片失败", error);
    return NextResponse.json({ error: "知识卡片暂时无法读取，请重试。" }, { status: 500 });
  }
}
