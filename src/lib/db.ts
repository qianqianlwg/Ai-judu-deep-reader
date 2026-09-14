import fs from "node:fs";
import path from "node:path";
import { repairLegacyThreadIds } from "./legacy-threads";

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

let database: SqliteDatabase | undefined;

function createDatabase() {
  const getBuiltinModule = (process as unknown as { getBuiltinModule?: (name: string) => SqliteRuntime }).getBuiltinModule;
  const runtime = getBuiltinModule?.("node:sqlite");
  if (!runtime) throw new Error("需要 Node.js 22.5 或更高版本才能使用内置 SQLite");
  // WHY：隔离验收使用独立数据目录，不能向用户书架注入测试对话或标注。
  const dataDir = process.env.JUDU_DATA_DIR ?? path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new runtime.DatabaseSync(path.join(dataDir, "judu.sqlite"));
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS editions (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, file_name TEXT NOT NULL, file_type TEXT NOT NULL, file_hash TEXT NOT NULL, created_at TEXT NOT NULL);
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
  // WHY：旧空会话 ID 会锁住历史加载；先以事务迁移所有引用并保留内容，再把连接交给业务。
  const repaired = repairLegacyThreadIds(db);
  if (repaired.migrated) console.info("旧会话 ID 已无损迁移", { count: repaired.migrated });
  return db;
}

// WHY：延迟初始化数据库，避免 Next.js 构建阶段多个 Worker 同时创建文件并触发锁竞争。
export function getDb() {
  database ??= createDatabase();
  return database!;
}
