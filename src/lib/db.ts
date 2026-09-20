import fs from "node:fs";
import path from "node:path";
import { repairLegacyThreadIds } from "./legacy-threads";
import { migrateEditionConversions } from "./edition-conversion";
import { getJuduDataDir } from "./data-storage";

type SqliteStatement = {
  run: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
  get: (...args: unknown[]) => unknown;
};
type SqliteDatabase = {
  close(): void;
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
  transaction: (fn: () => void) => () => void;
};
type SqliteRuntime = { DatabaseSync: new (file: string) => SqliteDatabase };

// WHY：手动标亮、笔记和收藏独立于 AI annotations；增量建表不迁移或覆盖任何句读历史。
export const READING_MARKS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS reading_marks (
    id TEXT PRIMARY KEY,
    edition_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('highlight', 'note', 'favorite')),
    color TEXT NOT NULL DEFAULT 'yellow' CHECK (color IN ('yellow', 'green', 'blue', 'pink', 'orange')),
    note TEXT NOT NULL DEFAULT '',
    anchors_json TEXT NOT NULL CHECK (json_valid(anchors_json) AND json_type(anchors_json) = 'array' AND json_array_length(anchors_json) > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reading_marks_edition_updated ON reading_marks (edition_id, updated_at, id);
`;

let database: SqliteDatabase | undefined;

export function createDatabase() {
  const getBuiltinModule = (process as unknown as { getBuiltinModule?: (name: string) => SqliteRuntime }).getBuiltinModule;
  const runtime = getBuiltinModule?.("node:sqlite");
  if (!runtime) throw new Error("需要 Node.js 22.5 或更高版本才能使用内置 SQLite");
  // WHY：隔离验收使用独立数据目录，不能向用户书架注入测试对话或标注。
  const dataDir = getJuduDataDir();
  // WHY：现有 getDb/DatabaseSync 调用链要求同步引导与事务；仅首次创建目录使用同步 IO。
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new runtime.DatabaseSync(path.join(dataDir, "judu.sqlite"));
  db.exec("PRAGMA busy_timeout = 5000;");
  try {
    // WHY：并行 Worker 的增列必须在同一写锁内检查执行，避免重复 ALTER；迁移只增列，不重建正文表。
    db.exec("BEGIN IMMEDIATE");
    db.exec(`
      CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS editions (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, file_name TEXT NOT NULL, file_type TEXT NOT NULL, file_hash TEXT NOT NULL, original_file_path TEXT NOT NULL DEFAULT '', original_file_size INTEGER NOT NULL DEFAULT 0, original_hash TEXT, reader_mode TEXT NOT NULL DEFAULT 'text', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chapters (id TEXT PRIMARY KEY, edition_id TEXT NOT NULL, title TEXT NOT NULL, order_index INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS paragraphs (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, text TEXT NOT NULL, text_hash TEXT NOT NULL, order_index INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS analyses (id TEXT PRIMARY KEY, edition_id TEXT NOT NULL, chapter_id TEXT NOT NULL, paragraph_id TEXT, selected_text TEXT NOT NULL, context TEXT NOT NULL, model_name TEXT NOT NULL, prompt_version TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reading_threads (id TEXT PRIMARY KEY, book_id TEXT, edition_id TEXT NOT NULL, chapter_id TEXT, paragraph_id TEXT, selection_start INTEGER, selection_end INTEGER, selected_text TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS context_snapshots (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, book_id TEXT, edition_id TEXT, summary TEXT NOT NULL, recent_messages TEXT NOT NULL, token_count INTEGER NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, raw_content TEXT, structured_output TEXT, status TEXT NOT NULL, model_name TEXT NOT NULL, prompt_version TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_provider_configs (id TEXT PRIMARY KEY, provider TEXT NOT NULL, base_url TEXT NOT NULL, api_key TEXT NOT NULL, model TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS annotations (id TEXT PRIMARY KEY, paragraph_id TEXT NOT NULL, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, text_hash TEXT NOT NULL, thread_id TEXT NOT NULL, summary TEXT NOT NULL, concepts TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_annotations_paragraph ON annotations (paragraph_id, start_offset);
      CREATE INDEX IF NOT EXISTS idx_annotations_thread ON annotations (thread_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_chapters_edition_order ON chapters (edition_id, order_index);
      CREATE INDEX IF NOT EXISTS idx_paragraphs_chapter_order ON paragraphs (chapter_id, order_index);
    `);
    // WHY：兼容已有本地书架，以增量迁移保存概念定义及每次句读的消息锚点。
    db.exec(READING_MARKS_SCHEMA);
    const editionColumns = db.prepare("PRAGMA table_info(editions)").all() as { name: string }[];
    if (!editionColumns.some((column) => column.name === "original_file_path")) db.exec("ALTER TABLE editions ADD COLUMN original_file_path TEXT NOT NULL DEFAULT ''");
    if (!editionColumns.some((column) => column.name === "original_file_size")) db.exec("ALTER TABLE editions ADD COLUMN original_file_size INTEGER NOT NULL DEFAULT 0");
    if (!editionColumns.some((column) => column.name === "reader_mode")) db.exec("ALTER TABLE editions ADD COLUMN reader_mode TEXT NOT NULL DEFAULT 'text'");
    if (!editionColumns.some((column) => column.name === "original_hash")) db.exec("ALTER TABLE editions ADD COLUMN original_hash TEXT");
    migrateEditionConversions(db);
    const chapterColumns = db.prepare("PRAGMA table_info(chapters)").all() as { name: string }[];
    if (!chapterColumns.some((column) => column.name === "source_href")) db.exec("ALTER TABLE chapters ADD COLUMN source_href TEXT");
    const columns = db.prepare("PRAGMA table_info(annotations)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "concept_details")) db.exec("ALTER TABLE annotations ADD COLUMN concept_details TEXT NOT NULL DEFAULT '[]'");
    if (!columns.some((column) => column.name === "message_id")) db.exec("ALTER TABLE annotations ADD COLUMN message_id TEXT");
    const threadColumns = db.prepare("PRAGMA table_info(reading_threads)").all() as {name:string}[];
    if (!threadColumns.some(c=>c.name==="title")) db.exec("ALTER TABLE reading_threads ADD COLUMN title TEXT NOT NULL DEFAULT '新会话'");
    const messageColumns = db.prepare("PRAGMA table_info(chat_messages)").all() as {name:string}[];
    if (!messageColumns.some(c=>c.name==="usage_json")) db.exec("ALTER TABLE chat_messages ADD COLUMN usage_json TEXT");
    db.exec("CREATE TABLE IF NOT EXISTS agent_tool_runs (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, thread_id TEXT NOT NULL, tool_name TEXT NOT NULL, input_json TEXT NOT NULL, output_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tool_runs_message ON agent_tool_runs(message_id, created_at)");
    const toolColumns = db.prepare("PRAGMA table_info(agent_tool_runs)").all() as {name:string}[];
    if (!toolColumns.some(c=>c.name==="attempt_id")) db.exec("ALTER TABLE agent_tool_runs ADD COLUMN attempt_id TEXT");
    const contextColumns = db.prepare("PRAGMA table_info(context_snapshots)").all() as {name:string}[];
    if (!contextColumns.some(c=>c.name==="checkpoint_json")) db.exec("ALTER TABLE context_snapshots ADD COLUMN checkpoint_json TEXT");
    db.exec("COMMIT");
  } catch (error: unknown) {
    try { db.exec("ROLLBACK"); }
    catch (rollbackError: unknown) { console.error("数据库迁移回滚失败", rollbackError); }
    db.close();
    throw error;
  }
  // WHY：旧空会话 ID 会锁住历史加载；先以事务迁移所有引用并保留内容，再把连接交给业务。
  try {
    const repaired = repairLegacyThreadIds(db);
    if (repaired.migrated) console.info("旧会话 ID 已无损迁移", { count: repaired.migrated });
  } catch (error: unknown) { db.close(); throw error; }
  return db;
}

// WHY：延迟初始化数据库，避免 Next.js 构建阶段多个 Worker 同时创建文件并触发锁竞争。
export function getDb() {
  database ??= createDatabase();
  return database!;
}
