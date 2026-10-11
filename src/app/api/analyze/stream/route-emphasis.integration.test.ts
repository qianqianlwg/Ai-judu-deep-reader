import {SOURCE_EMPHASIS_SCHEMA} from "@/lib/source-enhancement-store";
import { GUIDE_SCHEMA } from "@/lib/guide-schema";
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
const analysis = { answerEmphasis: {keywords:"none",keySentences:"none"}, readingText: "原文啊", summary: "解释", breakdown: [], concepts: "\u65e0", context: "上下文", uncertainty: "", citations: [] };
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
  fixture.db.exec(GUIDE_SCHEMA);fixture.db.exec(SOURCE_EMPHASIS_SCHEMA);
  fixture.db.exec(String.raw`
    CREATE TABLE ai_provider_configs (id TEXT PRIMARY KEY, provider TEXT, base_url TEXT, api_key TEXT, model TEXT);
    INSERT INTO ai_provider_configs VALUES ('default', 'openai', 'https://provider.test', 'test-key', 'test-model');
    CREATE TABLE reading_threads (id TEXT PRIMARY KEY, book_id TEXT, edition_id TEXT NOT NULL, chapter_id TEXT, paragraph_id TEXT, selected_text TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE chat_messages (id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, content TEXT NOT NULL, raw_content TEXT, structured_output TEXT, status TEXT, model_name TEXT, prompt_version TEXT, created_at TEXT, usage_json TEXT);
    CREATE TABLE agent_tool_runs (id TEXT PRIMARY KEY, message_id TEXT, thread_id TEXT, attempt_id TEXT, tool_name TEXT, input_json TEXT, output_json TEXT, status TEXT, created_at TEXT);
    CREATE TABLE annotations(id TEXT PRIMARY KEY,paragraph_id TEXT,start_offset INTEGER,end_offset INTEGER,text_hash TEXT,thread_id TEXT,summary TEXT,concepts TEXT,created_at TEXT,concept_details TEXT,message_id TEXT);
    CREATE TABLE context_snapshots (id TEXT PRIMARY KEY, thread_id TEXT, book_id TEXT, edition_id TEXT, summary TEXT, recent_messages TEXT, token_count INTEGER, version INTEGER, created_at TEXT, checkpoint_json TEXT);
    CREATE TABLE editions(id TEXT PRIMARY KEY,book_id TEXT);
    INSERT INTO editions VALUES ('edition-1','book-1'),('edition-2','book-2');
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
  it("模型省略必填标注时报错并保留正文，绝不补造标注", async () => {
    fetcher.mockReset().mockImplementation(async()=>upstream(delta(answer), done()));
    const result = await call();
    expect(result.text).not.toContain('event: emphasis');
    expect(result.text).toContain('emphasis_missing');
    expect(stored().emphasis).toBeUndefined();
    expect(row()).toMatchObject({content:answer,status:"error"});
  });
  it("追问先流式输出无符号正文，再校验独立标注并可刷新回放", async () => {
    fetcher.mockReset().mockResolvedValueOnce(firstStep("mark_answer_emphasis", { answerEmphasis: {keywords:["影响范围"],keySentences:"none"} })).mockResolvedValueOnce(upstream(done()));
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
  it("句读工具的标注由content逐字核验，并进入已完成句读块而非另造分析", async () => {
    const submission={sourceStart:payload.selectedText.slice(0,8),sourceEnd:payload.selectedText.slice(-8),title:'影响范围',content:answer,sourceAnnotations:{keywords:'none',keySentences:'none',concepts:'none'},answerEmphasis:{keywords:['影响范围'],keySentences:'none'}};
    fetcher.mockReset().mockResolvedValueOnce(firstStep('submit_reading_sentence',submission)).mockResolvedValueOnce(upstream(delta('综合小结。'),done()));
    const result=await call({mode:'analyze'});expect(result.text).toContain('event: semantic');expect(result.text).not.toContain('event: structured');
    expect(stored()).toMatchObject({semantic:{phase:'completed',units:[{content:answer,analysis:{emphasis}}]}});
    expect(row().content).toContain(answer);expect(row().status).toBe('completed');
  });
  it("模型提出正文不存在的词不能保存，原回答照常保留", async () => {
    const wrong = { version: 1, marks: [{ kind: "term", quote: "不存在", occurrence: 1 }] };
    fetcher.mockReset().mockResolvedValueOnce(firstStep("mark_answer_emphasis", { answerEmphasis: {keywords:["不存在"],keySentences:"none"} })).mockResolvedValueOnce(upstream(done()));
    const result = await call();
    expect(result.text).not.toContain('event: emphasis');
    expect(stored().emphasis).toBeUndefined();
    expect(row().status).toBe("error");
    expect(row().content).toBe(answer);
  });
});

it("显式无被保存及回放，省略保存工具不能出现兼容伪成功", async () => {
  fetcher.mockReset().mockResolvedValueOnce(upstream(delta("已经说明。"),block({id:"none",choices:[{index:0,delta:{tool_calls:[{index:0,id:"none",type:"function",function:{name:"mark_answer_emphasis",arguments:JSON.stringify({answerEmphasis:{keywords:"none",keySentences:"none"}})}}]},finish_reason:"tool_calls"}]}),block("[DONE]")));
  const result=await call();
  expect(row().status).toBe("completed");
  expect(stored().emphasis).toEqual({version:1,marks:[]});
  expect(stored().emphasisSource).toBe("agent");
  expect(result.text).toContain('event: emphasis');
});
it("句读省略保存工具不生成 concepts 和伪工具成功", async () => {
  fetcher.mockReset().mockResolvedValueOnce(upstream(delta("自然释读正文。"),done()));
  const result=await call({mode:"analyze"});
  expect(row().status).toBe("error");
  expect(stored().concepts).toBeUndefined();
  expect(result.text).not.toContain("fallback-save");
  expect(result.text).not.toContain("event: structured");
});

it("旧自动标注即使已落库，幂等回放也不冒充 AI 标注", async () => {
  fetcher.mockReset().mockResolvedValueOnce(upstream(delta("自然释读正文。"),block({id:"save",choices:[{index:0,delta:{tool_calls:[{index:0,id:"save",type:"function",function:{name:"mark_answer_emphasis",arguments:JSON.stringify({answerEmphasis:{keywords:"none",keySentences:"none"}})}}]},finish_reason:"tool_calls"}]}),block("[DONE]")));
  await call({mode:"analyze",selectionStart:undefined,selectionEnd:undefined});
  const saved=stored();delete saved.emphasisSource;
  saved.emphasis={version:1,marks:[{kind:"term",quote:"释读",occurrence:1}]};
  fixture.db!.prepare("UPDATE chat_messages SET structured_output=? WHERE id='assistant-1'").run(JSON.stringify(saved));
  const replay=await call({mode:"analyze",selectionStart:undefined,selectionEnd:undefined});
  expect(replay.text).not.toContain('event: emphasis');
  const structuredBlock=replay.text.split("\n\n").find(block=>block.startsWith("event: structured\n"));
  expect(structuredBlock).toBeUndefined();
  expect(row().content).toBe("自然释读正文。");
});

it("真实 SDK 的 403 原始错误通过 SSE 和持久化完整显示，不改写或脱敏", async () => {
  const detail = { message: "当前 API Key 分组下模型 test-model 无可用渠道 test-key", type: "permission_error", code: "channel_unavailable", param: "model", extra: { request_id: "request-1" } };
  fetcher.mockReset().mockResolvedValueOnce(Response.json({error:detail},{status:403}));
  const response=await call();
  const errorBlock=response.text.split("\n\n").find(block=>block.startsWith("event: error\n"));
  expect(errorBlock).toBeDefined();
  const event=JSON.parse(errorBlock!.split("\ndata: ")[1]);
  expect(event.message).toBe(JSON.stringify(detail,null,2));
  expect(JSON.parse(event.message)).toEqual(detail);
  expect(row().status).toBe("error");
  expect(stored()._request.failure).toMatchObject({code:"upstream_failed",message:event.message,retryable:true});
  expect(stored().emphasis).toBeUndefined();
});
it("手选新模型后重试保持原消息指纹，真实SDK发送新模型并记录执行模型", async () => {
  fixture.db!.exec("CREATE TABLE ai_model_choices(model TEXT PRIMARY KEY,position INTEGER);INSERT INTO ai_model_choices VALUES('new-model',0)");
  fetcher.mockReset().mockResolvedValueOnce(Response.json({error:{message:"当前 API Key 分组下模型 test-model 无可用渠道"}},{status:403}));
  await call({model:"test-model"});
  const fingerprint=stored()._request.fingerprint;
  const firstContext=stored()._request.contextSnapshot;
  fetcher.mockResolvedValueOnce(upstream(delta("本轮新模型回答。"),block({id:"new",choices:[{index:0,delta:{tool_calls:[{index:0,id:"new",type:"function",function:{name:"mark_answer_emphasis",arguments:JSON.stringify({answerEmphasis:{keywords:"none",keySentences:"none"}})}}]},finish_reason:"tool_calls"}]}),block("[DONE]")));
  const response=await call({model:"test-model",retryModel:"new-model",context:"不能覆盖原快照"});
  expect(response.text).toContain("event: done");
  const outgoing=JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body));
  expect(outgoing.model).toBe("new-model");
  expect(stored()._request.fingerprint).toBe(fingerprint);
  expect(stored()._request.contextSnapshot).toEqual(firstContext);
  expect(stored()._request).toMatchObject({input:{model:"test-model"},executionModel:"new-model"});
  expect(fixture.db!.prepare("SELECT model_name FROM chat_messages WHERE id='assistant-1'").get()).toEqual({model_name:"new-model"});
  expect(fixture.db!.prepare("SELECT COUNT(*) AS count FROM chat_messages").get()).toEqual({count:2});
});
it("首次请求及未配置模型不能滥用retryModel，已完成消息也不重复生成", async () => {
  expect((await call({retryModel:"test-model"})).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValueOnce(Response.json({error:{message:"无可用渠道"}},{status:403}));
  await call();
  const count=fetcher.mock.calls.length;
  expect((await call({retryModel:"unconfigured-model"})).status).toBe(400);
  expect(fetcher).toHaveBeenCalledTimes(count);
  expect(row().status).toBe("error");
});
