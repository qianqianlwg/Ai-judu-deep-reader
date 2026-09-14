import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "@/lib/db";
type Db = ReturnType<typeof getDb> & { close(): void };
const state = vi.hoisted(() => ({ db: undefined as Db | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
import { GET, PATCH } from "./route";
const runtime = (process as unknown as { getBuiltinModule(name: string): { DatabaseSync: new (file: string) => Db } }).getBuiltinModule("node:sqlite");
const context = (threadId = "t1") => ({ params: Promise.resolve({ threadId }) });
const get = (query = "editionId=e1", threadId = "t1") => GET(new Request("http://localhost/api/threads/" + threadId + "?" + query), context(threadId));
const patch = (body: unknown, threadId = "t1") => PATCH(new Request("http://localhost/api/threads/" + threadId, { method: "PATCH", body: JSON.stringify(body) }), context(threadId));
beforeEach(() => {
  state.db = new runtime.DatabaseSync(":memory:");
  state.db.exec(String.raw`
    CREATE TABLE reading_threads (id TEXT PRIMARY KEY, book_id TEXT, edition_id TEXT, title TEXT, chapter_id TEXT, paragraph_id TEXT, selected_text TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE agent_tool_runs (id TEXT PRIMARY KEY, message_id TEXT, thread_id TEXT, tool_name TEXT, input_json TEXT, output_json TEXT, status TEXT, created_at TEXT, attempt_id TEXT);
    CREATE TABLE chat_messages (id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, content TEXT, raw_content TEXT, structured_output TEXT, usage_json TEXT, status TEXT, model_name TEXT, prompt_version TEXT, created_at TEXT);
    INSERT INTO reading_threads VALUES ('t1','same-book','e1',NULL,'c1','p1','原选区','2025-01-01','2025-01-01'), ('t2','same-book','e1','同书另一会话',NULL,NULL,NULL,'2025-01-01','2025-01-01'), ('t3','same-book','e2','另一版本',NULL,NULL,NULL,'2025-01-01','2025-01-01');
    INSERT INTO chat_messages VALUES ('u1','t1','user','请句读这一段','请句读这一段',NULL,NULL,'completed','model-a','v5','2025-01-01T00:00:00Z'), ('a1','t1','assistant','半截内容','半截内容','{"_request":{"version":1,"attemptId":"attempt-current"}}','{"inputTokens":7,"source":"provider"}','error','model-a','v5','2025-01-01T00:00:01Z'), ('other','t2','assistant','不能混入',NULL,NULL,NULL,'completed','model-b','v5','2025-01-01');
  `);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { state.db?.close(); vi.restoreAllMocks(); });
describe("会话历史与重命名", () => {
  it("原 ID、顺序、选区、失败状态和 usageJson 均保留，不混入同书其他会话", async () => {
    const response = await get(); const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.thread).toMatchObject({ id: "t1", title: "原选区", editionId: "e1", paragraphId: "p1", selectedText: "原选区" });
    expect(body.messages.map((item: { id: string }) => item.id)).toEqual(["u1", "a1"]);
    expect(body.messages[1]).toMatchObject({ content: "半截内容", status: "error", structuredOutput: '{"_request":{"version":1,"attemptId":"attempt-current"}}', usageJson: '{"inputTokens":7,"source":"provider"}' });
    expect(JSON.stringify(body)).not.toContain("不能混入");
  });
  it("版本不符必须 404，缺版本或重复参数必须 400", async () => {
    expect((await get("editionId=e2")).status).toBe(404);
    expect((await get("editionId=e1", "missing")).status).toBe(404);
    for (const query of ["", "editionId=e1&editionId=e2", "editionId=e1&all=true"]) expect((await get(query)).status).toBe(400);
    expect((await get("editionId=e1", "../bad")).status).toBe(400);
  });
  it("重命名只修改范围内标题，不改会话 ID、消息、选区或另一会话", async () => {
    const original = (await (await get()).json()).messages;
    const response = await patch({ editionId: "e1", title: "  关于承认的追问  " });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ thread: { id: "t1", editionId: "e1", title: "关于承认的追问", messageCount: 2 } });
    const result = await (await get()).json();
    expect(result.messages).toEqual(original);
    expect(result.thread.selectedText).toBe("原选区");
    expect(state.db!.prepare("SELECT title FROM reading_threads WHERE id='t2'").get()).toMatchObject({ title: "同书另一会话" });
  });
  it("不能跨版本重命名，也不能通过 payload 换版本或改消息", async () => {
    expect((await patch({ editionId: "e2", title: "越权" })).status).toBe(404);
    for (const value of [{ title: "无版本" }, { editionId: "e1", title: " " }, { editionId: "e1", title: "字".repeat(81) }, { editionId: "e1", title: "名称", messages: [] }]) expect((await patch(value)).status).toBe(400);
    expect((await (await get()).json()).thread.title).toBe("原选区");
  });
  it("刷新恢复当前 assistant 的工具卡，不读 input_json，不混入其他线程/版本/用户消息", async () => {
    const insert = state.db!.prepare("INSERT INTO agent_tool_runs (id,message_id,thread_id,tool_name,input_json,output_json,status,created_at,attempt_id) VALUES (?,?,?,?,?,?,?,?,'attempt-current')");
    const output = { ok: true, sources: [{ sourceId: "book:e1:paragraph:p1", paragraphId: "p1", chapterId: "c1", chapterTitle: "本章", text: "本版本检索摘录", apiKey: "nested-secret" }, { sourceId: "book:e2:paragraph:foreign", paragraphId: "foreign", text: "另一个版本的内容" }], input: "hidden-input", debug: "private-debug" };
    insert.run("audit-1", "a1", "t1", "search_book", '{"query":"tool-input-secret"}', JSON.stringify(output), "completed", "2025-01-01");
    insert.run("audit-other", "other", "t2", "read_source", "{}", '{"ok":true,"sources":[]}', "completed", "2025-01-01");
    insert.run("audit-mismatch", "other", "t1", "read_source", "{}", '{"ok":true,"sources":[]}', "completed", "2025-01-01");
    insert.run("audit-user", "u1", "t1", "read_source", "{}", '{"ok":true,"sources":[]}', "completed", "2025-01-01");
    const prepare = vi.spyOn(state.db!, "prepare");
    const body = await (await get()).json();
    expect(body.messages[0].tools).toEqual([]);
    expect(body.messages[1].tools).toHaveLength(1);
    expect(body.messages[1].tools[0]).toMatchObject({ id: "audit-1", name: "search_book", status: "completed", result: { ok: true, displayLimited: true, sources: [{ sourceId: "book:e1:paragraph:p1", paragraphId: "p1", text: "本版本检索摘录" }] } });
    for (const secret of ["tool-input-secret", "nested-secret", "hidden-input", "private-debug", "另一个版本的内容", "audit-other", "audit-mismatch", "audit-user"]) expect(JSON.stringify(body)).not.toContain(secret);
    expect(prepare.mock.calls.some(([sql]) => sql.startsWith("SELECT") && sql.includes("input_json"))).toBe(false);
  });
  it("损坏/过大/错误输出不使历史读取失败，也不下发内部异常", async () => {
    const insert = state.db!.prepare("INSERT INTO agent_tool_runs (id,message_id,thread_id,tool_name,input_json,output_json,status,created_at,attempt_id) VALUES (?,?,?,?,?,?,?,?,'attempt-current')");
    insert.run("broken", "a1", "t1", "search_book", "{}", "{raw-secret", "completed", "2025-01-01");
    insert.run("too-big", "a1", "t1", "read_source", "{}", JSON.stringify({ text: "大".repeat(125000) }), "completed", "2025-01-02");
    insert.run("error", "a1", "t1", "save_reading_analysis", "{}", '{"ok":false,"error":"Authorization: error-secret"}', "error", "2025-01-03");
    const response = await get(); const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.messages[1].tools).toHaveLength(3);
    expect(body.messages[1].tools[0].result.message).toContain("损坏");
    expect(body.messages[1].tools[1].result.message).toContain("过大");
    expect(body.messages[1].tools[2].result).toMatchObject({ ok: false });
    expect(JSON.stringify(body)).not.toContain("raw-secret");
    expect(JSON.stringify(body)).not.toContain("error-secret");
    expect(JSON.stringify(body).length).toBeLessThan(20000);
    expect(console.warn).toHaveBeenCalled();
  });
  it("非法 JSON 与数据库异常有明确反馈", async () => {
    expect((await PATCH(new Request("http://localhost/api/threads/t1", { method: "PATCH", body: "{" }), context())).status).toBe(400);
    vi.spyOn(state.db!, "prepare").mockImplementation(() => { throw new Error("database detail"); });
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("database detail");
    expect(console.error).toHaveBeenCalled();
  });
  it("同一消息跨尝试工具和 NULL 旧审计不会混入当前，全部无损保留", async () => {
    const insert = state.db!.prepare("INSERT INTO agent_tool_runs (id,message_id,thread_id,tool_name,input_json,output_json,status,created_at,attempt_id) VALUES (?,'a1','t1','read_source','{}','{\"ok\":true,\"sources\":[]}','completed',?,?)");
    insert.run("old-tool", "2026-01-01", "attempt-old");
    insert.run("null-tool", "2026-01-02", null);
    insert.run("new-tool", "2026-01-03", "attempt-current");
    const body = await (await get()).json();
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1].content).toBe("半截内容");
    expect(body.messages[1].tools.map((tool: { id: string }) => tool.id)).toEqual(["new-tool"]);
    expect(body.messages[1].historicalTools.map((tool: { id: string; attemptId: string | null }) => [tool.id, tool.attemptId])).toEqual([["old-tool", "attempt-old"], ["null-tool", null]]);
    expect(state.db!.prepare("SELECT COUNT(*) AS count FROM agent_tool_runs").get()).toEqual({ count: 3 });
    expect((await get("editionId=e2")).status).toBe(404);
  });

});
