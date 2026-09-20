import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { EDITION_COLUMNS, publicEdition, type EditionRow } from "./edition-metadata";
export const runtime = "nodejs";
export async function GET() {
  const db = getDb();
  const books = db.prepare("SELECT id, title, author FROM books ORDER BY created_at DESC, id").all() as { id: string; title: string; author: string }[];
  const result = books.map((book) => {
    const row = db.prepare(`SELECT ${EDITION_COLUMNS} FROM editions WHERE book_id = ? ORDER BY created_at DESC, id LIMIT 1`).get(book.id) as EditionRow | undefined;
    const edition = row ? publicEdition(row) : undefined;
    const chapters = edition ? db.prepare("SELECT id, title, source_href AS sourceHref FROM chapters WHERE edition_id = ? ORDER BY order_index, id").all(edition.id) as { id: string; title: string; sourceHref: string | null }[] : [];
    return { ...book, editionId: edition?.id, edition, chapters: chapters.map((chapter) => ({ id: chapter.id, title: chapter.title,
      ...(chapter.sourceHref !== null ? { sourceHref: chapter.sourceHref } : {}), paragraphs: db.prepare("SELECT id, text FROM paragraphs WHERE chapter_id = ? ORDER BY order_index, id").all(chapter.id) })) };
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
