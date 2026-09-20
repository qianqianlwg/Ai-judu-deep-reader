import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createDatabase, getDb } from "./db";
let directory = "";
beforeAll(async () => {
  // WHY：迁移测试只能触及自己的临时数据库，绝不能因 npm test 修改用户真实书架。
  directory = await mkdtemp(path.join(tmpdir(), "judu-db-test-"));
  vi.stubEnv("JUDU_DATA_DIR", directory);
  const runtime = (process as unknown as { getBuiltinModule(name: string): { DatabaseSync: new (file: string) => { exec(sql: string): void; close(): void } } }).getBuiltinModule("node:sqlite");
  const old = new runtime.DatabaseSync(path.join(directory, "judu.sqlite"));
  old.exec("CREATE TABLE reading_threads (id TEXT PRIMARY KEY, book_id TEXT, edition_id TEXT NOT NULL, chapter_id TEXT, paragraph_id TEXT, selection_start INTEGER, selection_end INTEGER, selected_text TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); INSERT INTO reading_threads (id,edition_id,created_at,updated_at) VALUES ('','test-edition','2026-01-01','2026-01-01');");
  old.exec(`
    CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE editions (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, file_name TEXT NOT NULL, file_type TEXT NOT NULL, file_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE chapters (id TEXT PRIMARY KEY, edition_id TEXT NOT NULL, title TEXT NOT NULL, order_index INTEGER NOT NULL);
    CREATE TABLE paragraphs (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, text TEXT NOT NULL, text_hash TEXT NOT NULL, order_index INTEGER NOT NULL);
    CREATE TABLE annotations (id TEXT PRIMARY KEY, paragraph_id TEXT NOT NULL, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, text_hash TEXT NOT NULL, thread_id TEXT NOT NULL, summary TEXT NOT NULL, concepts TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE chat_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, raw_content TEXT, structured_output TEXT, status TEXT NOT NULL, model_name TEXT NOT NULL, prompt_version TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO books VALUES ('book-kept','旧书','旧作者','old-time');
    INSERT INTO editions VALUES ('edition-kept','book-kept','old.epub','.epub','legacy-file-hash','old-time');
    INSERT INTO chapters VALUES ('chapter-kept','edition-kept','旧章',0);
    INSERT INTO paragraphs VALUES ('paragraph-kept','chapter-kept','  旧正文与空格。  ','legacy-text-hash',0);
    INSERT INTO reading_threads (id,book_id,edition_id,chapter_id,paragraph_id,selected_text,created_at,updated_at) VALUES ('thread-kept','book-kept','edition-kept','chapter-kept','paragraph-kept','旧正文','old-time','old-time');
    INSERT INTO annotations VALUES ('annotation-kept','paragraph-kept',2,5,'legacy-text-hash','thread-kept','旧标注','["概念"]','old-time');
    INSERT INTO chat_messages VALUES ('message-kept','thread-kept','assistant','旧对话','旧原始输出',NULL,'done','model','v1','old-time');
  `);
  old.close();
});
afterAll(async () => {
  getDb().close(); vi.unstubAllEnvs();
  const resolved = path.resolve(directory);
  if (!resolved.startsWith(path.join(tmpdir(), "judu-db-test-"))) throw new Error("拒绝清理测试目录以外的路径");
  await rm(resolved, { recursive: true, force: true });
});
describe("getDb", () => {
  it("延迟创建并返回同一个隔离连接", () => {
    const first = getDb(); expect(first).toBe(getDb());
    expect(first.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='books'").get()).toBeTruthy();
    expect(first.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_tool_runs'").get()).toBeTruthy();
    expect(first.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reading_marks'").get()).toBeTruthy();
    expect(first.prepare("PRAGMA table_info(reading_marks)").all()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "edition_id" }), expect.objectContaining({ name: "kind" }), expect.objectContaining({ name: "anchors_json" }), expect.objectContaining({ name: "updated_at" })]));
    // WHY：独立表迁移只新增对象；已有会话和历史表不能被标注初始化改写。
    expect(first.prepare("PRAGMA table_info(chat_messages)").all()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "usage_json" })]));
  });
  it("组合根启动时迁移旧空ID而不删除原会话", () => {
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM reading_threads").get()).toEqual({count:2});
    expect(getDb().prepare("SELECT id FROM reading_threads WHERE id=''").get()).toBeUndefined();
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM legacy_thread_id_migrations").get()).toEqual({count:1});
  });
});


describe("dual-track incremental migration", () => {
  it("adds only nullable/defaulted metadata, preserving legacy identity, text, annotations and history", () => {
    const db = getDb();
    expect(db.prepare("SELECT * FROM books WHERE id='book-kept'").get()).toEqual({ id: "book-kept", title: "旧书", author: "旧作者", created_at: "old-time" });
    expect(db.prepare("SELECT * FROM editions WHERE id='edition-kept'").get()).toMatchObject({ id: "edition-kept", book_id: "book-kept", file_hash: "legacy-file-hash", original_file_path: "", original_file_size: 0, original_hash: null, reader_mode: "text" });
    expect(db.prepare("SELECT * FROM chapters WHERE id='chapter-kept'").get()).toEqual({ id: "chapter-kept", edition_id: "edition-kept", title: "旧章", order_index: 0, source_href: null });
    expect(db.prepare("SELECT * FROM paragraphs WHERE id='paragraph-kept'").get()).toEqual({ id: "paragraph-kept", chapter_id: "chapter-kept", text: "  旧正文与空格。  ", text_hash: "legacy-text-hash", order_index: 0 });
    expect(db.prepare("SELECT * FROM annotations WHERE id='annotation-kept'").get()).toMatchObject({ paragraph_id: "paragraph-kept", thread_id: "thread-kept", start_offset: 2, end_offset: 5, summary: "旧标注", text_hash: "legacy-text-hash" });
    expect(db.prepare("SELECT * FROM reading_threads WHERE id='thread-kept'").get()).toMatchObject({ book_id: "book-kept", edition_id: "edition-kept", paragraph_id: "paragraph-kept", selected_text: "旧正文" });
    expect(db.prepare("SELECT * FROM chat_messages WHERE id='message-kept'").get()).toMatchObject({ thread_id: "thread-kept", content: "旧对话", raw_content: "旧原始输出" });
  });
  it("is idempotent across database reopen and preserves newly stored metadata/source href", () => {
    const original = getDb();
    original.exec("UPDATE editions SET original_file_path='originals/edition-kept.epub', original_file_size=42, original_hash='raw-byte-hash' WHERE id='edition-kept'; UPDATE chapters SET source_href='OPS/chapter%20one.xhtml' WHERE id='chapter-kept'");
    const tables = ["books", "editions", "chapters", "paragraphs", "annotations", "reading_threads", "chat_messages"];
    const snapshots = tables.map(table => original.prepare("SELECT * FROM " + table + " ORDER BY id").all());
    for (let attempt = 0; attempt < 2; attempt++) {
      const reopened = createDatabase();
      try { expect(tables.map(table => reopened.prepare("SELECT * FROM " + table + " ORDER BY id").all())).toEqual(snapshots); }
      finally { reopened.close(); }
    }
  });
});
