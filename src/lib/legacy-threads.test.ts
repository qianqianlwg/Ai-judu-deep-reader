import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repairLegacyThreadIds, type LegacyThreadDatabase } from "./legacy-threads";
import { conversationFromRow, isConversationId } from "./conversations";

type TestDatabase = LegacyThreadDatabase & { close(): void };
const runtime = (process as unknown as { getBuiltinModule(name: string): { DatabaseSync: new (file: string) => TestDatabase } }).getBuiltinModule("node:sqlite");
let db: TestDatabase;
const firstUuid = "10000000-0000-4000-8000-000000000001";
const nextUuid = "10000000-0000-4000-8000-000000000002";
const finalUuid = "10000000-0000-4000-8000-000000000003";
const tables = ["reading_threads", "chat_messages", "annotations", "context_snapshots", "agent_tool_runs"] as const;
function seed(id: string | null, count = 14, prefix = "old", edition = "e1") {
  db.prepare("INSERT INTO reading_threads VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, edition, "book-" + edition, "原会话标题", "原选文😀", "2026-01-01", "2026-01-02");
  for (let index = 0; index < count; index += 1) db.prepare("INSERT INTO chat_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(prefix + "-m" + index, id, index % 2 ? "assistant" : "user", "原消息" + index, "raw-" + index, '{"summary":"不重写JSON"}', '{"totalTokens":99}', "completed", "2026-01-01");
  if (!count) return;
  db.prepare("INSERT INTO annotations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(prefix + "-annotation", id, "p1", 2, 9, "source-hash", prefix + "-m1", '[{"name":"概念","text":"定义"}]', "2026-01-01");
  db.prepare("INSERT INTO context_snapshots VALUES (?, ?, ?, ?, ?, ?, ?)").run(prefix + "-context", id, edition, "摘要不改", '[{"id":"same-message"}]', 3, "2026-01-01");
  db.prepare("INSERT INTO agent_tool_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(prefix + "-tool", id, prefix + "-m1", "read_source", '{"sourceId":"source"}', '{"ok":true}', "completed", "2026-01-01");
}
function dump() { return Object.fromEntries(tables.map(table => [table, db.prepare('SELECT * FROM "' + table + '" ORDER BY rowid').all()])); }
function withoutIdentity(snapshot: ReturnType<typeof dump>) {
  return Object.fromEntries(Object.entries(snapshot).map(([table, rows]) => [table, rows.map(row => {
    if (!row || typeof row !== "object") throw new Error("异常测试行");
    return Object.fromEntries(Object.entries(row).filter(([key]) => key !== (table === "reading_threads" ? "id" : "thread_id")));
  })]));
}
beforeEach(() => {
  db = new runtime.DatabaseSync(":memory:");
  db.exec(
    "PRAGMA foreign_keys = ON;" +
    "CREATE TABLE reading_threads (id TEXT PRIMARY KEY, edition_id TEXT NOT NULL, book_id TEXT, title TEXT, selected_text TEXT, created_at TEXT, updated_at TEXT);" +
    "CREATE TABLE chat_messages (id TEXT PRIMARY KEY, thread_id TEXT REFERENCES reading_threads(id) ON UPDATE RESTRICT, role TEXT, content TEXT, raw_content TEXT, structured_output TEXT, usage_json TEXT, status TEXT, created_at TEXT);" +
    "CREATE TABLE annotations (id TEXT PRIMARY KEY, thread_id TEXT REFERENCES reading_threads(id) ON UPDATE RESTRICT, paragraph_id TEXT, start_offset INTEGER, end_offset INTEGER, text_hash TEXT, message_id TEXT, concept_details TEXT, created_at TEXT);" +
    "CREATE TABLE context_snapshots (id TEXT PRIMARY KEY, thread_id TEXT REFERENCES reading_threads(id) ON UPDATE RESTRICT, edition_id TEXT, summary TEXT, recent_messages TEXT, version INTEGER, created_at TEXT);" +
    "CREATE TABLE agent_tool_runs (id TEXT PRIMARY KEY, thread_id TEXT REFERENCES reading_threads(id) ON UPDATE RESTRICT, message_id TEXT, tool_name TEXT, input_json TEXT, output_json TEXT, status TEXT, created_at TEXT);"
  );
});
afterEach(() => db.close());

describe("repairLegacyThreadIds 非破坏迁移", () => {
  it("保留空ID的全部14条消息、原文锚点、Token与工具审计，并可作为合法会话读取", () => {
    seed(""); const before = dump();
    const result = repairLegacyThreadIds(db, { createId: () => firstUuid, now: () => "2026-01-03" });
    expect(result).toMatchObject({ migrated: 1, mappings: [{ oldId: "", newId: firstUuid, editionId: "e1" }], updatedReferences: { chat_messages: 14, annotations: 1, context_snapshots: 1, agent_tool_runs: 1 } });
    expect(withoutIdentity(dump())).toEqual(withoutIdentity(before));
    for (const table of tables) expect(db.prepare('SELECT COUNT(*) AS n FROM "' + table + '" WHERE ' + (table === "reading_threads" ? "id" : "thread_id") + ' = ?').get(firstUuid)).toMatchObject({ n: table === "chat_messages" ? 14 : 1 });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toMatchObject({ foreign_keys: 1 });
    const row = db.prepare("SELECT id, edition_id AS editionId, book_id AS bookId, title, created_at AS createdAt, updated_at AS updatedAt, (SELECT COUNT(*) FROM chat_messages WHERE thread_id = reading_threads.id) AS messageCount FROM reading_threads").get();
    expect(conversationFromRow(row)).toMatchObject({ id: firstUuid, messageCount: 14, title: "原会话标题" });
    expect(db.prepare("SELECT old_id, new_id FROM legacy_thread_id_migrations").get()).toMatchObject({ old_id: "", new_id: firstUuid });
  });

  it("重复执行幂等，不新增映射、不改UUID或历史", () => {
    seed(""); repairLegacyThreadIds(db, { createId: () => firstUuid }); const before = dump(); const createId = vi.fn(() => nextUuid);
    expect(repairLegacyThreadIds(db, { createId })).toMatchObject({ migrated: 0, mappings: [] });
    expect(createId).not.toHaveBeenCalled(); expect(dump()).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM legacy_thread_id_migrations").get()).toMatchObject({ n: 1 });
  });

  it("全部非法字符串都映射UUID，正常会话及其他版本不会混入", () => {
    const invalid = ["", " ", "bad/id", "a\n", "_leading", "x".repeat(129), "a' OR 1=1--", "a\u0000b"];
    invalid.forEach((id, index) => seed(id, index === 0 ? 14 : 2, "case" + index, index % 2 ? "e2" : "e1"));
    seed("valid:thread-1", 2, "valid", "e3"); const before = dump();
    const result = repairLegacyThreadIds(db);
    expect(result.migrated).toBe(invalid.length); expect(new Set(result.mappings.map(item => item.newId)).size).toBe(invalid.length);
    expect(result.mappings.every(item => isConversationId(item.newId))).toBe(true);
    expect(result.mappings.map(item => item.oldId)).toEqual(invalid);
    expect(withoutIdentity(dump())).toEqual(withoutIdentity(before));
    expect(db.prepare("SELECT thread_id FROM chat_messages WHERE id = 'valid-m0'").get()).toMatchObject({ thread_id: "valid:thread-1" });
    for (const item of result.mappings) expect(db.prepare("SELECT edition_id FROM reading_threads WHERE id = ?").get(item.newId)).toMatchObject({ edition_id: item.editionId });
  });

  it("任一子表更新失败时连同映射表DDL和已更新引用全部回滚", () => {
    seed(""); const before = dump();
    db.exec("CREATE TRIGGER fail_migration BEFORE UPDATE OF thread_id ON context_snapshots BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    expect(() => repairLegacyThreadIds(db)).toThrow("forced failure"); expect(dump()).toEqual(before);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'legacy_thread_id_migrations'").get()).toBeUndefined();
    db.exec("DROP TRIGGER fail_migration"); expect(repairLegacyThreadIds(db).migrated).toBe(1);
  });

  it("未适配的外键引用导致commit失败也会完整回滚，不留下断链", () => {
    seed(""); db.exec("CREATE TABLE future_reference (thread_id TEXT REFERENCES reading_threads(id))"); db.prepare("INSERT INTO future_reference VALUES (?)").run(""); const before = dump();
    expect(() => repairLegacyThreadIds(db)).toThrow(/FOREIGN KEY/u); expect(dump()).toEqual(before);
    expect(db.prepare("SELECT thread_id FROM future_reference").get()).toMatchObject({ thread_id: "" });
  });

  it("UUID碰撞不能覆盖正常会话或接管孤儿引用", () => {
    seed(""); seed(firstUuid, 0, "existing");
    db.exec("PRAGMA foreign_keys = OFF"); db.prepare("INSERT INTO annotations (id, thread_id) VALUES (?, ?)").run("orphan", nextUuid); db.exec("PRAGMA foreign_keys = ON");
    const ids = [firstUuid, nextUuid, finalUuid]; const result = repairLegacyThreadIds(db, { createId: () => ids.shift()! });
    expect(result.mappings[0].newId).toBe(finalUuid); expect(db.prepare("SELECT thread_id FROM annotations WHERE id = 'orphan'").get()).toMatchObject({ thread_id: nextUuid });
  });

  it("生成器失败或反复碰撞不留下任何部分修改", () => {
    seed(""); seed(firstUuid, 0); const before = dump();
    expect(() => repairLegacyThreadIds(db, { createId: () => "invalid" })).toThrow("UUID"); expect(dump()).toEqual(before);
    expect(() => repairLegacyThreadIds(db, { createId: () => firstUuid })).toThrow("无法生成"); expect(dump()).toEqual(before);
  });

  it("NULL主键无歧义时保留并修复；无法归属的NULL引用必须报错而非猜测绑定", () => {
    seed(null, 0); expect(repairLegacyThreadIds(db).mappings[0].oldId).toBeNull();
    seed(null, 0, "new-null"); db.prepare("INSERT INTO annotations (id, thread_id) VALUES (?, NULL)").run("unbound"); const before = dump();
    expect(() => repairLegacyThreadIds(db)).toThrow("无法归属"); expect(dump()).toEqual(before);
  });

  it("缺少可选旧表时仍能迁移，不要求先启动业务服务", () => {
    db.exec("DROP TABLE agent_tool_runs; DROP TABLE context_snapshots; DROP TABLE annotations");
    db.prepare("INSERT INTO reading_threads (id, edition_id) VALUES (?, ?)").run("", "e1");
    expect(repairLegacyThreadIds(db)).toMatchObject({ migrated: 1, updatedReferences: { annotations: 0, context_snapshots: 0, agent_tool_runs: 0 } });
  });

  it("拒绝嵌套调用但不回滚调用方事务", () => {
    db.exec("BEGIN"); seed("", 0);
    expect(() => repairLegacyThreadIds(db)).toThrow(/transaction/u);
    expect(db.prepare("SELECT COUNT(*) AS n FROM reading_threads").get()).toMatchObject({ n: 1 }); db.exec("ROLLBACK");
    expect(db.prepare("SELECT COUNT(*) AS n FROM reading_threads").get()).toMatchObject({ n: 0 });
  });
});
