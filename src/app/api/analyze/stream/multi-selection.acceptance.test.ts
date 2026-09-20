import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "@/lib/db";
import type { ReadingAnchor, ReadingAnchorPart } from "@/lib/reading-anchors";
import { restoreReadingRequest } from "@/lib/reading-request";

type Db = ReturnType<typeof getDb>;
const fixture = vi.hoisted(() => ({ db: undefined as Db | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => {
  if (!fixture.db) throw new Error("验收数据库未初始化；禁止访问正式 data");
  return fixture.db;
} }));
import { POST } from "./route";

const runtime = (process as unknown as {
  getBuiltinModule(name: string): { DatabaseSync: new (file: string) => Db };
}).getBuiltinModule("node:sqlite");
const fetcher = vi.fn<typeof fetch>();
const responses: (() => Response)[] = [];
const encoder = new TextEncoder();
const analysis = { readingText: "连续选文需要结合上下文理解。", summary: "", breakdown: [], concepts: [], context: "", uncertainty: "", citations: [] };
const sourceRows = [
  ["p1", "chapter-1", "第一段正文用于验收多段句读完整来源。", 0],
  ["p2", "chapter-1", "第二段正文应完整包含在这次选择中。", 1],
  ["p3", "chapter-2", "第三段属于下一章且末尾允许局部选择。", 0],
  ["p4", "chapter-2", "第四段不能跳过中间段直接连接。", 1],
  ["other-edition", "chapter-other-edition", "第二段正文应完整包含在这次选择中。", 0],
  ["other-book", "chapter-other-book", "第二段正文应完整包含在这次选择中。", 0],
] as const;
type MessageRow = { id: string; role: string; content: string; status: string; structured_output: string };
type Saved = {
  anchor?: ReadingAnchor;
  _request: { attemptId: string; fingerprint: string; input: Record<string, unknown>; failure?: { code: string } };
};
function db(): Db { if (!fixture.db) throw new Error("缺少验收数据库"); return fixture.db; }
function part(id: string, startOffset = 0, endOffset?: number): ReadingAnchorPart {
  const row = db().prepare("SELECT text FROM paragraphs WHERE id=?").get(id) as { text: string };
  const end = endOffset ?? row.text.length;
  return { paragraphId: id, startOffset, endOffset: end, selectedText: row.text.slice(startOffset, end) };
}
const selection = () => [part("p1", 2), part("p2"), part("p3", 0, 8)];
function body(parts = selection()): Record<string, unknown> {
  return {
    threadId: "multi-thread", clientUserMessageId: "multi-user", clientAssistantMessageId: "multi-assistant",
    mode: "analyze", question: "请句读这些连续正文", editionId: "edition-1", bookId: "book-1", chapterId: "chapter-1",
    paragraphId: parts[0].paragraphId, selectionStart: parts[0].startOffset, selectionEnd: parts[0].endOffset,
    selectionAnchors: parts, selectedText: parts.map(value => value.selectedText).join("\n\n"),
  };
}
function expectedInput() {
  return Object.fromEntries(Object.entries(body()).filter(([key]) =>
    !["threadId", "clientUserMessageId", "clientAssistantMessageId"].includes(key)));
}
function expectedAnchor(parts = selection()): ReadingAnchor {
  return { ...parts[0], version: 2, fragments: parts };
}
async function call(overrides: Record<string, unknown> = {}) {
  const response = await POST(new NextRequest("http://localhost/api/analyze/stream", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body(), ...overrides }),
  }));
  return { status: response.status, text: await response.text(), headers: response.headers };
}
function row(): MessageRow { return db().prepare("SELECT * FROM chat_messages WHERE id='multi-assistant'").get() as MessageRow; }
function saved(): Saved { return JSON.parse(row().structured_output) as Saved; }
function restore() {
  const message = row();
  const result = restoreReadingRequest("multi-thread", { ...message, structuredOutput: message.structured_output });
  if (!result) throw new Error("历史消息未能恢复");
  return result;
}
function count(table: "chat_messages" | "reading_threads" | "agent_tool_runs") {
  return (db().prepare("SELECT count(*) AS count FROM " + table).get() as { count: number }).count;
}
const block = (data: unknown) => "data: " + (typeof data === "string" ? data : JSON.stringify(data)) + "\n\n";
function upstream(...chunks: string[]) {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
}
function textResponse() {
  return upstream(block({ id: "controlled-text", choices: [{ index: 0, delta: { role: "assistant", content: analysis.readingText }, finish_reason: null }] }),
    block({ id: "controlled-text", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }), block("[DONE]"));
}
function toolResponse() {
  return upstream(block({ id: "controlled-tool", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "save-multi", type: "function", function: { name: "save_reading_analysis", arguments: JSON.stringify(analysis) } }] }, finish_reason: "tool_calls" }] }), block("[DONE]"));
}
const enqueueSuccess = () => responses.push(toolResponse, textResponse);
function structuredResults(wire: string): unknown[] {
  return wire.split("\n\n").filter(value => value.startsWith("event: structured\n")).map(value => {
    const data = JSON.parse(value.slice(value.indexOf("data: ") + 6)) as { result: unknown };
    return data.result;
  });
}
function assertAnchorInWire(wire: string, parts = selection()) {
  const results = structuredResults(wire);
  expect(results.length).toBeGreaterThan(0);
  for (const result of results) expect(result).toMatchObject({ anchor: expectedAnchor(parts) });
}
async function assertRejected(overrides: Record<string, unknown>, status: number, code: string) {
  const result = await call(overrides);
  expect(result.status).toBe(status);
  expect(JSON.parse(result.text)).toMatchObject({ code, retryable: false });
  expect(fetcher).not.toHaveBeenCalled();
  expect(count("chat_messages")).toBe(0);
  expect(count("reading_threads")).toBe(0);
  expect(count("agent_tool_runs")).toBe(0);
  return result;
}

beforeEach(() => {
  // WHY：真实 SQLite + 真实 Agent/工具链，只隔离数据库和模型 HTTP 传输；不伪造产品持久化结果。
  fixture.db = new runtime.DatabaseSync(":memory:");
  db().exec(`
    CREATE TABLE books (id TEXT PRIMARY KEY);
    CREATE TABLE editions (id TEXT PRIMARY KEY, book_id TEXT NOT NULL);
    CREATE TABLE chapters (id TEXT PRIMARY KEY, edition_id TEXT NOT NULL, title TEXT, order_index INTEGER);
    CREATE TABLE paragraphs (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, text TEXT, order_index INTEGER);
    INSERT INTO books VALUES ('book-1'),('book-2');
    INSERT INTO editions VALUES ('edition-1','book-1'),('edition-2','book-1'),('edition-3','book-2');
    INSERT INTO chapters VALUES ('chapter-1','edition-1','首章',0),('chapter-2','edition-1','次章',1),
      ('chapter-other-edition','edition-2','另一版',0),('chapter-other-book','edition-3','另一本',0);
    CREATE TABLE ai_provider_configs (id TEXT PRIMARY KEY, provider TEXT, base_url TEXT, api_key TEXT, model TEXT);
    INSERT INTO ai_provider_configs VALUES ('default','openai','https://controlled-provider.test','fixture-not-a-secret','controlled-model');
    CREATE TABLE reading_threads (id TEXT PRIMARY KEY, book_id TEXT, edition_id TEXT NOT NULL, chapter_id TEXT, paragraph_id TEXT, selected_text TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE chat_messages (id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, content TEXT NOT NULL, raw_content TEXT, structured_output TEXT, status TEXT, model_name TEXT, prompt_version TEXT, created_at TEXT, usage_json TEXT);
    CREATE TABLE agent_tool_runs (id TEXT PRIMARY KEY, message_id TEXT, thread_id TEXT, attempt_id TEXT, tool_name TEXT, input_json TEXT, output_json TEXT, status TEXT, created_at TEXT);
    CREATE TABLE context_snapshots (id TEXT PRIMARY KEY, thread_id TEXT, book_id TEXT, edition_id TEXT, summary TEXT, recent_messages TEXT, token_count INTEGER, version INTEGER, created_at TEXT, checkpoint_json TEXT);
  `);
  for (const source of sourceRows) db().prepare("INSERT INTO paragraphs VALUES (?,?,?,?)").run(...source);
  responses.length = 0;
  fetcher.mockReset().mockImplementation(async (url) => {
    // WHY：所有模型流均由本测试预排；任何意外地址/额外调用直接失败，永不退回真实网络。
    expect(String(url)).toBe("https://controlled-provider.test/chat/completions");
    const next = responses.shift();
    if (!next) throw new Error("受控模型没有配置这次调用");
    return next();
  });
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks(); fixture.db?.close(); fixture.db = undefined;
});

describe("多段流式句读独立后端验收：字数与来源校验", () => {
  it("全选区 1001 字拒绝且不调用模型、不建会话、不分段执行", async () => {
    db().prepare("UPDATE paragraphs SET text=? WHERE id='p1'").run("甲".repeat(499));
    db().prepare("UPDATE paragraphs SET text=? WHERE id='p2'").run("乙".repeat(500));
    const payload = body([part("p1"), part("p2")]);
    expect(Array.from(String(payload.selectedText)).length).toBe(1001);
    const result = await assertRejected(payload, 400, "selection_length");
    expect(JSON.parse(result.text).error).toContain("1001");
  });
  it("旧单段请求同样不能绕过 1001 字上限", async () => {
    await assertRejected({ selectedText: "甲".repeat(1001), selectionAnchors: undefined }, 400, "selection_length");
  });
  it.each([999, 1000])("允许全选区恰好 %i 字（含分隔符），完整保存不截断", async length => {
    db().prepare("UPDATE paragraphs SET text=? WHERE id='p1'").run("甲".repeat(499));
    db().prepare("UPDATE paragraphs SET text=? WHERE id='p2'").run("乙".repeat(length - 501));
    const parts = [part("p1"), part("p2")];
    enqueueSuccess();
    const result = await call(body(parts));
    expect(result.status).toBe(200);
    expect(result.text).toContain("event: done");
    expect(row().status).toBe("completed");
    expect(saved().anchor).toEqual(expectedAnchor(parts));
    expect(saved()._request.input.selectedText).toHaveLength(length);
  });
  it.each([1000, 1001])("%i 个 Unicode 字符按字数校验，emoji 位置仍按 UTF-16", async length => {
    db().prepare("UPDATE paragraphs SET text=? WHERE id='p1'").run("😀".repeat(499));
    db().prepare("UPDATE paragraphs SET text=? WHERE id='p2'").run("𠮷".repeat(length - 501));
    const parts = [part("p1"), part("p2")], payload = body(parts);
    expect(Array.from(String(payload.selectedText))).toHaveLength(length);
    expect(String(payload.selectedText).length).toBeGreaterThan(1000);
    if (length > 1000) await assertRejected(payload, 400, "selection_length");
    else {
      enqueueSuccess();
      const result = await call(payload);
      expect(result.text).toContain("event: done");
      expect(saved().anchor).toEqual(expectedAnchor(parts));
      expect(saved().anchor?.fragments?.[0].endOffset).toBe(998);
    }
  });
  it.each([null, [], [{ paragraphId: "p1" }]])("拒绝非法片段格式 %j", async selectionAnchors => {
    await assertRejected({ selectionAnchors }, 400, "invalid_selection");
  });
  it("拒绝过多片段且不调用模型", async () => {
    await assertRejected({ selectionAnchors: Array.from({ length: 257 }, () => part("p1")) }, 400, "invalid_selection");
  });
  it.each([
    ["跳段", () => body([part("p1"), part("p3")])],
    ["乱序", () => body([part("p2"), part("p1")])],
    ["重复", () => body([part("p1"), part("p1")])],
    ["重叠", () => body([part("p1", 1), part("p1", 0, 10)])],
    ["跨版本", () => body([part("p1"), part("other-edition")])],
    ["跨书籍", () => body([part("p1"), part("other-book")])],
    ["首段末端缺字", () => body([part("p1", 0, 6), part("p2")])],
    ["末段开头缺字", () => body([part("p1"), part("p2", 1)])],
    ["顶层首段 ID", () => ({ paragraphId: "p2" })],
    ["顶层首段偏移", () => ({ selectionStart: 0 })],
    ["顶层选文", () => ({ selectedText: "顶层完全不对应这些段落的文字。" })],
    ["顶层书籍", () => ({ bookId: "book-2" })],
    ["顶层章节", () => ({ chapterId: "chapter-2" })],
    ["等长篡改原文", () => body([{ ...part("p1"), selectedText: "假" + part("p1").selectedText.slice(1) }, part("p2")])],
  ] satisfies [string, () => Record<string, unknown>][])("请求层拒绝%s，错误不污染消息或来源记录", async (_name, payload) => {
    await assertRejected(payload(), 409, "anchor_mismatch");
  });
  it("请求层拒绝截断 UTF-16 代理对，即使片段原文逐字匹配", async () => {
    db().prepare("UPDATE paragraphs SET text=? WHERE id='p1'").run("开😀随后这些正文足够用于句读。");
    await assertRejected(body([part("p1", 2)]), 409, "anchor_mismatch");
  });
});

describe("多段流式句读独立后端验收：保存、重放和重试", () => {
  it("跨章连续多段经过真实工具链保存 v2；数据库、SSE、审计记录均保留完整来源", async () => {
    enqueueSuccess();
    const result = await call();
    expect(result.status).toBe(200);
    expect(result.headers.get("Content-Type")).toContain("text/event-stream");
    expect(result.text).toContain("event: done");
    expect(row().status).toBe("completed");
    expect(fetcher).toHaveBeenCalledTimes(2);
    assertAnchorInWire(result.text);
    expect(saved().anchor).toEqual(expectedAnchor());
    expect(saved()._request.input).toMatchObject(expectedInput());
    const thread = db().prepare("SELECT * FROM reading_threads WHERE id='multi-thread'").get();
    expect(thread).toMatchObject({ paragraph_id: "p1", selected_text: body().selectedText, chapter_id: "chapter-1" });
    const audit = db().prepare("SELECT output_json FROM agent_tool_runs WHERE tool_name='save_reading_analysis'").get() as { output_json: string };
    expect(JSON.parse(audit.output_json)).toMatchObject({ ok: true, result: { anchor: expectedAnchor() } });
    const modelBody = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as { messages: { content: string }[] };
    expect(modelBody.messages.some(message => message.content.includes('"selectedText":' + JSON.stringify(body().selectedText)))).toBe(true);
    expect(count("chat_messages")).toBe(2);
  });
  it("成功请求幂等重放不调用模型，结构化事件及刷新恢复仍带全部片段", async () => {
    enqueueSuccess();
    await call();
    const before = saved(), storedBefore = row().structured_output;
    const replay = await call();
    expect(replay.status).toBe(200);
    expect(replay.text).toContain('"replayed":true');
    assertAnchorInWire(replay.text);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(row().structured_output).toBe(storedBefore);
    expect(saved()._request.attemptId).toBe(before._request.attemptId);
    expect(restore().payload).toMatchObject(body());
    expect(restore().analysis?.anchor).toEqual(expectedAnchor());
    expect(count("chat_messages")).toBe(2);
  });
  it("受控模型失败后从落库消息恢复并原位重试，完整来源和身份不丢失", async () => {
    responses.push(() => new Response(JSON.stringify({ error: { message: "受控失败", type: "invalid_request_error" } }), { status: 400, headers: { "Content-Type": "application/json" } }));
    const failed = await call();
    expect(failed.text).toContain("event: error");
    expect(row().status).toBe("error");
    const firstAttempt = saved()._request.attemptId, fingerprint = saved()._request.fingerprint;
    expect(saved()._request.input).toMatchObject(expectedInput());
    const restored = restore();
    expect(restored.payload).toMatchObject(body());
    enqueueSuccess();
    const retried = await call(restored.payload);
    expect(retried.text).toContain("event: done");
    expect(row().status).toBe("completed");
    expect(saved()._request.attemptId).not.toBe(firstAttempt);
    expect(saved()._request.fingerprint).toBe(fingerprint);
    expect(saved().anchor).toEqual(expectedAnchor());
    assertAnchorInWire(retried.text);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(count("chat_messages")).toBe(2);
    expect(count("reading_threads")).toBe(1);
    expect(restore().analysis?.anchor).toEqual(expectedAnchor());
  });
  it("重放或重试不得沿用旧 ID 偷换为另一组合法连续片段", async () => {
    enqueueSuccess();
    await call();
    const before = row().structured_output;
    const changed = body([part("p2", 2), part("p3", 0, 8)]);
    const result = await call(changed);
    expect(result.status).toBe(409);
    expect(JSON.parse(result.text)).toMatchObject({ code: "id_conflict" });
    expect(row().structured_output).toBe(before);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("兼容网关未调用保存工具时，自动保存及幂等重放也必须保留 v2 来源", async () => {
    responses.push(textResponse);
    const result = await call();
    expect(result.text).toContain("event: done");
    expect(row().status).toBe("completed");
    expect.soft(saved().anchor).toEqual(expectedAnchor());
    expect.soft(structuredResults(result.text)).toContainEqual(expect.objectContaining({ anchor: expectedAnchor() }));
    const replay = await call();
    expect(replay.text).toContain("event: done");
    expect.soft(structuredResults(replay.text)).toContainEqual(expect.objectContaining({ anchor: expectedAnchor() }));
    expect.soft(restore().analysis?.anchor).toEqual(expectedAnchor());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(count("chat_messages")).toBe(2);
  });
});

