import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "@/lib/db";

type TestDb = ReturnType<typeof getDb> & { close(): void };
const fixture = vi.hoisted(() => ({ db: undefined as TestDb | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => { if (!fixture.db) throw new Error("测试数据库未初始化"); return fixture.db; } }));
import { POST } from "./route";
import * as retrievalModule from "@/lib/book-retrieval";
import { captureReadingContext, type ReadingContextSnapshot, applyReadingRequest, beginReadingRequest, createReadingRequest, executeReadingRequest, restoreReadingRequest } from "@/lib/reading-request";

const runtime = (process as unknown as { getBuiltinModule(name: string): { DatabaseSync: new (file: string) => TestDb } }).getBuiltinModule("node:sqlite");
const encoder = new TextEncoder();
const fetcher = vi.fn<typeof fetch>();
const payload = { threadId: "thread-1", clientUserMessageId: "user-1", clientAssistantMessageId: "assistant-1", editionId: "edition-1", chapterId: "chapter-1", paragraphId: "p1", mode: "chat", question: "测试", selectedText: "这是十字原文用来句读", selectionStart: 2, selectionEnd: 12 };
const analysis = { readingText: "原文啊", summary: "解释", breakdown: [], concepts: [], context: "上下文", uncertainty: "", citations: [] };
const block = (data: unknown, event?: string) => (event ? "event: " + event + "\n" : "") + "data: " + (typeof data === "string" ? data : JSON.stringify(data)) + "\n\n";
const delta = (content: string) => block({ id: "text-step", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] });
const done = () => block({ id: "text-step", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + block("[DONE]");
const toolResponse = (args: unknown = analysis, name = "save_reading_analysis") => upstream(block({ id: "tool-step", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call-save", type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }] }), block("[DONE]"));
function upstream(...chunks: string[]) { return new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } }), { headers: { "Content-Type": "text/event-stream" } }); }
function request(overrides: Record<string, unknown> = {}, signal?: AbortSignal) { return new NextRequest("http://localhost/api/analyze/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, ...overrides }), signal }); }
async function call(overrides: Record<string, unknown> = {}) { const response = await POST(request(overrides)); return { status: response.status, text: await response.text() }; }
function row(id = "assistant-1") { return fixture.db!.prepare("SELECT * FROM chat_messages WHERE id = ?").get(id) as { id: string; role: string; content: string; raw_content: string; structured_output: string; status: string; created_at: string }; }
const stored = () => JSON.parse(row().structured_output) as Record<string, unknown> & { _request: { failure?: { code: string; retryable: boolean }; attemptId: string; fingerprint: string; contextSnapshot?: ReadingContextSnapshot } };
const count = () => (fixture.db!.prepare("SELECT count(*) AS count FROM chat_messages").get() as { count: number }).count;
function setProvider(provider = "openai", key = "test-key") { fixture.db!.prepare("UPDATE ai_provider_configs SET provider = ?, api_key = ? WHERE id = 'default'").run(provider, key); }

beforeEach(() => {
  // WHY：使用真实内存 SQLite 执行事务和幂等 SQL；只替换上游传输，不访问外网、不启停服务。
  fixture.db = new runtime.DatabaseSync(":memory:");
  fixture.db.exec(String.raw`
    CREATE TABLE ai_provider_configs (id TEXT PRIMARY KEY, provider TEXT, base_url TEXT, api_key TEXT, model TEXT);
    INSERT INTO ai_provider_configs VALUES ('default', 'openai', 'https://provider.test', 'test-key', 'test-model');
    CREATE TABLE reading_threads (id TEXT PRIMARY KEY, book_id TEXT, edition_id TEXT NOT NULL, chapter_id TEXT, paragraph_id TEXT, selected_text TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE chat_messages (id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, content TEXT NOT NULL, raw_content TEXT, structured_output TEXT, status TEXT, model_name TEXT, prompt_version TEXT, created_at TEXT, usage_json TEXT);
    CREATE TABLE agent_tool_runs (id TEXT PRIMARY KEY, message_id TEXT, thread_id TEXT, attempt_id TEXT, tool_name TEXT, input_json TEXT, output_json TEXT, status TEXT, created_at TEXT);
    CREATE TABLE context_snapshots (id TEXT PRIMARY KEY, thread_id TEXT, book_id TEXT, edition_id TEXT, summary TEXT, recent_messages TEXT, token_count INTEGER, version INTEGER, created_at TEXT, checkpoint_json TEXT);
    CREATE TABLE chapters (id TEXT PRIMARY KEY, edition_id TEXT, title TEXT, order_index INTEGER);
    CREATE TABLE paragraphs (id TEXT PRIMARY KEY, chapter_id TEXT, text TEXT, order_index INTEGER);
    INSERT INTO chapters VALUES ('chapter-1', 'edition-1', '导论', 0), ('chapter-2', 'edition-2', '另一版', 0);
    INSERT INTO paragraphs VALUES ('p1', 'chapter-1', '前言这是十字原文用来句读后文', 0), ('p2', 'chapter-2', '前言这是十字原文用来句读后文', 0);
  `);
  fetcher.mockReset().mockImplementation(async () => upstream(delta("你好"), delta("，世界"), done()));
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); fixture.db?.close(); fixture.db = undefined; });

describe("流式 Provider 路由集成", () => {
  it("OpenAI 请求鉴权、真实增量、落库和 meta ID 一致", async () => {
    const response = await POST(request());
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain('event: raw_delta\ndata: {"text":"你好"}');
    expect(text).toContain('event: raw_delta\ndata: {"text":"，世界"}');
    expect(text).toContain('"messageId":"assistant-1","userMessageId":"user-1"');
    expect(text).toContain("event: done");
    expect(fetcher.mock.calls[0][0]).toBe("https://provider.test/chat/completions");
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer test-key");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ stream: true, model: "test-model" });
    expect(row()).toMatchObject({ content: "你好，世界", status: "completed" });
    expect(row("user-1")).toMatchObject({ role: "user", content: "测试" });
    expect(count()).toBe(2);
  });
  it("Claude system、鉴权、CRLF 分片与 message_stop", async () => {
    setProvider("claude");
    const wire = block({ type: "message_start", message: { id: "claude-test", role: "assistant", type: "message", model: "test-model", content: [], usage: { input_tokens: 10, output_tokens: 0 } } }, "message_start") + block({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, "content_block_start") + block({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "你好" } }, "content_block_delta") + block({ type: "content_block_stop", index: 0 }, "content_block_stop") + block({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }, "message_delta") + block({ type: "message_stop" }, "message_stop");
    const crlf = wire.replace(/\n/g, "\r\n");
    fetcher.mockResolvedValueOnce(upstream(...Array.from(crlf)));
    const result = await call();
    const init = fetcher.mock.calls[0][1];
    expect(fetcher.mock.calls[0][0]).toBe("https://provider.test/v1/messages");
    expect(new Headers(init?.headers).get("x-api-key")).toBe("test-key");
    expect(new Headers(init?.headers).get("anthropic-version")).toBe("2023-06-01");
    expect(JSON.parse(String(init?.body))).toMatchObject({ stream: true, system: [expect.objectContaining({ type: "text", text: expect.any(String) })], messages: [{ role: "user", content: expect.stringContaining("测试") }] });
    expect(result.text).toContain('event: raw_delta\ndata: {"text":"你好"}');
    expect(row()).toMatchObject({ content: "你好", status: "completed" });
  });
  it("未发出完成确认前，增量已可读取且助手状态为 streaming", async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    fetcher.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ start(controller) { source = controller; controller.enqueue(encoder.encode(delta("第一段"))); } })));
    const response = await POST(request());
    const reader = response.body!.getReader();
    let text = "";
    while (!text.includes("raw_delta")) text += new TextDecoder().decode((await reader.read()).value);
    expect(row()).toMatchObject({ status: "streaming", content: "第一段" });
    source.enqueue(encoder.encode(delta("第二段") + done())); source.close();
    while (true) { const next = await reader.read(); if (next.done) break; text += new TextDecoder().decode(next.value); }
    reader.releaseLock();
    expect(text).toContain("event: done");
    expect(row().content).toBe("第一段第二段");
  });
});

describe("服务端失败重试的原消息幂等闭环", () => {
  it("首条请求在 HTTP 失败前已保存两个客户端 ID，重试不新增消息", async () => {
    fetcher.mockResolvedValueOnce(new Response("故障", { status: 503 }));
    const failed = await call();
    expect(failed.text).toContain("event: error");
    expect(row().status).toBe("error");
    expect(stored()._request.failure).toMatchObject({ code: "upstream_failed", retryable: true });
    const createdAt = row().created_at;
    const firstAttempt = stored()._request.attemptId;
    const result = await call();
    expect(result.text).toContain("event: done");
    expect(count()).toBe(2);
    expect(row().created_at).toBe(createdAt);
    expect(row().status).toBe("completed");
    expect(stored()._request.attemptId).not.toBe(firstAttempt);
    expect(stored()._request.failure).toBeUndefined();
  });
  it("配置错误也保存可重试状态，补齐 key 后复用 ID", async () => {
    vi.stubEnv("AI_API_KEY", "");
    try {
      setProvider("openai", "");
      const failed = await call();
      expect(failed.status).toBe(503);
      expect(stored()._request.failure?.code).toBe("not_configured");
      expect(fetcher).not.toHaveBeenCalled();
      setProvider();
      expect((await call()).text).toContain("event: done");
      expect(count()).toBe(2);
    } finally { vi.unstubAllEnvs(); }
  });
  it("传输异常可重试", async () => {
    fetcher.mockRejectedValueOnce(new TypeError("connection lost"));
    expect((await call()).text).toContain("event: error");
    expect(row().status).toBe("error");
    expect((await call()).text).toContain("event: done");
    expect(count()).toBe(2);
  });
  it.each([
    ["空输出", [done()], "empty_output", ""],
    ["中途 EOF", [delta("半截")], "interrupted", "半截"],
    ["上游错误事件", [delta("半截"), block({ error: { message: "失败" } }, "error")], "upstream_failed", "半截"],
    ["OpenAI 内嵌错误", [delta("半截"), block({ error: { message: "失败" } })], "upstream_failed", "半截"],
    ["非法 SSE JSON", [delta("半截"), "data: invalid\n\n"], "upstream_failed", "半截"],
  ])("%s 不能伪装成功，保留失败部分并重试原消息", async (_name, chunks, code, partial) => {
    fetcher.mockResolvedValueOnce(upstream(...chunks as string[]));
    const failed = await call();
    expect(failed.text).not.toContain("event: done");
    expect(failed.text).toContain("event: error");
    expect(row()).toMatchObject({ status: "error", content: partial, raw_content: partial });
    expect(stored()._request.failure?.code).toBe(code);
    const retried = await call();
    expect(retried.text).toContain("event: done");
    expect(row().content).toBe("你好，世界");
    expect(count()).toBe(2);
  });
  it("已成功的重复请求回放原答案，不重新调用模型或新增消息", async () => {
    await call();
    const createdAt = row().created_at;
    const result = await call();
    expect(result.text).toContain('"replayed":true');
    expect(result.text).toContain("你好，世界");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(row().created_at).toBe(createdAt);
    expect(count()).toBe(2);
  });
  it("并发请求返回 409；取消挂起请求后可重试，同一时刻不双发", async () => {
    const abort = new AbortController();
    fetcher.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })));
    const pending = await POST(request({}, abort.signal));
    const duplicate = await call();
    expect(duplicate.status).toBe(409);
    expect(duplicate.text).toContain("request_in_progress");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    abort.abort();
    expect(await pending.text()).toContain("cancelled");
    expect(row().status).toBe("error");
    const retry = await call();
    expect(retry.text).toContain("event: done");
    expect(row().status).toBe("completed");
    expect(count()).toBe(2);
  });
  it("浏览器取消读取保留已收到文本，失败消息可原位重试", async () => {
    const cancelled = vi.fn();
    fetcher.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode(delta("部分输出"))); }, cancel: cancelled })));
    const response = await POST(request());
    const reader = response.body!.getReader();
    let text = "";
    while (!text.includes("raw_delta")) text += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel(); reader.releaseLock();
    expect(row()).toMatchObject({ status: "error", content: "部分输出" });
    expect(stored()._request.failure?.code).toBe("cancelled");
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
    expect((await call()).text).toContain("event: done");
    expect(count()).toBe(2);
  });
  it("已取消的旧流不能覆盖新重试的成功结果", async () => {
    let resolveFetch!: (value: Response) => void;
    const abort = new AbortController();
    fetcher.mockImplementationOnce(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const pending = await POST(request({}, abort.signal));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    abort.abort();
    await pending.text();
    await call();
    resolveFetch(upstream(delta("旧请求迟到"), done()));
    await vi.waitFor(() => expect(row().content).toBe("你好，世界"));
    expect(row().status).toBe("completed");
    expect(count()).toBe(2);
  });
  it("客户端状态机到路由到 SQLite：首条失败重试 UI 和数据库均只有原两条消息", async () => {
    const ids = ["thread-1", "user-1", "assistant-1"];
    const initial = createReadingRequest({ mode: "analyze", question: "请句读这一段", selectedText: "这是十字原文用来句读", editionId: "edition-1", chapterId: "chapter-1", paragraphId: "p1", selectionStart: 2, selectionEnd: 12 }, () => ids.shift()!);
    const transport: typeof fetch = async (_url, init) => POST(new NextRequest("http://localhost/api/analyze/stream", { ...init, signal: init?.signal ?? undefined }));
    fetcher.mockResolvedValueOnce(upstream(delta("部分生成")));
    const started = beginReadingRequest(initial, []);
    const failed = await executeReadingRequest(started.state, { fetcher: transport });
    expect(failed.status).toBe("error");
    expect(row().status).toBe("error");
    const messages = applyReadingRequest(started.messages, failed);
    const restored = restoreReadingRequest(initial.payload.threadId, { ...row(), structuredOutput: row().structured_output });
    const retried = beginReadingRequest(restored!, messages);
    fetcher.mockResolvedValueOnce(toolResponse());
    const completed = await executeReadingRequest(retried.state, { fetcher: transport });
    const finalMessages = applyReadingRequest(retried.messages, completed);
    expect(completed.status).toBe("completed");
    expect(completed.analysis?.anchor).toMatchObject({ paragraphId: "p1", startOffset: 2, endOffset: 12 });
    expect(finalMessages).toHaveLength(2);
    expect(finalMessages[0]).toBe(started.messages[0]);
    expect(finalMessages.map((message) => message.id)).toEqual(["user-1", "assistant-1"]);
    expect(count()).toBe(2);
    expect(row().content).toBe(finalMessages[1].content);
  });
  it("底层连接中途报错也保存 partial 并允许原 ID 重试", async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    fetcher.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ start(controller) { source = controller; controller.enqueue(encoder.encode(delta("已收到"))); } })));
    const response = await POST(request());
    const reader = response.body!.getReader();
    let text = "";
    while (!text.includes("raw_delta")) text += new TextDecoder().decode((await reader.read()).value);
    source.error(new Error("connection reset"));
    while (true) { const next = await reader.read(); if (next.done) break; text += new TextDecoder().decode(next.value); }
    reader.releaseLock();
    expect(text).toContain("event: error");
    expect(text).not.toContain("event: done");
    expect(row()).toMatchObject({ status: "error", content: "已收到" });
    expect((await call()).text).toContain("event: done");
    expect(count()).toBe(2);
  });
  it("过期的 streaming 占位可以恢复，不永久卡住", async () => {
    await call();
    const saved = stored();
    fixture.db!.prepare("UPDATE chat_messages SET status = 'streaming', structured_output = ? WHERE id = ?").run(JSON.stringify({ ...saved, _request: { ...saved._request, leaseUntil: 0 } }), "assistant-1");
    expect((await call()).text).toContain("event: done");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(count()).toBe(2);
  });
  it.each([
    { question: "换了问题" }, { selectedText: "换了选区" }, { threadId: "another-thread" },
    { clientAssistantMessageId: "another-assistant" }, { clientUserMessageId: "another-user" }, { editionId: "edition-2" },
  ])("不能复用 ID 偷换原消息输入 %j", async (overrides) => {
    await call();
    expect((await call(overrides)).status).toBe(409);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(count()).toBe(2);
  });
  it("历史中移除本轮 ID 和失败 assistant，避免给模型重复用户指令", async () => {
    await call({ chatHistory: [{ id: "old", role: "user", content: "保留历史" }, { id: "user-1", role: "user", content: "重复指令" }, { id: "assistant-1", role: "assistant", content: "失败半截" }, { id: "failed-old", role: "assistant", content: "其他失败", status: "error" }] });
    const text = String(fetcher.mock.calls[0][1]?.body);
    expect(text).toContain("保留历史");
    expect(text).not.toContain("重复指令");
    expect(text).not.toContain("失败半截");
    expect(text).not.toContain("其他失败");
  });
});

describe("成功 Analysis 的服务端合法锚点", () => {
  it("合法范围写入 anchor，同时保持 Analysis 字段和客户端消息 ID", async () => {
    fetcher.mockResolvedValueOnce(toolResponse());
    const result = await call({ mode: "analyze" });
    expect(result.text).toContain('"messageId":"assistant-1"');
    expect(stored()).toMatchObject({ ...analysis, anchor: { paragraphId: "p1", startOffset: 2, endOffset: 12, selectedText: "这是十字原文用来句读" } });
    const replay = await call({ mode: "analyze" });
    expect(replay.text).toContain('"anchor":{"paragraphId":"p1"');
    expect(replay.text).not.toContain("_request");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    { selectionStart: undefined, selectionEnd: undefined }, { selectionStart: -1 }, { selectionStart: 2.5 },
    { selectionEnd: 100 }, { selectionEnd: 3 }, { paragraphId: "p2" }, { chapterId: "chapter-2" },
    { selectedText: "这里十个字找不到位置" }, { selectedText: " 这是十字原文用来句读 " },
  ])("缺失或非法选区不猜锚点，工具只提交分析字段 %j", async (overrides) => {
    fetcher.mockResolvedValueOnce(toolResponse());
    await call({ mode: "analyze", ...overrides });
    expect(row().status).toBe("completed");
    expect(stored().anchor).toBeUndefined();
  });
  it("失败的 Analysis 不落已完成锚点，保留原请求输入供重试", async () => {
    fetcher.mockResolvedValueOnce(upstream(delta('{"summary":"半截')));
    await call({ mode: "analyze" });
    expect(row().status).toBe("error");
    expect(stored().anchor).toBeUndefined();
    expect(stored()._request).toMatchObject({ input: { paragraphId: "p1", selectionStart: 2, selectionEnd: 12, selectedText: "这是十字原文用来句读" } });
  });
});

describe("请求边界校验", () => {
  it.each([{ clientUserMessageId: undefined }, { clientAssistantMessageId: "user-1" }, { threadId: "bad id" }, { question: " " }])("非法 ID 或输入不写入任何消息 %j", async (overrides) => {
    expect((await call(overrides)).status).toBe(400);
    expect(count()).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("非法 JSON 返回 400", async () => {
    const response = await POST(new NextRequest("http://localhost/api/analyze/stream", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(count()).toBe(0);
  });
});


describe("首次上下文快照：持久化、刷新和重试", () => {
  const original = () => ({
    bookTitle: "精神现象学", chapterTitle: "承认关系", context: "首次提交的前后文", textHash: "first-hash",
    contextSettings: { maxInputTokens: 400000, maxOutputTokens: 8192, compressionStrategy: "aggressive" as const },
    chatHistory: [{ id: "history-1", role: "user" as const, content: "此前的问题" }, { id: "history-2", role: "assistant" as const, content: "此前已确认的回答" }],
    bookSearch: [{ sourceId: "book:p1", paragraphId: "p1", excerpt: "首次检索命中的片段", context: { before: [{ id: "before", text: "首次检索前文" }], after: [] } }],
  });
  it("重试篡改标题、历史、检索、预算和 contextSnapshot 不改变首次上游输入", async () => {
    const first = original();
    fetcher.mockResolvedValueOnce(new Response("失败", { status: 503 }));
    await call(first);
    const firstBody = String(fetcher.mock.calls[0][1]?.body);
    const firstMeta = stored()._request;
    expect(firstMeta.contextSnapshot).toEqual({ version: 1, ...first });
    await call({ bookTitle: "新书名", chapterTitle: "新章节", context: "不同前后文", textHash: "new-hash", contextSettings: { maxInputTokens: 8192, maxOutputTokens: 1024, compressionStrategy: "conservative" }, chatHistory: [{ role: "user", content: "新历史" }], bookSearch: [{ excerpt: "新检索结果" }], contextSnapshot: { ...captureReadingContext(first), context: "伪造快照" } });
    expect(String(fetcher.mock.calls[1][1]?.body)).toBe(firstBody);
    expect(firstBody).toContain("精神现象学");
    expect(firstBody).toContain("承认关系");
    expect(firstBody).toContain("首次提交的前后文");
    expect(JSON.parse(firstBody).max_tokens).toBe(8192);
    expect(stored()._request.contextSnapshot).toEqual(firstMeta.contextSnapshot);
    expect(stored()._request.fingerprint).toBe(firstMeta.fingerprint);
    expect(count()).toBe(2);
  });
  it("刷新恢复后由执行器再次发送，Provider 看到的完整请求与首次一致", async () => {
    const first = original();
    fetcher.mockResolvedValueOnce(upstream(delta("半截")));
    await call(first);
    const firstBody = String(fetcher.mock.calls[0][1]?.body);
    const restored = restoreReadingRequest("thread-1", { ...row(), structuredOutput: row().structured_output }, [{ role: "user", content: "刷新后新增的问题" }]);
    expect(restored?.payload).toMatchObject(first);
    const transport: typeof fetch = async (_url, init) => POST(new NextRequest("http://localhost/api/analyze/stream", { ...init, signal: init?.signal ?? undefined }));
    const started = beginReadingRequest(restored!, []);
    const result = await executeReadingRequest(started.state, { fetcher: transport });
    expect(result.status).toBe("completed");
    expect(String(fetcher.mock.calls[1][1]?.body)).toBe(firstBody);
    expect(count()).toBe(2);
  });
  it("配置失败也先保存上下文，但不保存请求或嵌套 metadata 中的密钥", async () => {
    vi.stubEnv("AI_API_KEY", "");
    try {
      setProvider("openai", "");
      const first = original();
      const result = await call({ ...first, apiKey: "root-secret", api_key: "snake-secret", headers: { Authorization: "auth-secret" }, contextSettings: { ...first.contextSettings, apiKey: "settings-secret" }, chatHistory: first.chatHistory.map((item) => ({ ...item, token: "history-secret" })), bookSearch: first.bookSearch.map((item) => ({ ...item, apiKey: "search-secret", context: { ...item.context, credentials: "nested-secret" } })) });
      expect(result.status).toBe(503);
      expect(stored()._request.contextSnapshot).toEqual({ version: 1, ...first });
      expect(row().structured_output).not.toContain("secret");
      expect(fetcher).not.toHaveBeenCalled();
      setProvider();
      await call({ context: "保存配置后不同的上下文", contextSettings: { maxOutputTokens: 1024 } });
      const body = String(fetcher.mock.calls[0][1]?.body);
      expect(body).toContain("首次提交的前后文");
      expect(body).not.toContain("保存配置后不同的上下文");
      expect(JSON.parse(body).max_tokens).toBe(8192);
    } finally { vi.unstubAllEnvs(); }
  });
  it("没有旧快照的记录仍沿用原指纹和 ID，兼容快照只补录一次", async () => {
    fetcher.mockResolvedValueOnce(upstream(delta("半截")));
    await call();
    const saved = stored();
    const fingerprint = saved._request.fingerprint;
    delete saved._request.contextSnapshot;
    fixture.db!.prepare("UPDATE chat_messages SET structured_output = ? WHERE id = ?").run(JSON.stringify(saved), "assistant-1");
    fetcher.mockResolvedValueOnce(upstream(delta("第二次仍中断")));
    await call(original());
    expect(stored()._request.fingerprint).toBe(fingerprint);
    expect(stored()._request.contextSnapshot).toEqual({ version: 1, ...original() });
    const firstAvailableBody = String(fetcher.mock.calls[1][1]?.body);
    await call({ context: "第三次不同的上下文", bookTitle: "不应覆盖" });
    expect(String(fetcher.mock.calls[2][1]?.body)).toBe(firstAvailableBody);
    expect(count()).toBe(2);
  });
  it("已有快照损坏时不能借新 body 覆盖存储", async () => {
    fetcher.mockResolvedValueOnce(upstream(delta("半截")));
    await call(original());
    const saved = stored();
    fixture.db!.prepare("UPDATE chat_messages SET structured_output = ? WHERE id = ?").run(JSON.stringify({ ...saved, _request: { ...saved._request, contextSnapshot: {} } }), "assistant-1");
    const corrupt = row().structured_output;
    expect((await call(original())).status).toBe(500);
    expect(row().structured_output).toBe(corrupt);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("显式更新预算的原位重试",()=>{
  it("调整执行预算不改变首次上下文和原消息身份",async()=>{fetcher.mockResolvedValueOnce(new Response("失败",{status:503}));await call({contextSettings:{maxInputTokens:4096,maxOutputTokens:1024,compressionStrategy:"balanced"}});const original=stored()._request.contextSnapshot;const first=JSON.parse(String(fetcher.mock.calls[0][1]?.body));expect(first.max_tokens).toBe(1024);await call({retryContextSettings:{maxInputTokens:8192,maxOutputTokens:2048}});expect(row().status).toBe("completed");expect(count()).toBe(2);expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).max_tokens).toBe(2048);expect(stored()._request.contextSnapshot).toEqual(original);expect(stored()._request).toMatchObject({executionSettings:{maxInputTokens:8192,maxOutputTokens:2048}});});
  it("固定原文超预算后，提高预算可以在同一消息继续",async()=>{const first={context:"需要保留的原文".repeat(1500),contextSettings:{maxInputTokens:4096,maxOutputTokens:1024,compressionStrategy:"balanced"}};expect((await call(first)).text).toContain("context_limit");expect(fetcher).not.toHaveBeenCalled();expect((await call({contextSettings:{maxInputTokens:1000000,maxOutputTokens:2048}})).text).toContain("context_limit");expect((await call({retryContextSettings:{maxInputTokens:131072,maxOutputTokens:2048}})).text).toContain("event: done");expect(count()).toBe(2);expect(stored()._request.contextSnapshot?.context).toBe(first.context);});
  it("首次请求及非法预算不接受重试覆盖",async()=>{expect((await call({retryContextSettings:{maxInputTokens:8192,maxOutputTokens:2048}})).status).toBe(400);expect(count()).toBe(0);expect((await call({retryContextSettings:{maxInputTokens:NaN,maxOutputTokens:2048}})).status).toBe(400);});
});

describe("完整SDK的旧工具迟到与新attempt交错",()=>{
  it("取消后迟到的检索结果不能写入审计或覆盖新回复",async()=>{
    const original=retrievalModule.createBookRetrieval;
    let release!:()=>void, entered!:()=>void, settled!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;}), called=new Promise<void>(resolve=>{entered=resolve;}), ended=new Promise<void>(resolve=>{settled=resolve;});
    let first=true;
    vi.spyOn(retrievalModule,"createBookRetrieval").mockImplementation(options=>{const search=original(options);if(!first)return search;first=false;return async input=>{entered();await held;try{return await search(input);}finally{settled();}};});
    fetcher.mockResolvedValueOnce(toolResponse({query:"这是十字原文用来句读"},"search_book"));
    const abort=new AbortController();const pending=await POST(request({},abort.signal));await called;abort.abort();expect(await pending.text()).toContain("cancelled");
    const oldAttempt=stored()._request.attemptId;expect((await call()).text).toContain("event: done");expect(stored()._request.attemptId).not.toBe(oldAttempt);
    release();await ended;await new Promise(resolve=>setTimeout(resolve,10));
    expect(row()).toMatchObject({status:"completed",content:"你好，世界"});expect(count()).toBe(2);
    expect(fixture.db!.prepare("SELECT COUNT(*) AS count FROM agent_tool_runs").get()).toEqual({count:0});expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("成功幂等回放恢复当前attempt工具卡且不重新调用模型",async()=>{fetcher.mockResolvedValueOnce(toolResponse());await call({mode:"analyze"});const number=fetcher.mock.calls.length;const replay=await call({mode:"analyze"});expect(replay.text).toContain('event: tool');expect(replay.text).toContain('"name":"save_reading_analysis"');expect(fetcher).toHaveBeenCalledTimes(number);expect(count()).toBe(2);});
});

it.each([{threadId:"thread-1\n"},{clientAssistantMessageId:"assistant-1\n"},{editionId:"edition-1\n"}])("流式入口也拒绝尾换行ID，不再制造不可打开的新会话 %j",async input=>{expect((await call(input)).status).toBe(400);expect(count()).toBe(0);expect(fetcher).not.toHaveBeenCalled();});

it("请求模型来自允许列表，并真实传入上游且落库",async()=>{fixture.db!.exec("CREATE TABLE ai_model_choices(model TEXT PRIMARY KEY,position INTEGER);INSERT INTO ai_model_choices VALUES('second-model',0)");const result=await call({model:'second-model'});expect(result.status).toBe(200);expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).model).toBe('second-model');expect(fixture.db!.prepare("SELECT model_name FROM chat_messages WHERE id='assistant-1'").get()).toMatchObject({model_name:'second-model'});});
it("未知模型在请求上游和保存消息之前拒绝",async()=>{const result=await call({model:'not-configured'});expect(result.status).toBe(400);expect(fetcher).not.toHaveBeenCalled();expect(count()).toBe(0);});
