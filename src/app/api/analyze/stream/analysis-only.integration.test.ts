import { SOURCE_EMPHASIS_SCHEMA } from "@/lib/source-enhancement-store";
import { GUIDE_SCHEMA } from "@/lib/guide-schema";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "@/lib/db";

type TestDb = ReturnType<typeof getDb> & { close(): void };
const fixture = vi.hoisted(() => ({ db: undefined as TestDb | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => { if (!fixture.db) throw new Error("测试数据库未初始化"); return fixture.db; } }));
import { POST } from "./route";
import * as retrievalModule from "@/lib/book-retrieval";
import * as prefetchModule from "@/lib/agent/book-context-prefetch";
import { captureReadingContext, type ReadingContextSnapshot, applyReadingRequest, beginReadingRequest, createReadingRequest, executeReadingRequest, restoreReadingRequest } from "@/lib/reading-request";

const runtime = (process as unknown as { getBuiltinModule(name: string): { DatabaseSync: new (file: string) => TestDb } }).getBuiltinModule("node:sqlite");
const encoder = new TextEncoder();
const fetcher = vi.fn<typeof fetch>();
const payload = { threadId: "thread-1", clientUserMessageId: "user-1", clientAssistantMessageId: "assistant-1", editionId: "edition-1", chapterId: "chapter-1", paragraphId: "p1", mode: "chat", question: "测试", selectedText: "这是十字原文用来句读", selectionStart: 2, selectionEnd: 12 };
const analysis = { answerEmphasis: { keywords:"none", keySentences:"none" }, readingText: "原文啊", summary: "解释", breakdown: [], concepts: "\u65e0", context: "上下文", uncertainty: "", citations: [] };
const block = (data: unknown, event?: string) => (event ? "event: " + event + "\n" : "") + "data: " + (typeof data === "string" ? data : JSON.stringify(data)) + "\n\n";
const delta = (content: string) => block({ id: "text-step", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] });
// WHY：成功模拟必须由模拟模型明确提交“无”；另保留只结束不提交的失败样本。
const done = (submit=true, name="mark_answer_emphasis") => block({ id: "text-step", choices: [{ index: 0, delta: submit ? {tool_calls:[{index:0,id:"call-none",type:"function",function:{name,arguments:JSON.stringify(name==="save_reading_analysis"?analysis:{answerEmphasis:{keywords:"none",keySentences:"none"}})}}]} : {}, finish_reason: submit ? "tool_calls" : "stop" }] }) + block("[DONE]");
const toolResponse = (args: unknown = analysis, name = "submit_reading_sentence") => upstream(block({ id: "tool-step", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call-save", type: "function", function: { name, arguments: JSON.stringify(name === "submit_reading_sentence" ? sentenceArgs(args as typeof analysis) : args) } }] }, finish_reason: "tool_calls" }] }), block("[DONE]"));
function sentenceArgs(args: typeof analysis = analysis) { return {sourceStart: payload.selectedText.slice(0,8),sourceEnd: payload.selectedText.slice(-8),title:'本段释读',content:args.readingText,sourceAnnotations:{keywords:'none',keySentences:'none',concepts:'none'},answerEmphasis:args.answerEmphasis}; }
function upstream(...chunks: string[]) { return new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } }), { headers: { "Content-Type": "text/event-stream" } }); }
function request(overrides: Record<string, unknown> = {}, signal?: AbortSignal) { return new NextRequest("http://localhost/api/analyze/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, ...overrides }), signal }); }
async function call(overrides: Record<string, unknown> = {}) { const response = await POST(request(overrides)); return { status: response.status, text: await response.text() }; }
function row(id = "assistant-1") { return fixture.db!.prepare("SELECT * FROM chat_messages WHERE id = ?").get(id) as { id: string; role: string; content: string; raw_content: string; structured_output: string; status: string; created_at: string }; }
const stored = () => JSON.parse(row().structured_output) as Record<string, unknown> & { _request: { input: Record<string,unknown>; failure?: { code: string; retryable: boolean }; attemptId: string; fingerprint: string; contextSnapshot?: ReadingContextSnapshot } };
const count = () => (fixture.db!.prepare("SELECT count(*) AS count FROM chat_messages").get() as { count: number }).count;
function setProvider(provider = "openai", key = "test-key") { fixture.db!.prepare("UPDATE ai_provider_configs SET provider = ?, api_key = ? WHERE id = 'default'").run(provider, key); }

beforeEach(() => {
  // WHY：使用真实内存 SQLite 执行事务和幂等 SQL；只替换上游传输，不访问外网、不启停服务。
  fixture.db = new runtime.DatabaseSync(":memory:");
  fixture.db.exec(GUIDE_SCHEMA); fixture.db.exec(SOURCE_EMPHASIS_SCHEMA);
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
  fetcher.mockReset().mockImplementation(async (_url,init) => { const body=JSON.parse(String(init?.body)); const reading=JSON.stringify(body.tools??[]).includes("submit_reading_sentence"); if(reading)return toolResponse(); return upstream(delta("你好"),delta("，世界"),done(Boolean(body.tools?.length),"mark_answer_emphasis")); });
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); fixture.db?.close(); fixture.db = undefined; });


const loose = {sourceMode:"analysis-only",mode:"analyze",selectedText:"一 泛论逻辑",chapterId:undefined,paragraphId:undefined,selectionStart:undefined,selectionEnd:undefined};
describe("仅分析流式协议隔离",()=>{
 it("短标题可流式分析、原文和回答落库，但没有位置或原文写入",async()=>{
  const result=await call(loose);expect(result.status).toBe(200);expect(result.text).toContain("event: done");expect(result.text).toContain("仅分析");
  const saved=stored();
  expect(saved._request.input).toMatchObject({sourceMode:"analysis-only",selectedText:"一 泛论逻辑",paragraphId:null,chapterId:null,selectionStart:null,selectionEnd:null});expect(saved).not.toHaveProperty("anchor");expect(saved).not.toHaveProperty("semantic");expect(row()).toMatchObject({status:"completed",content:"你好，世界"});expect(count()).toBe(2);
  const upstreamBody=JSON.parse(String(fetcher.mock.calls[0][1]?.body));expect(JSON.stringify(upstreamBody.messages)).toContain("一 泛论逻辑");expect(JSON.stringify(upstreamBody.messages)).toContain("本轮是仅分析模式");expect(JSON.stringify(upstreamBody.messages)).not.toContain('"sourceId":"book:edition-1:paragraph:p1"');
  const tools=JSON.stringify(upstreamBody.tools);expect(tools).not.toContain("submit_reading_sentence");expect(tools).not.toContain("save_reading_analysis");expect(tools).toContain("mark_answer_emphasis");
  for(const table of ["annotations","guide_sources","source_emphasis"])expect(fixture.db!.prepare("SELECT count(*) AS count FROM "+table).get()).toEqual({count:0});
 });
 it("仅分析按实际工具预算执行，最低上下文预算也能解释短标题",async()=>{const result=await call({...loose,contextSettings:{maxInputTokens:4096,maxOutputTokens:1024,compressionStrategy:"balanced"}});expect(result.text).toContain("event: done");expect(result.text).not.toContain("context_limit");});
 it("幂等回放不会重新请求模型，仍声明仅分析",async()=>{await call(loose);const n=fetcher.mock.calls.length;const result=await call(loose);expect(result.text).toContain("event: done");expect(result.text).toContain("仅分析");expect(fetcher).toHaveBeenCalledTimes(n);expect(count()).toBe(2);});
 it.each(["paragraphId","chapterId","selectionStart","selectionEnd","selectionAnchors","readingStyle","sectionId","forceRead","context","textHash"])("拒绝仅分析携带 %s，不调用模型、不保存消息",async field=>{
  const result=await call({...loose,[field]:field==="selectionAnchors"?[]:field==="forceRead"?true:"p1"});expect(result.status).toBe(400);expect(result.text).toContain("invalid_source_mode");expect(fetcher).not.toHaveBeenCalled();expect(count()).toBe(0);
 });
 it.each([{sourceMode:"guess"},{selectedText:" "},{selectedText:"😀".repeat(3001)},{editionId:"edition-missing"},{bookId:"book-2"}])("无效模式、超限或错书拒绝 %j",async bad=>{expect((await call({...loose,...bad})).status).toBeGreaterThanOrEqual(400);expect(fetcher).not.toHaveBeenCalled();expect(count()).toBe(0);});
 it("仅分析仍受会话版本隔离，不用无锚点绕过权限",async()=>{await call(loose);expect((await call({...loose,editionId:"edition-2",clientUserMessageId:"user-2",clientAssistantMessageId:"assistant-2"})).status).toBe(409);expect(count()).toBe(2);});
 it("重试不能更换文字或偷偷转为原文定位模式",async()=>{setProvider("openai","");expect((await call(loose)).status).toBe(503);setProvider();expect((await call({...loose,selectedText:"另一个标题"})).status).toBe(409);expect((await call({mode:"chat"})).status).toBe(409);expect(count()).toBe(2);expect(fetcher).not.toHaveBeenCalled();expect((await call(loose)).text).toContain("event: done");});
});
