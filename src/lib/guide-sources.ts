import { isRecord } from "./chat-stream";
import { anchorParts, joinAnchorText, readReadingAnchor, type ReadingAnchor } from "./reading-anchors";
import { verifySelectionAnchors } from "./reading-anchor-validation";
import type { GuideDb } from "./guide-store";
export type GuideSource = { id: string; bookId: string; editionId: string; threadId: string; messageId: string; anchor: ReadingAnchor; chapterTitle: string; chapterId: string; createdAt: string };
type SourceRow = { message_id: string; book_id: string; edition_id: string; thread_id: string; parent_message_id: string | null; anchor_json: string; chapter_title: string; chapter_id: string; created_at: string };
const candidateWhere = `m.role='assistant' AND m.status='completed' AND length(trim(m.content))>0 AND json_valid(m.structured_output) AND (json_extract(m.structured_output,'$._semanticParent') IS NOT NULL OR (json_extract(m.structured_output,'$._request.input.mode')='analyze' AND json_extract(m.structured_output,'$.semantic') IS NULL))`;
export function eligibleGuideSource(db: GuideDb, messageId: string): GuideSource | null {
  const row = db.prepare(`SELECT m.id,m.structured_output,m.created_at,t.id AS thread_id,t.edition_id,e.book_id FROM chat_messages m JOIN reading_threads t ON t.id=m.thread_id JOIN editions e ON e.id=t.edition_id WHERE m.id=? AND ${candidateWhere}`).get(messageId) as { id: string; structured_output: string; created_at: string; thread_id: string; edition_id: string; book_id: string } | undefined;
  if (!row) return null;
  const data: unknown = JSON.parse(row.structured_output);
  if (!isRecord(data)) return null;
  const anchor = readReadingAnchor(data.anchor);
  if (!anchor) return null;
  const parts = [...anchorParts(anchor)], first = parts[0];
  const verified = verifySelectionAnchors(db, { editionId: row.edition_id, bookId: row.book_id, chapterId: null, paragraphId: first.paragraphId, selectionStart: first.startOffset, selectionEnd: first.endOffset, selectedText: joinAnchorText(parts), selectionAnchors: parts });
  if (!verified) { console.warn("导读未纳入来源失配的历史句读", { messageId }); return null; }
  const chapter = db.prepare("SELECT c.title,c.id FROM paragraphs p JOIN chapters c ON c.id=p.chapter_id WHERE p.id=?").get(first.paragraphId) as { title: string; id: string };
  return { id: row.id, bookId: row.book_id, editionId: row.edition_id, threadId: row.thread_id, messageId: typeof data._semanticParent === "string" ? data._semanticParent : row.id, anchor: verified, chapterTitle: chapter.title, chapterId: chapter.id, createdAt: row.created_at };
}
// WHY：调用方将入队放进句读完成事务；这里只保存已核验选文，不把邻段、检索或 AI 回答作为新增事实输入。
export function enqueueGuideSource(db: GuideDb, messageId: string): boolean {
  if (db.prepare("SELECT message_id FROM guide_sources WHERE message_id=?").get(messageId)) return false;
  const source = eligibleGuideSource(db, messageId);
  if (!source) return false;
  db.prepare("INSERT OR IGNORE INTO guide_sources(message_id,book_id,edition_id,thread_id,parent_message_id,anchor_json,chapter_title,created_at) VALUES(?,?,?,?,?,?,?,?)").run(source.id, source.bookId, source.editionId, source.threadId, source.messageId === source.id ? null : source.messageId, JSON.stringify(source.anchor), source.chapterTitle, source.createdAt);
  return true;
}
export function historicalGuideIds(db: GuideDb, bookId: string): string[] {
  return (db.prepare(`SELECT m.id FROM chat_messages m JOIN reading_threads t ON t.id=m.thread_id JOIN editions e ON e.id=t.edition_id LEFT JOIN guide_sources s ON s.message_id=m.id WHERE e.book_id=? AND s.message_id IS NULL AND ${candidateWhere} AND json_extract(m.structured_output,'$.anchor') IS NOT NULL ORDER BY m.created_at,m.id`).all(bookId) as { id: string }[]).map(row => row.id);
}
export function readGuideSources(db: GuideDb, bookId: string, ids: readonly string[]): GuideSource[] {
  const query = db.prepare("SELECT s.*,p.chapter_id FROM guide_sources s JOIN paragraphs p ON p.id=json_extract(s.anchor_json,'$.paragraphId') WHERE message_id=? AND book_id=?");
  return [...new Set(ids)].flatMap(id => {
    const row = query.get(id, bookId) as SourceRow | undefined;
    if (!row) return [];
    const anchor = readReadingAnchor(JSON.parse(row.anchor_json));
    if (!anchor) throw new Error("导读来源快照格式不正确");
    return [{ id: row.message_id, bookId: row.book_id, editionId: row.edition_id, threadId: row.thread_id, messageId: row.parent_message_id ?? row.message_id, anchor, chapterTitle: row.chapter_title, chapterId: row.chapter_id, createdAt: row.created_at }];
  });
}
