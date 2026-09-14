import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ConversationInputError, conversationEditionQuery, conversationFromRow, newConversationInput } from "@/lib/conversations";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const summarySelect = "SELECT t.id, t.book_id AS bookId, t.edition_id AS editionId, t.title, t.created_at AS createdAt, MAX(t.updated_at, COALESCE((SELECT MAX(created_at) FROM chat_messages WHERE thread_id = t.id), t.updated_at)) AS updatedAt, (SELECT COUNT(*) FROM chat_messages WHERE thread_id = t.id) AS messageCount, (SELECT content FROM chat_messages WHERE thread_id = t.id AND role = 'user' ORDER BY created_at, id LIMIT 1) AS firstQuestion, SUBSTR(COALESCE((SELECT CASE WHEN json_valid(structured_output) THEN COALESCE(json_extract(structured_output, '$.anchor.selectedText'), json_extract(structured_output, '$._request.input.selectedText')) END FROM chat_messages WHERE thread_id = t.id AND role = 'assistant' ORDER BY created_at, id LIMIT 1), NULLIF(t.selected_text, '')), 1, 160) AS titleSelectedText FROM reading_threads t";
function failure(error: unknown) {
  console.error("会话列表或创建失败", error);
  return NextResponse.json({ error: error instanceof ConversationInputError ? error.message : "会话服务暂时不可用，请重试" }, { status: error instanceof ConversationInputError ? 400 : 500, headers });
}
export async function GET(request: Request) {
  try {
    const editionId = conversationEditionQuery(new URL(request.url).searchParams);
    const db = getDb();
    const edition = db.prepare("SELECT id FROM editions WHERE id = ?").get(editionId);
    if (!edition) return NextResponse.json({ error: "书籍版本不存在" }, { status: 404, headers });
    const rows = db.prepare(summarySelect + " WHERE t.edition_id = ? ORDER BY updatedAt DESC, t.created_at DESC, t.id").all(editionId);
    return NextResponse.json({ editionId, threads: rows.map(conversationFromRow) }, { headers });
  } catch (error: unknown) { return failure(error); }
}
export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch (error: unknown) { console.error("创建会话请求不是 JSON", error); return NextResponse.json({ error: "请求必须是合法 JSON" }, { status: 400, headers }); }
  try {
    const input = newConversationInput(body);
    const db = getDb();
    // WHY：版本归属检查、客户端 ID 幂等处理和创建在同一事务内完成，不让重试生成重复会话。
    db.exec("BEGIN IMMEDIATE");
    try {
      const edition = db.prepare("SELECT id, book_id AS bookId FROM editions WHERE id = ?").get(input.editionId) as { id: string; bookId: string } | undefined;
      if (!edition) { db.exec("ROLLBACK"); return NextResponse.json({ error: "书籍版本不存在" }, { status: 404, headers }); }
      const id = input.threadId ?? randomUUID();
      const existing = db.prepare(summarySelect + " WHERE t.id = ?").get(id);
      if (existing) {
        const thread = conversationFromRow(existing);
        if (thread.editionId !== input.editionId) { db.exec("ROLLBACK"); return NextResponse.json({ error: "会话 ID 已被其他版本使用" }, { status: 409, headers }); }
        // WHY：同一创建请求重发只返回已有会话；名称修改必须走 PATCH，不能借幂等重试覆盖用户命名。
        db.exec("COMMIT");
        return NextResponse.json({ thread, created: false }, { headers });
      }
      const now = new Date().toISOString();
      db.prepare("INSERT INTO reading_threads (id, book_id, edition_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, edition.bookId, edition.id, input.title ?? "", now, now);
      const thread = conversationFromRow(db.prepare(summarySelect + " WHERE t.id = ? AND t.edition_id = ?").get(id, edition.id));
      db.exec("COMMIT");
      return NextResponse.json({ thread, created: true }, { status: 201, headers });
    } catch (error: unknown) { db.exec("ROLLBACK"); throw error; }
  } catch (error: unknown) { return failure(error); }
}
