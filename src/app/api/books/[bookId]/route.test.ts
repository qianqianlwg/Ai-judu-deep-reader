import { EDITION_CONVERSIONS_SCHEMA } from "@/lib/edition-conversion";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
type MemoryDatabase = { exec(sql: string): void; close(): void };
const state = vi.hoisted(() => ({ db: undefined as MemoryDatabase | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => { if (!state.db) throw new Error("测试数据库未初始化"); return state.db; } }));
import { GET } from "./route";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (file: string) => MemoryDatabase };
const get = (bookId: string, query = "") => GET(new Request("http://local/api/books/ignored" + query), { params: Promise.resolve({ bookId }) });
beforeEach(() => {
  state.db = new DatabaseSync(":memory:");
  state.db.exec(
    "CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT, author TEXT, created_at TEXT);" +
    "CREATE TABLE editions (id TEXT PRIMARY KEY, book_id TEXT, file_name TEXT, file_type TEXT, created_at TEXT);" +
    "CREATE TABLE chapters (id TEXT PRIMARY KEY, edition_id TEXT, title TEXT, order_index INTEGER);" +
    "CREATE TABLE paragraphs (id TEXT PRIMARY KEY, chapter_id TEXT, text TEXT, order_index INTEGER);" +
    "INSERT INTO books VALUES ('a','甲书','作者甲','2026-01-01'),('b','乙书','作者乙','2026-02-01'),('empty','空书','作者','2026-03-01');" +
    "INSERT INTO editions VALUES ('a-old','a','旧版.epub','epub','2026-01-01'),('a-new','a','新版.pdf','pdf','2026-02-01'),('b-new','b','乙书.epub','epub','2026-03-01');" +
    "INSERT INTO chapters VALUES ('a2','a-new','第二章',2),('a1','a-new','第一章',1),('old','a-old','旧版章节',0),('b1','b-new','别书章节',0);" +
    "INSERT INTO paragraphs VALUES ('p2','a1','第二段',2),('p1','a1','第一段',1),('p3','a2','第三段',0),('p-old','old','旧版本原文',0),('p-b','b1','乙书独有原文',0);"
  );
  state.db.exec("ALTER TABLE editions ADD COLUMN original_file_path TEXT NOT NULL DEFAULT ''; ALTER TABLE editions ADD COLUMN original_file_size INTEGER NOT NULL DEFAULT 0; ALTER TABLE editions ADD COLUMN original_hash TEXT;");
  state.db.exec(EDITION_CONVERSIONS_SCHEMA);
  state.db.exec("ALTER TABLE chapters ADD COLUMN source_href TEXT");
});
afterEach(() => { state.db?.close(); state.db = undefined; });
describe("GET books/[bookId] 显式版本", () => {
  it("省略editionId仍默认最新，但同时公开所有可选版本", async () => {
    const response = await get("a"); const body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({ id: "a", editionId: "a-new", edition: { fileName: "新版.pdf" }, chapters: [{ id: "a1", paragraphs: [{ id: "p1" }, { id: "p2" }] }, { id: "a2" }] });
    expect(body.editions.map((edition: { id: string }) => edition.id)).toEqual(["a-new", "a-old"]);
  });
  it("显式旧版返回旧版原文，不夹带新版段落", async () => {
    const body = await (await get("a", "?editionId=a-old")).json();
    expect(body).toMatchObject({ id: "a", editionId: "a-old", edition: { fileName: "旧版.epub" }, chapters: [{ id: "old", paragraphs: [{ id: "p-old", text: "旧版本原文" }] }] });
    expect(body.chapters).toHaveLength(1);
  });
  it.each(["b-new", "missing"])("他书或不存在版本不回落最新版：%s", async edition => { expect((await get("a", "?editionId=" + edition)).status).toBe(404); });
  it.each(["?editionId=", "?editionId=a-old&editionId=a-new", "?bookId=b&editionId=b-new", "?editionId=bad/id"])("拒绝歧义或非法版本参数：%s", async query => { expect((await get("a", query)).status).toBe(400); });
  it.each(["missing", "", "a' OR 1=1 --"])("无效BookID不回退其他书：%s", async id => { expect((await get(id)).status).toBe(404); });
  it("无版本和无章节均明确返回空目录，不混用其他版本", async () => {
    expect(await (await get("empty")).json()).toMatchObject({ id: "empty", editions: [], chapters: [] });
    state.db?.exec("INSERT INTO editions (id, book_id, file_name, file_type, created_at) VALUES ('a-empty','a','空版本.txt','txt','2026-04-01')");
    expect(await (await get("a")).json()).toMatchObject({ editionId: "a-empty", chapters: [] });
  });
  it("数据库异常上抛", async () => { state.db?.exec("DROP TABLE books"); await expect(get("a")).rejects.toThrow(); });
});
