import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await context.params; const db = getDb();
  const book = db.prepare("SELECT id, title, author FROM books WHERE id = ?").get(bookId) as { id: string; title: string; author: string } | undefined;
  if (!book) return NextResponse.json({ error: "书籍不存在" }, { status: 404 });
  const edition = db.prepare("SELECT id FROM editions WHERE book_id = ? ORDER BY created_at DESC LIMIT 1").get(book.id) as { id: string } | undefined;
  if (!edition) return NextResponse.json({ ...book, chapters: [] });
  const chapters = db.prepare("SELECT id, title, order_index FROM chapters WHERE edition_id = ? ORDER BY order_index").all(edition.id) as { id: string; title: string; order_index: number }[];
  return NextResponse.json({ ...book, editionId: edition.id, chapters: chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, paragraphs: db.prepare("SELECT id, text FROM paragraphs WHERE chapter_id = ? ORDER BY order_index").all(chapter.id) })) });
}
