import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
export const runtime = "nodejs";
export async function GET() {
  const db = getDb();
  const books = db.prepare("SELECT id, title, author FROM books ORDER BY created_at DESC").all() as { id: string; title: string; author: string }[];
  return NextResponse.json(books.filter((book, index, list) => list.findIndex((item) => item.title === book.title) === index));
}
