import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MemoryDatabase = { exec(sql: string): void; close(): void };
const state = vi.hoisted(() => ({ db: undefined as MemoryDatabase | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => {
  if (!state.db) throw new Error("测试数据库未初始化");
  return state.db;
} }));
import { GET } from "./route";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (file: string) => MemoryDatabase;
};
const get = (bookId: string, query = "") => GET(new Request("http://localhost/api/books/ignored" + query), {
  params: Promise.resolve({ bookId }),
});

beforeEach(() => {
  // WHY：替换数据库边界，用内存 SQLite 验证实际 WHERE/ORDER BY；不读用户文件或连接服务。
  state.db = new DatabaseSync(":memory:");
  state.db.exec(`
    CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT, author TEXT);
    CREATE TABLE editions (id TEXT PRIMARY KEY, book_id TEXT, created_at TEXT);
    CREATE TABLE chapters (id TEXT PRIMARY KEY, edition_id TEXT, title TEXT, order_index INTEGER);
    CREATE TABLE paragraphs (id TEXT PRIMARY KEY, chapter_id TEXT, text TEXT, order_index INTEGER);
    INSERT INTO books VALUES ('a','甲书','作者甲'),('b','乙书','作者乙'),('empty','未导入版本','作者丙');
    INSERT INTO editions VALUES ('a-old','a','2026-01-01'),('a-new','a','2026-02-01'),('b-new','b','2026-03-01');
    INSERT INTO chapters VALUES ('a2','a-new','第二章',2),('a1','a-new','第一章',1),
      ('old','a-old','旧版章节',0),('b1','b-new','别书章节',0);
    INSERT INTO paragraphs VALUES ('p2','a1','第二段',2),('p1','a1','第一段',1),
      ('p3','a2','第三段',0),('p-old','old','旧版本原文',0),('p-b','b1','乙书独有原文',0);
  `);
});
afterEach(() => { state.db?.close(); state.db = undefined; });

describe("GET books/[bookId]", () => {
  it("按路由 ID 获取书籍、最新版本和有序正文，不混入旧版或别书", async () => {
    const response = await get("a", "?bookId=b&editionId=b-new");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "a", title: "甲书", author: "作者甲", editionId: "a-new",
      chapters: [{ id: "a1", title: "第一章", paragraphs: [{ id: "p1", text: "第一段" }, { id: "p2", text: "第二段" }] },
        { id: "a2", title: "第二章", paragraphs: [{ id: "p3", text: "第三段" }] }] });
  });
  it("另一 bookId 只能获取其所属版本", async () => {
    const response = await get("b");
    expect(await response.json()).toMatchObject({ id: "b", editionId: "b-new", chapters: [{ id: "b1",
      paragraphs: [{ id: "p-b", text: "乙书独有原文" }] }] });
  });
  it.each(["missing", "", "a' OR 1=1 --"])("不存在或注入式 ID 不会回退其他书：%s", async (id) => {
    const response = await get(id);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "书籍不存在" });
  });
  it("有书无版本的当前契约是空目录，不能猜版本 ID", async () => {
    const response = await get("empty");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "empty", title: "未导入版本", author: "作者丙", chapters: [] });
  });
  it("最新版本无章节时不混用旧版本章节", async () => {
    state.db?.exec("INSERT INTO editions VALUES ('a-empty','a','2026-04-01')");
    expect(await (await get("a")).json()).toMatchObject({ editionId: "a-empty", chapters: [] });
  });
  it("数据库异常上抛而不是返回伪造空书", async () => {
    state.db?.exec("DROP TABLE books");
    await expect(get("a")).rejects.toThrow();
  });
});
