import {bookDisplayTitles} from "@/lib/book-display-title";
import {ensureBookShelf,ACTIVE_BOOKS_FILTER} from "@/lib/book-shelf";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { EDITION_COLUMNS, publicEdition, type EditionRow } from "../books/edition-metadata";
export const runtime = "nodejs";
export async function GET(request?: Request) {
  const db = getDb(); ensureBookShelf(db);
  const titles=bookDisplayTitles(db);
  const archived=request ? new URL(request.url).searchParams.get("shelf")==="archived" : false;
  const books = db.prepare(`SELECT id, title, author, created_at AS createdAt FROM books WHERE ${archived?"NOT ":""}(${ACTIVE_BOOKS_FILTER}) ORDER BY created_at DESC, id`).all() as { id: string; title: string; author: string; createdAt: string }[];
  const editions = db.prepare(`SELECT ${EDITION_COLUMNS} FROM editions ORDER BY created_at DESC, id`).all() as EditionRow[];
  // WHY：书名不是主键；同名导入和所有版本都必须保留，不能让隐藏的BookID/EditionID连带隐藏会话和知识。
  return NextResponse.json(books.map(book => ({ ...book, ...(titles[book.id] ? {displayTitle:titles[book.id]} : {}), editions: editions.filter(edition => edition.bookId === book.id).map(publicEdition) })), { headers: { "Cache-Control": "no-store" } });
}
