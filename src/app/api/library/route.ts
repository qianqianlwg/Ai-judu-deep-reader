import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
export const runtime = "nodejs";
export async function GET() {
  const db = getDb();
  const books = db.prepare("SELECT id, title, author, created_at AS createdAt FROM books ORDER BY created_at DESC, id").all() as { id: string; title: string; author: string; createdAt: string }[];
  const editions = db.prepare("SELECT id, book_id AS bookId, file_name AS fileName, file_type AS fileType, created_at AS createdAt FROM editions ORDER BY created_at DESC, id").all() as { id: string; bookId: string; fileName: string; fileType: string; createdAt: string }[];
  // WHY：书名不是主键；同名导入和所有版本都必须保留，不能让隐藏的BookID/EditionID连带隐藏会话和知识。
  return NextResponse.json(books.map(book => ({ ...book, editions: editions.filter(edition => edition.bookId === book.id).map(({ id, fileName, fileType, createdAt }) => ({ id, fileName, fileType, createdAt })) })), { headers: { "Cache-Control": "no-store" } });
}
