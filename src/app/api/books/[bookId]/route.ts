import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isConversationId } from "@/lib/conversations";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request, context: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await context.params;
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => key !== "editionId") || query.getAll("editionId").length > 1) return NextResponse.json({ error: "仅支持唯一的 editionId 版本参数" }, { status: 400, headers });
  const requestedEdition = query.get("editionId");
  if (requestedEdition !== null && !isConversationId(requestedEdition)) return NextResponse.json({ error: "版本 ID 不合法" }, { status: 400, headers });
  const db = getDb();
  const book = db.prepare("SELECT id, title, author, created_at AS createdAt FROM books WHERE id = ?").get(bookId) as { id: string; title: string; author: string; createdAt: string } | undefined;
  if (!book) return NextResponse.json({ error: "书籍不存在" }, { status: 404, headers });
  const editions = db.prepare("SELECT id, file_name AS fileName, file_type AS fileType, created_at AS createdAt FROM editions WHERE book_id = ? ORDER BY created_at DESC, id").all(book.id) as { id: string; fileName: string; fileType: string; createdAt: string }[];
  const edition = requestedEdition === null ? editions[0] : editions.find(item => item.id === requestedEdition);
  // WHY：显式请求旧版或别书版本时绝不静默回落最新版，避免原文、会话、检索和知识混用。
  if (!edition && requestedEdition !== null) return NextResponse.json({ error: "当前书籍不存在此版本" }, { status: 404, headers });
  if (!edition) return NextResponse.json({ ...book, editions, chapters: [] }, { headers });
  const chapters = db.prepare("SELECT id, title FROM chapters WHERE edition_id = ? ORDER BY order_index, id").all(edition.id) as { id: string; title: string }[];
  return NextResponse.json({ ...book, editions, editionId: edition.id, edition, chapters: chapters.map(chapter => ({ ...chapter, paragraphs: db.prepare("SELECT id, text FROM paragraphs WHERE chapter_id = ? ORDER BY order_index, id").all(chapter.id) })) }, { headers });
}
