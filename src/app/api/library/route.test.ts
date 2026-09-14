import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MemoryDatabase = { exec(sql: string): void; close(): void };
const state = vi.hoisted(() => ({ db: undefined as MemoryDatabase | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => {
  if (!state.db) throw new Error("测试数据库未初始化");
  return state.db;
} }));
import { GET } from "./route";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (file: string) => MemoryDatabase };

beforeEach(() => {
  // WHY：只在内存中建立书架测试夹具，真实用户数据库不会被打开。
  state.db = new DatabaseSync(":memory:");
  state.db.exec(`CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT, author TEXT, created_at TEXT, private_note TEXT);
    INSERT INTO books VALUES ('old','同名书','旧作者','2026-01-01','不应公开'),
      ('other','另一部书','另一作者','2026-02-01','不应公开'),
      ('new','同名书','新作者','2026-03-01','不应公开');`);
});
afterEach(() => { state.db?.close(); state.db = undefined; });

describe("GET library", () => {
  it("按创建时间倒序，仅返回书架公开字段", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "new", title: "同名书", author: "新作者" },
      { id: "other", title: "另一部书", author: "另一作者" }]);
  });
  it("明确覆盖当前按精确书名去重并保留最新一本的契约", async () => {
    state.db?.exec("INSERT INTO books VALUES ('newest','同名书','第三位作者','2026-04-01','private')");
    const value: unknown = await (await GET()).json();
    expect(value).toEqual([{ id: "newest", title: "同名书", author: "第三位作者" },
      { id: "other", title: "另一部书", author: "另一作者" }]);
  });
  it("同作者不同标题仍是不同的书", async () => {
    state.db?.exec("INSERT INTO books VALUES ('different','不同标题','新作者','2026-04-01','private')");
    expect(await (await GET()).json()).toHaveLength(3);
  });
  it("空书架返回空数组，不创建示例数据", async () => {
    state.db?.exec("DELETE FROM books");
    expect(await (await GET()).json()).toEqual([]);
  });
  it("数据库异常上抛，不伪装成空书架", async () => {
    state.db?.exec("DROP TABLE books");
    await expect(GET()).rejects.toThrow();
  });
});
