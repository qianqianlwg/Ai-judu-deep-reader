import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { EDITION_COLUMNS, publicEdition, type EditionRow } from "../books/edition-metadata";
export const runtime = "nodejs";
export async function GET() {
  const db = getDb();
  const books = db.prepare("SELECT id, title, author, created_at AS createdAt FROM books ORDER BY created_at DESC, id").all() as { id: string; title: string; author: string; createdAt: string }[];
  const editions = db.prepare(`SELECT ${EDITION_COLUMNS} FROM editions ORDER BY created_at DESC, id`).all() as EditionRow[];
  // WHY：书名不是主键；同名导入和所有版本都必须保留，不能让隐藏的BookID/EditionID连带隐藏会话和知识。
  return NextResponse.json(books.map(book => ({ ...book, editions: editions.filter(edition => edition.bookId === book.id).map(publicEdition) })), { headers: { "Cache-Control": "no-store" } });
}
