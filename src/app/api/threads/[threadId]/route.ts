import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ConversationInputError, conversationEditionQuery, conversationFromRow, conversationId, renameConversationInput } from "@/lib/conversations";

import { readThreadToolHistory } from "@/lib/agent/tool-history";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ threadId: string }> };
const headers = { "Cache-Control": "no-store" };
const select = "SELECT t.id, t.book_id AS bookId, t.edition_id AS editionId, t.title, t.chapter_id AS chapterId, t.paragraph_id AS paragraphId, t.selected_text AS selectedText, t.created_at AS createdAt, t.updated_at AS updatedAt, (SELECT COUNT(*) FROM chat_messages WHERE thread_id = t.id) AS messageCount, (SELECT content FROM chat_messages WHERE thread_id = t.id AND role = 'user' ORDER BY created_at, id LIMIT 1) AS firstQuestion, SUBSTR(COALESCE((SELECT CASE WHEN json_valid(structured_output) THEN COALESCE(json_extract(structured_output, '$.anchor.selectedText'), json_extract(structured_output, '$._request.input.selectedText')) END FROM chat_messages WHERE thread_id = t.id AND role = 'assistant' ORDER BY created_at, id LIMIT 1), NULLIF(t.selected_text, '')), 1, 160) AS titleSelectedText FROM reading_threads t WHERE t.id = ? AND t.edition_id = ?";
function failure(error: unknown) {
  console.error("读取或重命名会话失败", error);
  return NextResponse.json({ error: error instanceof ConversationInputError ? error.message : "会话服务暂时不可用，请重试" }, { status: error instanceof ConversationInputError ? 400 : 500, headers });
}
export async function GET(request: Request, context: RouteContext) {
  try {
    const threadId = conversationId((await context.params).threadId);
    const editionId = conversationEditionQuery(new URL(request.url).searchParams);
    const db = getDb();
    // WHY：必须先按版本读取会话，再取消息；不能仅凭全局 threadId 暴露另一版本的阅读历史。
    const row = db.prepare(select).get(threadId, editionId) as Record<string, unknown> | undefined;
    if (!row) return NextResponse.json({ error: "当前书籍版本中没有此会话" }, { status: 404, headers });
    const summary = conversationFromRow(row);
    const thread = { ...summary, chapterId: row.chapterId, paragraphId: row.paragraphId, selectedText: row.selectedText };
    const messages = db.prepare("SELECT id, role, content, raw_content AS rawContent, structured_output AS structuredOutput, usage_json AS usageJson, status, model_name AS modelName, prompt_version AS promptVersion, created_at AS createdAt FROM chat_messages WHERE thread_id = ? ORDER BY created_at, id").all(threadId);
    const toolsByMessage = readThreadToolHistory(db, { threadId, editionId });
    const history = messages.map((message) => {
      if (!message || typeof message !== "object" || !("id" in message) || typeof message.id !== "string") throw new Error("消息数据格式错误");
      return { ...message, ...(toolsByMessage.get(message.id) ?? { tools: [], historicalTools: [] }) };
    });
    return NextResponse.json({ threadId, thread, messages: history }, { headers });
  } catch (error: unknown) { return failure(error); }
}
export async function PATCH(request: Request, context: RouteContext) {
  let value: unknown;
  try { value = await request.json(); }
  catch (error: unknown) { console.error("重命名会话请求不是 JSON", error); return NextResponse.json({ error: "请求必须是合法 JSON" }, { status: 400, headers }); }
  try {
    const threadId = conversationId((await context.params).threadId);
    const { editionId, title } = renameConversationInput(value);
    const db = getDb();
    // WHY：读取与修改放在同一短事务，避免重命名时越过版本范围或误操作已变化的会话。
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare(select).get(threadId, editionId);
      if (!row) { db.exec("ROLLBACK"); return NextResponse.json({ error: "当前书籍版本中没有此会话" }, { status: 404, headers }); }
      db.prepare("UPDATE reading_threads SET title = ?, updated_at = ? WHERE id = ? AND edition_id = ?").run(title, new Date().toISOString(), threadId, editionId);
      const thread = conversationFromRow(db.prepare(select).get(threadId, editionId));
      db.exec("COMMIT");
      return NextResponse.json({ thread }, { headers });
    } catch (error: unknown) { db.exec("ROLLBACK"); throw error; }
  } catch (error: unknown) { return failure(error); }
}
