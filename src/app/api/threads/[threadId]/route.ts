import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  if (!threadId) return NextResponse.json({ error: "缺少 threadId" }, { status: 400 });
  const db = getDb();
  const thread = db.prepare("SELECT id, book_id AS bookId, edition_id AS editionId, chapter_id AS chapterId, paragraph_id AS paragraphId, selected_text AS selectedText FROM reading_threads WHERE id = ?").get(threadId) as { id: string; bookId: string | null; editionId: string | null; chapterId: string | null; paragraphId: string | null; selectedText: string | null } | undefined;
  const messages = db.prepare("SELECT id, role, content, raw_content AS rawContent, structured_output AS structuredOutput, status, model_name AS modelName, prompt_version AS promptVersion, created_at AS createdAt FROM chat_messages WHERE thread_id = ? ORDER BY created_at, id").all(threadId);
  return NextResponse.json({ threadId, thread, messages });
}
