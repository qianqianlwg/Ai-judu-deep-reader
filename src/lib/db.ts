import fs from "node:fs";
import path from "node:path";

type SqliteStatement = {
  run: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
  get: (...args: unknown[]) => unknown;
};
type SqliteDatabase = {
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
  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new runtime.DatabaseSync(path.join(dataDir, "judu.sqlite"));
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS editions (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, file_name TEXT NOT NULL, file_type TEXT NOT NULL, file_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chapters (id TEXT PRIMARY KEY, edition_id TEXT NOT NULL, title TEXT NOT NULL, order_index INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS paragraphs (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, text TEXT NOT NULL, text_hash TEXT NOT NULL, order_index INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS analyses (id TEXT PRIMARY KEY, edition_id TEXT NOT NULL, chapter_id TEXT NOT NULL, paragraph_id TEXT, selected_text TEXT NOT NULL, context TEXT NOT NULL, model_name TEXT NOT NULL, prompt_version TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  return db;
}

// WHY：延迟初始化数据库，避免 Next.js 构建阶段多个 Worker 同时创建文件并触发锁竞争。
export function getDb() {
  database ??= createDatabase();
  return database!;
}


