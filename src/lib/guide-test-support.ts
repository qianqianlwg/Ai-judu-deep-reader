import type { GuideDb } from "./guide-store";
const { DatabaseSync } = (process as unknown as { getBuiltinModule(name: string): { DatabaseSync: new (path: string) => GuideDb & { close(): void } } }).getBuiltinModule("node:sqlite");
import { GUIDE_SCHEMA } from "./guide-schema";
export function guideFixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`${GUIDE_SCHEMA}
    CREATE TABLE books(id TEXT PRIMARY KEY,title TEXT);
    CREATE TABLE editions(id TEXT PRIMARY KEY,book_id TEXT);
    CREATE TABLE chapters(id TEXT PRIMARY KEY,edition_id TEXT,title TEXT,order_index INTEGER);
    CREATE TABLE paragraphs(id TEXT PRIMARY KEY,chapter_id TEXT,text TEXT,order_index INTEGER);
    CREATE TABLE reading_threads(id TEXT PRIMARY KEY,edition_id TEXT);
    CREATE TABLE chat_messages(id TEXT PRIMARY KEY,thread_id TEXT,role TEXT,status TEXT,content TEXT,structured_output TEXT,created_at TEXT);
    INSERT INTO books VALUES('b','实践与认识'),('other','另一书');
    INSERT INTO editions VALUES('e','b'),('e2','other');
    INSERT INTO chapters VALUES('c','e','第一章',0),('c2','e2','第二章',0);
    INSERT INTO paragraphs VALUES('p','c','认识来自实践，也回到实践。',0),('p2','c2','这不是本书原文。',0);
    INSERT INTO reading_threads VALUES('t','e'),('t2','e2');`);
  const anchor = { paragraphId: "p", startOffset: 0, endOffset: 6, selectedText: "认识来自实践" };
  function message(id = "m", patch: Record<string, unknown> = {}, status = "completed", thread = "t") {
    db.prepare("INSERT INTO chat_messages VALUES(?,?, 'assistant',?,'已完成句读',?,?)").run(id, thread, status, JSON.stringify({ anchor, readingText: "解释", _request: { input: { mode: "analyze" } }, ...patch }), new Date().toISOString());
  }
  return { db, anchor, message };
}
