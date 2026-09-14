import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { getDb } from "./db";
let directory = "";
beforeAll(async () => {
  // WHY：迁移测试只能触及自己的临时数据库，绝不能因 npm test 修改用户真实书架。
  directory = await mkdtemp(path.join(tmpdir(), "judu-db-test-"));
  vi.stubEnv("JUDU_DATA_DIR", directory);
  const runtime = (process as unknown as { getBuiltinModule(name: string): { DatabaseSync: new (file: string) => { exec(sql: string): void; close(): void } } }).getBuiltinModule("node:sqlite");
  const old = new runtime.DatabaseSync(path.join(directory, "judu.sqlite"));
  old.exec("CREATE TABLE reading_threads (id TEXT PRIMARY KEY, book_id TEXT, edition_id TEXT NOT NULL, chapter_id TEXT, paragraph_id TEXT, selection_start INTEGER, selection_end INTEGER, selected_text TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); INSERT INTO reading_threads (id,edition_id,created_at,updated_at) VALUES ('','test-edition','2026-01-01','2026-01-01');");
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
    expect(first.prepare("PRAGMA table_info(chat_messages)").all()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "usage_json" })]));
  });
  it("组合根启动时迁移旧空ID而不删除原会话", () => {
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM reading_threads").get()).toEqual({count:1});
    expect(getDb().prepare("SELECT id FROM reading_threads WHERE id=''").get()).toBeUndefined();
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM legacy_thread_id_migrations").get()).toEqual({count:1});
  });
});
