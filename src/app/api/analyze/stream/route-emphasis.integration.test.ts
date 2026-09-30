import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "@/lib/db";

type TestDb = ReturnType<typeof getDb> & { close(): void };
const fixture = vi.hoisted(() => ({ db: undefined as TestDb | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => { if (!fixture.db) throw new Error("测试数据库未初始化"); return fixture.db; } }));
import { POST } from "./route";

const runtime = (process as unknown as { getBuiltinModule(name: string): { DatabaseSync: new (file: string) => TestDb } }).getBuiltinModule("node:sqlite");
const encoder = new TextEncoder();
const fetcher = vi.fn<typeof fetch>();
const payload = { threadId: "thread-1", clientUserMessageId: "user-1", clientAssistantMessageId: "assistant-1", editionId: "edition-1", chapterId: "chapter-1", paragraphId: "p1", mode: "chat", question: "测试", selectedText: "这是十字原文用来句读", selectionStart: 2, selectionEnd: 12 };
const analysis = { readingText: "原文啊", summary: "解释", breakdown: [], concepts: "\u65e0", context: "上下文", uncertainty: "", citations: [] };
const block = (data: unknown, event?: string) => (event ? "event: " + event + "\n" : "") + "data: " + (typeof data === "string" ? data : JSON.stringify(data)) + "\n\n";
const delta = (content: string) => block({ id: "text-step", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] });
const done = () => block({ id: "text-step", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + block("[DONE]");
function upstream(...chunks: string[]) { return new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } }), { headers: { "Content-Type": "text/event-stream" } }); }
function request(overrides: Record<string, unknown> = {}, signal?: AbortSignal) { return new NextRequest("http://localhost/api/analyze/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, ...overrides }), signal }); }
async function call(overrides: Record<string, unknown> = {}) { const response = await POST(request(overrides)); return { status: response.status, text: await response.text() }; }
function row(id = "assistant-1") { return fixture.db!.prepare("SELECT * FROM chat_messages WHERE id = ?").get(id) as { id: string; role: string; content: string; raw_content: string; structured_output: string; status: string; created_at: string }; }
const stored = () => JSON.parse(row().structured_output) as Record<string, unknown> & { _request: { failure?: { code: string; retryable: boolean }; attemptId: string; fingerprint: string; contextSnapshot?: unknown } };

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

describe("语义重点标注的 SSE、落库和幂等回放", () => {
  const answer = "先看影响范围，再确定协调责任。";
  const emphasis = { version: 1, marks: [{ kind: "term", quote: "影响范围", occurrence: 1 }] };
  function firstStep(name: string, args: unknown): Response {
    return upstream(delta(answer), block({ id: "tool-step", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call-emphasis", type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }] }), block("[DONE]"));
  }
  it("模型省略标注工具时，服务端自动补充可验证重点", async () => {
    fetcher.mockReset().mockResolvedValueOnce(upstream(delta(answer), done()));
    const result = await call();
    expect(result.text).toContain('event: emphasis');
    expect(stored().emphasis).toMatchObject({ version: 1, marks: [expect.objectContaining({ kind: "key_sentence", quote: answer })] });
  });
  it("追问先流式输出无符号正文，再校验独立标注并可刷新回放", async () => {
    fetcher.mockReset().mockResolvedValueOnce(firstStep("mark_answer_emphasis", emphasis)).mockResolvedValueOnce(upstream(done()));
    const result = await call();
    expect(result.text).toContain('event: raw_delta\ndata: {"text":"' + answer + '"}');
    expect(result.text).toContain('event: emphasis\ndata: {"result":');
    expect(row()).toMatchObject({ content: answer, status: "completed" });
    expect(stored().emphasis).toEqual(emphasis);
    const calls = fetcher.mock.calls.length;
    const replay = await call();
    expect(replay.text).toContain('event: emphasis\ndata: {"result":');
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });
  it("句读保存的标注被同一版正文校验，虚构位置不会进入历史", async () => {
    fetcher.mockReset().mockResolvedValueOnce(firstStep("save_reading_analysis", { ...analysis, emphasis })).mockResolvedValueOnce(upstream(done()));
    const result = await call({ mode: "analyze" });
    expect(result.text).toContain('event: structured');
    expect(result.text).toContain('event: emphasis');
    expect(stored().emphasis).toEqual(emphasis);
    expect(row().content).toBe(answer);
  });
  it("模型提出正文不存在的词不能保存，原回答照常保留", async () => {
    const wrong = { version: 1, marks: [{ kind: "term", quote: "不存在", occurrence: 1 }] };
    fetcher.mockReset().mockResolvedValueOnce(firstStep("mark_answer_emphasis", wrong)).mockResolvedValueOnce(upstream(done()));
    const result = await call();
    expect(result.text).toContain('event: emphasis');
    expect(JSON.stringify(stored().emphasis)).not.toContain("不存在");
    expect(row().content).toBe(answer);
  });
});
