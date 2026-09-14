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
const get = (threadId: string, query = "") => GET(new Request("http://localhost/api/threads/ignored" + query), {
  params: Promise.resolve({ threadId }),
});

beforeEach(() => {
  // WHY：实际执行 SQL 范围与排序，但连接仅指向内存夹具，避免测试接触真实会话。
  state.db = new DatabaseSync(":memory:");
  state.db.exec(`
    CREATE TABLE reading_threads (id TEXT PRIMARY KEY, book_id TEXT, edition_id TEXT, chapter_id TEXT,
      paragraph_id TEXT, selected_text TEXT);
    CREATE TABLE chat_messages (id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, content TEXT, raw_content TEXT,
      structured_output TEXT, status TEXT, model_name TEXT, prompt_version TEXT, created_at TEXT);
    INSERT INTO reading_threads VALUES ('ta','book-a','edition-a','ca','pa','该线程选文'),
      ('ta2','book-a','edition-a','ca','pa','同书另一会话'),
      ('tb','book-b','edition-b','cb','pb','另一版本选文'),('empty','book-a','edition-a',NULL,NULL,NULL);
    INSERT INTO chat_messages VALUES
      ('a','ta','assistant','半截回答','原始半截','{"_request":{"version":1}}','error','test-model','v5','2026-01-01T00:00:01Z'),
      ('u','ta','user','请句读这一段','请句读这一段',NULL,'completed','test-model','v5','2026-01-01T00:00:00Z'),
      ('same-book','ta2','assistant','同书别会话',NULL,NULL,'completed','model','v5','2026-01-01'),
      ('other-edition','tb','assistant','别书私有内容',NULL,NULL,'completed','model','v5','2026-01-01');
  `);
});
afterEach(() => { state.db?.close(); state.db = undefined; });

describe("GET threads/[threadId]", () => {
  it("只按路由线程返回对应版本和消息，排除同书其他线程及其他版本", async () => {
    const response = await get("ta", "?threadId=tb&editionId=edition-b");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ threadId: "ta", thread: { id: "ta", bookId: "book-a",
      editionId: "edition-a", chapterId: "ca", paragraphId: "pa", selectedText: "该线程选文" }, messages: [
      { id: "u", role: "user", content: "请句读这一段", rawContent: "请句读这一段", structuredOutput: null,
        status: "completed", modelName: "test-model", promptVersion: "v5", createdAt: "2026-01-01T00:00:00Z" },
      { id: "a", role: "assistant", content: "半截回答", rawContent: "原始半截", structuredOutput: '{"_request":{"version":1}}',
        status: "error", modelName: "test-model", promptVersion: "v5", createdAt: "2026-01-01T00:00:01Z" },
    ] });
  });
  it("相同时间的消息仍按 ID 稳定排序", async () => {
    state.db?.exec("UPDATE chat_messages SET created_at='2026-01-01' WHERE thread_id='ta'");
    expect(await (await get("ta")).json()).toMatchObject({ messages: [{ id: "a" }, { id: "u" }] });
  });
  it("已存在的空线程保留版本身份和空消息数组", async () => {
    expect(await (await get("empty")).json()).toMatchObject({ threadId: "empty", thread: {
      id: "empty", editionId: "edition-a", chapterId: null, paragraphId: null, selectedText: null }, messages: [] });
  });
  it("缺少路径参数返回 400", async () => {
    const response = await get("");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "缺少 threadId" });
  });
  it.each(["missing", "ta' OR 1=1 --"])("不存在 ID 的当前契约为 200 空历史、不猜线程：%s", async (id) => {
    const response = await get(id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ threadId: id, messages: [] });
  });
  it("读取错误必须上抛，不把失败当作不存在", async () => {
    state.db?.exec("DROP TABLE chat_messages");
    await expect(get("ta")).rejects.toThrow();
  });
});
