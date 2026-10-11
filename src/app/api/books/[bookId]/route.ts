import {readEditionNavigation} from '@/lib/epub-navigation-store';
import {readStoredSourceBlocks} from "@/lib/epub-block-store";
import {prepareEpubHeadingSources} from "@/lib/epub-heading-migration";
import {readStoredOriginalFile} from "@/lib/data-storage";
import {parseEpubSourceBytes} from "@/lib/epub-parser";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isConversationId } from "@/lib/conversations";
import { EDITION_COLUMNS, publicEdition, type EditionRow } from "../edition-metadata";
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
  const editions = (db.prepare(`SELECT ${EDITION_COLUMNS} FROM editions WHERE book_id = ? ORDER BY created_at DESC, id`).all(book.id) as EditionRow[]).map(publicEdition);
  const edition = requestedEdition === null ? editions[0] : editions.find(item => item.id === requestedEdition);
  // WHY：显式请求旧版或别书版本时绝不静默回落最新版，避免原文、会话、检索和知识混用。
  if (!edition && requestedEdition !== null) return NextResponse.json({ error: "当前书籍不存在此版本" }, { status: 404, headers });
  if (!edition) return NextResponse.json({ ...book, editions, chapters: [] }, { headers });
  try { await prepareEpubHeadingSources(db,edition.id,{readOriginal:readStoredOriginalFile,parse:parseEpubSourceBytes}); }
  catch(cause:unknown) { console.error("标题来源补建失败",cause); return NextResponse.json({error:"无法核验原书标题来源，现有原文和标注未被覆盖。请检查原文件后重试。"},{status:409,headers}); }
  const chapters = db.prepare("SELECT id, title, source_href AS sourceHref FROM chapters WHERE edition_id = ? ORDER BY order_index, id").all(edition.id) as { id: string; title: string; sourceHref: string | null }[];
  const content = chapters.map(chapter => ({ id: chapter.id, title: chapter.title,
    ...(chapter.sourceHref !== null ? { sourceHref: chapter.sourceHref } : {}), paragraphs: readStoredSourceBlocks(db,chapter.id) }));
  try {
    const navigation = await readEditionNavigation(db,edition.id,content,{readOriginal:readStoredOriginalFile,parse:parseEpubSourceBytes});
    return NextResponse.json({ ...book, editions, editionId: edition.id, edition, chapters:content, ...(navigation ? {navigation} : {}) }, { headers });
  } catch(cause:unknown) {
    console.error('读取原书目录失败',cause);
    return NextResponse.json({error:'读取原书目录失败，现有正文和标注未被覆盖。请检查原件后重试。'},{status:422,headers});
  }
}
