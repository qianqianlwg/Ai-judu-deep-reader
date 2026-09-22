import {BOOK_SHELF_SCHEMA} from "@/lib/book-shelf";
import { EDITION_CONVERSIONS_SCHEMA } from "@/lib/edition-conversion";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
type MemoryDatabase = { exec(sql: string): void; close(): void };
const state = vi.hoisted(() => ({ db: undefined as MemoryDatabase | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => { if (!state.db) throw new Error("测试数据库未初始化"); return state.db; } }));
import { GET } from "./route";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (file: string) => MemoryDatabase };
beforeEach(() => {
  state.db = new DatabaseSync(":memory:");
  state.db.exec(
    "CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT, author TEXT, created_at TEXT, private_note TEXT);" +
    "CREATE TABLE editions (id TEXT PRIMARY KEY, book_id TEXT, file_name TEXT, file_type TEXT, created_at TEXT, file_hash TEXT);" +
    "INSERT INTO books VALUES ('old','同名书','旧作者','2026-01-01','private'),('other','另一部书','另一作者','2026-02-01','private'),('new','同名书','新作者','2026-03-01','private');" +
    "INSERT INTO editions VALUES ('old-v0','old','初版.epub','epub','2025-01-01','hash-secret'),('old-v1','old','修订.epub','epub','2026-01-01','hash-secret'),('new-v1','new','新译.pdf','pdf','2026-03-01','hash-secret'),('other-v1','other','另一部书.txt','txt','2026-02-01','hash-secret');"
  );
  state.db.exec("ALTER TABLE editions ADD COLUMN original_file_path TEXT NOT NULL DEFAULT ''; ALTER TABLE editions ADD COLUMN original_file_size INTEGER NOT NULL DEFAULT 0; ALTER TABLE editions ADD COLUMN original_hash TEXT;");
  state.db.exec(EDITION_CONVERSIONS_SCHEMA);
});
afterEach(() => { state.db?.close(); state.db = undefined; });
describe("GET library 保留全部书籍与版本", () => {
  it("不再按标题去重，返回全部BookID和可辨版本公开元数据", async () => {
    const response = await GET(); const value = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(value.map((book: { id: string }) => book.id)).toEqual(["new", "other", "old"]);
    expect(value[2]).toEqual({ id: "old", title: "同名书", author: "旧作者", createdAt: "2026-01-01", editions: [
      { id: "old-v1", fileName: "修订.epub", fileType: "epub", createdAt: "2026-01-01", hasOriginalFile: false, fileSize: 0, readerMode: "text" },
      { id: "old-v0", fileName: "初版.epub", fileType: "epub", createdAt: "2025-01-01", hasOriginalFile: false, fileSize: 0, readerMode: "text" },
    ] });
    expect(JSON.stringify(value)).not.toContain("private"); expect(JSON.stringify(value)).not.toContain("hash-secret");
  });
  it("8个BookID即使只有2种书名也全部可达，9个EditionID均保留", async () => {
    for (let index = 0; index < 5; index += 1) state.db?.exec("INSERT INTO books VALUES ('extra" + index + "','同名书','作者','2026-04-01','private'); INSERT INTO editions (id, book_id, file_name, file_type, created_at, file_hash) VALUES ('extra-v" + index + "','extra" + index + "','同一文件.epub','epub','2026-04-01','hash');");
    const value = await (await GET()).json();
    expect(value).toHaveLength(8);
    expect(new Set(value.map((book: { id: string }) => book.id)).size).toBe(8);
    expect(new Set(value.flatMap((book: { editions: { id: string }[] }) => book.editions.map(edition => edition.id))).size).toBe(9);
  });
  it("没有版本的BookID也保留，不创建或猜测EditionID", async () => {
    state.db?.exec("INSERT INTO books VALUES ('empty','暂无正文','作者','2026-05-01','private')");
    const value = await (await GET()).json(); expect(value.find((book: { id: string }) => book.id === "empty").editions).toEqual([]);
  });
  it("空书架返回空数组，不创建示例数据", async () => { state.db?.exec("DELETE FROM books; DELETE FROM editions"); expect(await (await GET()).json()).toEqual([]); });
  it("数据库异常上抛，不伪装成空书架", async () => { state.db?.exec("DROP TABLE books"); await expect(GET()).rejects.toThrow(); });
});

it("默认隐藏已下架BookID，已下架列表保留所有版本和同名书身份",async()=>{state.db!.exec(BOOK_SHELF_SCHEMA+";INSERT INTO book_shelf_state VALUES('old','2026-09-21')");const active=await(await GET()).json();expect(active.map((item:{id:string})=>item.id)).toEqual(['new','other']);const archived=await(await GET(new Request('http://localhost/api/library?shelf=archived'))).json();expect(archived).toHaveLength(1);expect(archived[0].id).toBe('old');expect(archived[0].editions).toHaveLength(2);});

it("显示名作为额外字段返回，原始书名与版本不变",async()=>{const {setBookDisplayTitle}=await import("@/lib/book-display-title");const db=state.db as unknown as import("@/lib/book-shelf").ShelfStore;setBookDisplayTitle(db,"old","简洁书名");const books=await(await GET()).json();const book=books.find((item:{id:string})=>item.id==="old");expect(book.displayTitle).toBe("简洁书名");expect(book.title).toBe("同名书");expect(book.editions).toHaveLength(2);});
