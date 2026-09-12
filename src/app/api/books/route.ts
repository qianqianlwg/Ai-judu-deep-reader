import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
export const runtime = "nodejs";
export async function GET() {
  const db = getDb();
  const books = db.prepare("SELECT id, title, author FROM books ORDER BY created_at DESC").all() as { id: string; title: string; author: string }[];
  const result = books.map((book) => {
    const edition = db.prepare("SELECT id FROM editions WHERE book_id = ? ORDER BY created_at DESC LIMIT 1").get(book.id) as { id: string } | undefined;
    const chapters = edition ? db.prepare("SELECT id, title, order_index FROM chapters WHERE edition_id = ? ORDER BY order_index").all(edition.id) as { id: string; title: string; order_index: number }[] : [];
    return { ...book, editionId: edition?.id, chapters: chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, paragraphs: db.prepare("SELECT id, text FROM paragraphs WHERE chapter_id = ? ORDER BY order_index").all(chapter.id) })) };
  });
  return NextResponse.json(result);
}

