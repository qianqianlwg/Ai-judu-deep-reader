import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyChatEvent, decodeChatEvent, type ChatMessage } from "../chat-stream";
import { applyReadingRequest, beginReadingRequest, createReadingRequest, executeReadingRequest } from "../reading-request";
import { SseDecoder } from "../sse";
import { assertCurrentToolAttempt, insertCurrentAttemptToolRun, readCurrentAttemptTools, readThreadToolHistory, toolReplayEvents, ToolAttemptNotActiveError, type ToolAttemptScope, type ToolAuditRun, type ToolHistoryDatabase } from "./tool-history";

type Db = ToolHistoryDatabase & { exec(sql: string): void; close(): void };
const sqlite = (process as unknown as { getBuiltinModule(name: string): { DatabaseSync: new (file: string) => Db } }).getBuiltinModule("node:sqlite");
let db: Db;
const scope: ToolAttemptScope = { threadId: "t1", messageId: "a1", editionId: "e1", attemptId: "attempt-1" };
const run: ToolAuditRun = { id: "call-1", name: "search_book", input: { query: "本书" }, output: { ok: true, sources: [{ sourceId: "book:e1:paragraph:p1", paragraphId: "p1", chapterId: "c1", chapterTitle: "第一章", text: "本版本原文" }] }, status: "completed" };
const setAttempt = (attemptId: string, status = "streaming") => db.prepare("UPDATE chat_messages SET structured_output = ?, status = ? WHERE id = 'a1'").get(JSON.stringify({ _request: { attemptId } }), status);
function legacy(id: string, attemptId: string | null, messageId = "a1", threadId = "t1") {
 db.prepare("INSERT INTO agent_tool_runs (id,message_id,thread_id,attempt_id,tool_name,input_json,output_json,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)").get(id, messageId, threadId, attemptId, run.name, JSON.stringify(run.input), JSON.stringify(run.output), run.status, "2026-01-01");
}
const count = () => (db.prepare("SELECT COUNT(*) AS count FROM agent_tool_runs").get() as { count: number }).count;
beforeEach(() => {
 db = new sqlite.DatabaseSync(":memory:");
 db.exec("CREATE TABLE reading_threads (id TEXT PRIMARY KEY, edition_id TEXT); CREATE TABLE chat_messages (id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, status TEXT, structured_output TEXT); CREATE TABLE agent_tool_runs (id TEXT PRIMARY KEY, message_id TEXT, thread_id TEXT, attempt_id TEXT, tool_name TEXT, input_json TEXT, output_json TEXT, status TEXT, created_at TEXT); INSERT INTO reading_threads VALUES ('t1','e1'),('t2','e2'); INSERT INTO chat_messages VALUES ('a1','t1','assistant','streaming','{}'),('u1','t1','user','streaming','{}'),('a2','t2','assistant','streaming','{}');");
 setAttempt(scope.attemptId);
});
afterEach(() => { db.close(); vi.restoreAllMocks(); });

describe("工具审计写入栅栏", () => {
 it("绑定 attempt、保留 provider tool_call_id，相同审计重复提交幂等", () => {
  expect(insertCurrentAttemptToolRun(db, scope, run)).toBe(true);
  expect(insertCurrentAttemptToolRun(db, scope, run)).toBe(false);
  expect(count()).toBe(1);
  expect(db.prepare("SELECT attempt_id FROM agent_tool_runs").get()).toEqual({ attempt_id: "attempt-1" });
  expect(readCurrentAttemptTools(db, scope)).toEqual([{ id: "call-1", name: run.name, status: "completed", result: run.output }]);
 });
 it("同一次调用不能覆盖成不同的输入、输出或状态", () => {
  insertCurrentAttemptToolRun(db, scope, run);
  for (const change of [{ input: { query: "改输入" } }, { output: { ok: false } }, { status: "error" as const }]) expect(() => insertCurrentAttemptToolRun(db, scope, { ...run, ...change })).toThrow("审计内容冲突");
  expect(count()).toBe(1);
  expect(readCurrentAttemptTools(db, scope)[0].result).toEqual(run.output);
 });
 it("新 attempt 复用同一 tool_call_id 不冲突，旧审计保留但不进入当前工具", () => {
  insertCurrentAttemptToolRun(db, scope, run);
  setAttempt("attempt-2");
  insertCurrentAttemptToolRun(db, { ...scope, attemptId: "attempt-2" }, { ...run, name: "read_source" });
  const history = readThreadToolHistory(db, scope).get("a1")!;
  expect(history.tools).toHaveLength(1);
  expect(history.tools[0]).toMatchObject({ id: "call-1", name: "read_source" });
  expect(history.historicalTools).toHaveLength(1);
  expect(history.historicalTools[0]).toMatchObject({ id: "call-1", name: "search_book", attemptId: "attempt-1" });
  expect(count()).toBe(2);
 });
 it("取消后的迟到审计拒绝写入，不删除已完成的旧审计", async () => {
  const controller = new AbortController();
  insertCurrentAttemptToolRun(db, scope, run, controller.signal);
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const audit = pending.then(() => insertCurrentAttemptToolRun(db, scope, { ...run, id: "late" }, controller.signal));
  controller.abort(); finish();
  await expect(audit).rejects.toMatchObject({ name: "AbortError" });
  expect(count()).toBe(1);
 });
 it("旧工具 await 完成时请求已被重试替换，即使旧 signal 未 abort 也不能写", async () => {
  assertCurrentToolAttempt(db, scope);
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const audit = pending.then(() => insertCurrentAttemptToolRun(db, scope, run));
  setAttempt("attempt-2"); finish();
  await expect(audit).rejects.toBeInstanceOf(ToolAttemptNotActiveError);
  expect(count()).toBe(0);
 });
 it("即便状态在准备 INSERT 前变化，单条 SQL 的条件仍挡住写入", () => {
  const guarded: ToolHistoryDatabase = { prepare(sql) { if (sql.startsWith("INSERT")) setAttempt("newer"); return db.prepare(sql); } };
  expect(() => insertCurrentAttemptToolRun(guarded, scope, run)).toThrow(ToolAttemptNotActiveError);
  expect(count()).toBe(0);
 });
 it.each(["error", "completed"])("消息 %s 后禁止迟到写入", status => {
  setAttempt(scope.attemptId, status);
  expect(() => insertCurrentAttemptToolRun(db, scope, run)).toThrow(ToolAttemptNotActiveError);
  expect(count()).toBe(0);
 });
 it("版本、线程、用户角色、缺失与损坏的元数据全部 fail closed", () => {
  for (const change of [{ editionId: "e2" }, { threadId: "t2" }, { messageId: "u1" }, { messageId: "missing" }]) expect(() => insertCurrentAttemptToolRun(db, { ...scope, ...change }, run)).toThrow(ToolAttemptNotActiveError);
  for (const value of [null, "{broken", "{}", '{"_request":{"attemptId":null}}']) {
   db.prepare("UPDATE chat_messages SET structured_output = ? WHERE id = 'a1'").get(value);
   expect(() => insertCurrentAttemptToolRun(db, scope, run)).toThrow(ToolAttemptNotActiveError);
  }
  expect(count()).toBe(0);
 });
});
describe("当前尝试与历史尝试读取", () => {
 it("原 SQL 跨 attempt 复现：现在仅当前归本轮，old 和 NULL 单独展示", () => {
  legacy("old-tool", "attempt-0"); legacy("unassigned-tool", null); legacy("current-tool", "attempt-1");
  const history = readThreadToolHistory(db, scope).get("a1")!;
  expect(history.tools.map(tool => tool.id)).toEqual(["current-tool"]);
  expect(history.historicalTools.map(tool => [tool.id, tool.attemptId])).toEqual([["old-tool", "attempt-0"], ["unassigned-tool", null]]);
  expect(count()).toBe(3);
 });
 it("旧消息无 attempt 或 JSON 损坏时，不擅自把任意记录归为当前", () => {
  legacy("known", "attempt-1"); legacy("unknown", null);
  for (const value of [null, "{broken", "{}", '{"_request":{"attemptId":""}}']) {
   db.prepare("UPDATE chat_messages SET structured_output = ? WHERE id = 'a1'").get(value);
   expect(readCurrentAttemptTools(db, scope)).toEqual([]);
   expect(readThreadToolHistory(db, scope).get("a1")?.historicalTools).toHaveLength(2);
  }
 });
 it("所有尝试都按真实版本、线程和助手角色隔离，SQL 不读取 input_json", () => {
  legacy("valid", "attempt-1"); legacy("other-thread", "attempt-1", "a2", "t2"); legacy("mismatch", "attempt-1", "a2", "t1"); legacy("user", "attempt-1", "u1");
  const prepare = vi.spyOn(db, "prepare");
  expect(readCurrentAttemptTools(db, scope).map(tool => tool.id)).toEqual(["valid"]);
  expect(readCurrentAttemptTools(db, { ...scope, editionId: "e2" })).toEqual([]);
  expect(readCurrentAttemptTools(db, { ...scope, messageId: "a2" })).toEqual([]);
  expect(prepare.mock.calls.every(([sql]) => !sql.includes("input_json"))).toBe(true);
 });
 it("当前和历史工具输出使用相同白名单及来源边界，不泄露内部信息", () => {
  const output = { ok: true, apiKey: "output-secret", sources: [{ sourceId: "book:e2:paragraph:foreign", paragraphId: "foreign", text: "foreign-text" }, ...(run.output as { sources: unknown[] }).sources] };
  insertCurrentAttemptToolRun(db, scope, { ...run, input: { key: "input-secret" }, output });
  setAttempt("attempt-2");
  const result = JSON.stringify(readThreadToolHistory(db, scope).get("a1"));
  for (const text of ["input-secret", "output-secret", "foreign-text"]) expect(result).not.toContain(text);
  expect(result).toContain("本版本原文");
 });
});
describe("幂等回放", () => {
 it("从数据库当前 attempt 回放完成与失败工具，并复用流中的 call ID", () => {
  legacy("old", "older"); legacy("null", null);
  insertCurrentAttemptToolRun(db, scope, run);
  insertCurrentAttemptToolRun(db, scope, { ...run, id: "failed", status: "error", output: { ok: false, error: "internal-secret" } });
  setAttempt("attempt-1", "completed");
  const events = toolReplayEvents(db, scope);
  expect(events.map(event => [event.tool.id, event.tool.status])).toEqual([["call-1", "completed"], ["failed", "error"]]);
  expect(JSON.stringify(events)).not.toContain("internal-secret");
  const decoder = new SseDecoder();
  const frames = events.map(event => "event: tool\ndata: " + JSON.stringify({ tool: event.tool }) + "\n\n").join("");
  let messages: ChatMessage[] = [{ id: "u1", role: "user", content: "请句读这一段" }, { id: "a1", role: "assistant", content: "自然语言正文", outputFormat: "text", tools: [{ id: "call-1", name: run.name, status: "running" }] }];
  for (const frame of decoder.push(new TextEncoder().encode(frames + frames))) messages = applyChatEvent(messages, "a1", decodeChatEvent(frame)!);
  expect(messages).toHaveLength(2);
  expect(messages[1].content).toBe("自然语言正文");
  expect(messages[1].tools).toHaveLength(2);
  expect(messages[1].tools?.every(tool => tool.status !== "running")).toBe(true);
 });
 it("没有当前 attempt 的旧记录不会伪装成回放工具卡", () => {
  legacy("unassigned", null);
  expect(toolReplayEvents(db, scope)).toEqual([]);
  expect(toolReplayEvents(db, { ...scope, editionId: "other" })).toEqual([]);
 });
});


it("同一个 provider call ID 在另一条消息可复用，不改变既有审计", () => {
 insertCurrentAttemptToolRun(db, scope, run);
 db.prepare("INSERT INTO chat_messages VALUES ('a3','t1','assistant','streaming',?)").get(JSON.stringify({ _request: { attemptId: scope.attemptId } }));
 insertCurrentAttemptToolRun(db, { ...scope, messageId: "a3" }, run);
 expect(count()).toBe(2);
 expect(readCurrentAttemptTools(db, scope)).toHaveLength(1);
 expect(readCurrentAttemptTools(db, { ...scope, messageId: "a3" })).toHaveLength(1);
});

it("审计序列化期间取消也不能随后落库", () => {
 const controller = new AbortController();
 const input = { toJSON() { controller.abort(); return {}; } };
 expect(() => insertCurrentAttemptToolRun(db, scope, { ...run, input }, controller.signal)).toThrow();
 expect(count()).toBe(0);
});

it("服务端已成功但客户端漏收 done：原 ID 重试通过真实执行器恢复正文与当前工具", async () => {
 legacy("old-tool", "old-attempt");
 insertCurrentAttemptToolRun(db, scope, run);
 setAttempt(scope.attemptId, "completed");
 const ids = ["u1", "a1"];
 const request = createReadingRequest({ mode: "chat", question: "继续解释", selectedText: "", threadId: "t1", editionId: "e1" }, () => ids.shift()!);
 const failed = { ...request, status: "error" as const, content: "半截回复", tools: [{ id: "old-tool", name: "search_book", status: "error" as const }] };
 let messages = applyReadingRequest([], failed);
 const user = messages[0];
 const next = beginReadingRequest(failed, messages);
 messages = next.messages;
 const frame = (event: string, payload: unknown) => "event: " + event + "\ndata: " + JSON.stringify(payload) + "\n\n";
 const sse = frame("meta", { threadId: "t1", messageId: "a1", outputFormat: "text", replayed: true })
  + frame("raw_delta", { text: "完整的自然语言回复" })
  + toolReplayEvents(db, scope).map(({ type, ...payload }) => frame(type, payload)).join("")
  + frame("done", { content: "完整的自然语言回复" });
 const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(sse, { headers: { "Content-Type": "text/event-stream" } }));
 const result = await executeReadingRequest(next.state, { fetcher, onState(state) { messages = applyReadingRequest(messages, state); } });
 expect(result.status).toBe("completed");
 expect(messages.map(message => message.id)).toEqual(["u1", "a1"]);
 expect(messages[0]).toBe(user);
 expect(messages[1]).toMatchObject({ content: "完整的自然语言回复", outputFormat: "text", tools: [{ id: "call-1", name: "search_book", status: "completed" }] });
 expect(messages[1].tools).toHaveLength(1);
 const sent = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
 expect(sent).toMatchObject({ clientUserMessageId: "u1", clientAssistantMessageId: "a1", question: "继续解释" });
});
