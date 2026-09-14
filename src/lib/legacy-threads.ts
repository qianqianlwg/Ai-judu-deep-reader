import { randomUUID } from "node:crypto";
import { isConversationId } from "./conversations";

// WHY：组合根负责传入已建表的连接；迁移不打开数据库、不读取环境，也不隐式修改生产文件。
export type LegacyThreadDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    all: (...parameters: unknown[]) => unknown[];
    get: (...parameters: unknown[]) => unknown;
    run: (...parameters: unknown[]) => unknown;
  };
};
const REFERENCE_TABLES = ["chat_messages", "annotations", "context_snapshots", "agent_tool_runs"] as const;
export type LegacyThreadReferenceTable = (typeof REFERENCE_TABLES)[number];
export type LegacyThreadIdMapping = {
  legacyRowId: number;
  oldId: string | null;
  newId: string;
  editionId: string;
};
export type LegacyThreadRepairResult = {
  migrated: number;
  mappings: LegacyThreadIdMapping[];
  updatedReferences: Record<LegacyThreadReferenceTable, number>;
};
export type LegacyThreadRepairOptions = { createId?: () => string; now?: () => string };
type LegacyRow = { legacyRowId: number; id: string | null; editionId: string };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function tableExists(db: LegacyThreadDatabase, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}
function countReferences(db: LegacyThreadDatabase, table: LegacyThreadReferenceTable, id: string | null): number {
  // WHY：表名来自固定白名单，所有旧ID（包括引号和控制字符）只能作为绑定值。
  const row = db.prepare('SELECT COUNT(*) AS count FROM "' + table + '" WHERE thread_id IS ?').get(id);
  if (!record(row) || typeof row.count !== "number" || !Number.isSafeInteger(row.count)) throw new Error("旧会话引用计数不合法：" + table);
  return row.count;
}
function readThreads(db: LegacyThreadDatabase): LegacyRow[] {
  return db.prepare("SELECT rowid AS legacyRowId, id, edition_id AS editionId FROM reading_threads ORDER BY rowid").all().map(value => {
    if (!record(value) || typeof value.legacyRowId !== "number" || !Number.isSafeInteger(value.legacyRowId) || (typeof value.id !== "string" && value.id !== null) || typeof value.editionId !== "string") {
      throw new Error("旧会话主键或版本字段无法安全识别，迁移已回滚");
    }
    return { legacyRowId: value.legacyRowId, id: value.id, editionId: value.editionId };
  });
}
function createUnusedId(db: LegacyThreadDatabase, tables: readonly LegacyThreadReferenceTable[], createId: () => string): string {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const id = createId();
    if (!UUID.test(id) || !isConversationId(id)) throw new Error("迁移ID生成器必须返回合法的 UUID v4");
    if (db.prepare("SELECT 1 FROM reading_threads WHERE id = ?").get(id)) continue;
    if (db.prepare("SELECT 1 FROM legacy_thread_id_migrations WHERE new_id = ?").get(id)) continue;
    // WHY：不能把随机碰撞的孤儿引用接管到另一本书，因此也检查全部引用表。
    if (tables.some(table => countReferences(db, table, id) > 0)) continue;
    return id;
  }
  throw new Error("无法生成未使用的迁移ID，所有变更已回滚");
}

/** 在建表/增列结束后调用，不能放入调用方事务。重复运行只处理新发现的非法ID。 */
export function repairLegacyThreadIds(db: LegacyThreadDatabase, options: LegacyThreadRepairOptions = {}): LegacyThreadRepairResult {
  const result: LegacyThreadRepairResult = { migrated: 0, mappings: [], updatedReferences: { chat_messages: 0, annotations: 0, context_snapshots: 0, agent_tool_runs: 0 } };
  let started = false;
  try {
    // WHY：SQLite迁移需要同一同步事务语义；先拿写锁，避免两个Worker读取同一旧ID后生成不同映射。
    db.exec("BEGIN IMMEDIATE"); started = true;
    if (!tableExists(db, "reading_threads")) { db.exec("COMMIT"); started = false; return result; }
    const tables = REFERENCE_TABLES.filter(table => tableExists(db, table));
    for (const table of tables) {
      if (!db.prepare('PRAGMA table_info("' + table + '")').all().some(column => record(column) && column.name === "thread_id")) throw new Error(table + " 缺少 thread_id，请先完成建表迁移");
    }
    const invalid = readThreads(db).filter(thread => !isConversationId(thread.id));
    if (!invalid.length) { db.exec("COMMIT"); started = false; return result; }
    // WHY：NULL引用可能代表未绑定记录，不能猜测它们属于哪一个NULL主键；这种歧义必须回滚并人工处理。
    if (invalid.some(thread => thread.id === null) && tables.some(table => countReferences(db, table, null) > 0)) throw new Error("存在无法归属的 NULL 会话引用，迁移已回滚；原数据未删除");
    db.exec(
      "CREATE TABLE IF NOT EXISTS legacy_thread_id_migrations (new_id TEXT PRIMARY KEY, legacy_rowid INTEGER NOT NULL, old_id TEXT, edition_id TEXT NOT NULL, migrated_at TEXT NOT NULL)"
    );
    // WHY：先把子引用改为新UUID，再改父主键；延迟检查可以同时兼容NO ACTION和RESTRICT外键。
    db.exec("PRAGMA defer_foreign_keys = ON");
    const migratedAt = (options.now ?? (() => new Date().toISOString()))();
    for (const thread of invalid) {
      const newId = createUnusedId(db, tables, options.createId ?? randomUUID);
      for (const table of tables) {
        const count = countReferences(db, table, thread.id);
        db.prepare('UPDATE "' + table + '" SET thread_id = ? WHERE thread_id IS ?').run(newId, thread.id);
        if (countReferences(db, table, thread.id) !== 0 || countReferences(db, table, newId) !== count) throw new Error(table + " 引用校验失败，迁移已回滚");
        result.updatedReferences[table] += count;
      }
      db.prepare("UPDATE reading_threads SET id = ? WHERE rowid = ? AND id IS ?").run(newId, thread.legacyRowId, thread.id);
      const saved = db.prepare("SELECT id FROM reading_threads WHERE rowid = ?").get(thread.legacyRowId);
      if (!record(saved) || saved.id !== newId) throw new Error("旧会话主键更新失败，迁移已回滚");
      db.prepare("INSERT INTO legacy_thread_id_migrations (new_id, legacy_rowid, old_id, edition_id, migrated_at) VALUES (?, ?, ?, ?, ?)").run(newId, thread.legacyRowId, thread.id, thread.editionId, migratedAt);
      result.mappings.push({ legacyRowId: thread.legacyRowId, oldId: thread.id, newId, editionId: thread.editionId });
    }
    db.exec("COMMIT"); started = false;
    result.migrated = result.mappings.length;
    return result;
  } catch (cause: unknown) {
    if (started) {
      try { db.exec("ROLLBACK"); }
      catch (rollbackError: unknown) { throw new AggregateError([cause, rollbackError], "旧会话迁移失败，回滚也失败，请检查数据库连接"); }
    }
    // WHY：迁移失败不能把部分成功当作已修复交给API；组合根必须收到原始异常并中止或记录。
    throw cause;
  }
}
