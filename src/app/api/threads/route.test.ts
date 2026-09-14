import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "@/lib/db";
type Db = ReturnType<typeof getDb> & { close(): void };
const state = vi.hoisted(() => ({ db: undefined as Db | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
import { GET, POST } from "./route";
const runtime = (process as unknown as { getBuiltinModule(name: string): { DatabaseSync: new (file: string) => Db } }).getBuiltinModule("node:sqlite");
const get = (query = "editionId=e1") => GET(new Request("http://localhost/api/threads?" + query));
const post = (body: unknown) => POST(new Request("http://localhost/api/threads", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => {
  state.db = new runtime.DatabaseSync(":memory:");
  state.db.exec(String.raw`
    CREATE TABLE editions (id TEXT PRIMARY KEY, book_id TEXT);
    INSERT INTO editions VALUES ('e1','same-book'), ('e2','same-book');
    CREATE TABLE reading_threads (id TEXT PRIMARY KEY, edition_id TEXT, book_id TEXT, title TEXT, selected_text TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE chat_messages (id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, content TEXT, created_at TEXT, structured_output TEXT);
    INSERT INTO reading_threads VALUES ('legacy', 'e1', 'same-book', NULL, '原来的选区', '2025-01-01', '2025-01-01'), ('another-version', 'e2', 'same-book', '不应出现', NULL, '2025-02-01', '2025-02-01');
    INSERT INTO chat_messages VALUES ('u1', 'legacy', 'user', '请句读这一段', '2025-01-01', NULL), ('a1', 'legacy', 'assistant', '旧回复', '2025-01-02', NULL);
  `);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { state.db?.close(); vi.restoreAllMocks(); });
describe("/api/threads 版本隔离多会话", () => {
  it("同一本书不同版本隔离，旧会话及消息数量保留", async () => {
    const response = await get(); const body = await response.json();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0]).toMatchObject({ id: "legacy", editionId: "e1", title: "原来的选区", messageCount: 2 });
    expect(state.db!.prepare("SELECT title FROM reading_threads WHERE id='legacy'").get()).toMatchObject({ title: null });
  });
  it("同一版本可创建多个独立会话，不重用整书单一 thread", async () => {
    const one = await post({ editionId: "e1", title: "第一会话" });
    const two = await post({ editionId: "e1", title: "第二会话" });
    expect(one.status).toBe(201); expect(two.status).toBe(201);
    const a = (await one.json()).thread; const b = (await two.json()).thread;
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ bookId: "same-book", editionId: "e1", title: "第一会话", messageCount: 0 });
    expect((await (await get()).json()).threads).toHaveLength(3);
  });
  it("客户端固定 threadId 的创建重试幂等，不能覆盖已命名会话", async () => {
    await post({ editionId: "e1", title: "原名", threadId: "client-id" });
    const again = await post({ editionId: "e1", title: "不覆盖", threadId: "client-id" });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ created: false, thread: { id: "client-id", title: "原名" } });
    expect((await (await get()).json()).threads).toHaveLength(2);
    expect((await post({ editionId: "e2", threadId: "client-id" })).status).toBe(409);
  });
  it("GET 和 POST 对版本、重复查询字段、未知字段严格校验", async () => {
    for (const query of ["", "editionId=e1&editionId=e2", "editionId=e1&bookId=same-book"]) expect((await get(query)).status).toBe(400);
    expect((await get("editionId=unknown")).status).toBe(404);
    expect((await post({ editionId: "unknown" })).status).toBe(404);
    for (const body of [{}, { editionId: "e1", title: " " }, { editionId: "e1", bookId: "spoof" }, []]) expect((await post(body)).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/threads", { method: "POST", body: "{" }))).status).toBe(400);
  });
  it("迁移占位名从首次问题/选文派生，首轮结束刷新列表立即可辨识", async () => {
    state.db!.prepare("UPDATE reading_threads SET title = '新会话' WHERE id='legacy'").run();
    expect((await (await get()).json()).threads[0].title).toBe("原来的选区");
    await post({ editionId: "e1", threadId: "fresh" });
    state.db!.prepare("INSERT INTO chat_messages VALUES (?,?,?,?,?,?)").run("fresh-u", "fresh", "user", "请句读这一段", "2025-03-01", null);
    state.db!.prepare("INSERT INTO chat_messages VALUES (?,?,?,?,?,?)").run("fresh-a", "fresh", "assistant", "正常回答", "2025-03-02", JSON.stringify({ outputFormat: "text", _request: { input: { selectedText: "首次消息里的自我意识选文" } } }));
    state.db!.prepare("UPDATE reading_threads SET selected_text = ? WHERE id='fresh'").run("线程后续的选区不能替代首次选文");
    let list = (await (await get()).json()).threads as { id: string; title: string }[];
    expect(list.find(item => item.id === "fresh")?.title).toBe("首次消息里的自我意识选文");
    state.db!.prepare("UPDATE chat_messages SET content = ? WHERE id='fresh-u'").run("承认的双重性是什么？");
    list = (await (await get()).json()).threads;
    expect(list.find(item => item.id === "fresh")?.title).toBe("承认的双重性是什么？");
    state.db!.prepare("UPDATE reading_threads SET title = '用户自定义标题' WHERE id='fresh'").run();
    list = (await (await get()).json()).threads;
    expect(list.find(item => item.id === "fresh")?.title).toBe("用户自定义标题");
  });
  it("数据库异常返回明确 500，不泄露内部错误", async () => {
    vi.spyOn(state.db!, "prepare").mockImplementation(() => { throw new Error("internal-db-secret"); });
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("internal-db-secret");
    expect(console.error).toHaveBeenCalled();
  });
});
