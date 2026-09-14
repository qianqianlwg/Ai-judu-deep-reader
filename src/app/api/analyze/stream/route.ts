import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { compactContext } from "@/lib/context-compaction";
import { validateCitations, sourceIdForParagraph, type CitationSource } from "@/lib/citation-validation";
import { buildProviderHeaders, buildProviderRequestBody, buildProviderUrl, parseProviderSseEvent, type ProviderConfig, type ProviderMessage } from "@/lib/ai-provider";
import { isAnalysis, isRecord, type Analysis } from "@/lib/chat-stream";
import { captureReadingContext, readReadingContextSnapshot, type ReadingAnchor, type ReadingContextSnapshot } from "@/lib/reading-request";
import { SseDecoder, type StreamEvent } from "@/lib/sse";

export const runtime = "nodejs";
type Db = ReturnType<typeof getDb>;
type Input = {
  mode: "chat" | "analyze"; question: string; selectedText: string;
  editionId: string; bookId: string | null; chapterId: string | null; paragraphId: string | null;
  selectionStart: number | null; selectionEnd: number | null;
};
type Failure = { code: string; message: string; retryable: boolean };
type RequestMeta = {
  version: 1; clientUserMessageId: string; clientAssistantMessageId: string;
  fingerprint: string; attemptId: string; leaseUntil: number; input: Input; contextSnapshot: ReadingContextSnapshot; failure?: Failure;
};
type MessageRow = { id: string; thread_id: string; role: string; content: string; structured_output: string | null; status: string };
type SavedAnalysis = Analysis & { anchor?: ReadingAnchor };
class RequestError extends Error {
  constructor(message: string, readonly status = 409, readonly code = "id_conflict") { super(message); }
}
const TIMEOUT_MS = 300_000;
const nullableString = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const messageRow = (db: Db, id: string) => db.prepare("SELECT id, thread_id, role, content, structured_output, status FROM chat_messages WHERE id = ?").get(id) as MessageRow | undefined;
function parseSaved(row: MessageRow): Record<string, unknown> {
  if (!row.structured_output) return {};
  const value: unknown = JSON.parse(row.structured_output);
  if (!isRecord(value)) throw new Error("已保存消息元数据损坏");
  return value;
}
function requestId(value: unknown): string {
  if (value === undefined) return randomUUID();
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/u.test(value)) throw new RequestError("消息或会话 ID 不合法", 400, "invalid_id");
  return value;
}
function extractAnalysis(raw: string): Analysis {
  try {
    const value: unknown = JSON.parse(raw.trim());
    // WHY：模型不能自行注入锚点或请求元数据；这些字段只能来自服务端验证。
    if (isAnalysis(value)) return { summary: value.summary, breakdown: value.breakdown, concepts: value.concepts, context: value.context, uncertainty: value.uncertainty, citations: value.citations };
  } catch (error: unknown) { console.error("解析句读 JSON 失败", error); }
  return { summary: raw.trim(), breakdown: [], concepts: [], context: "基于当前选中文本和上下文。", uncertainty: "模型未按结构化协议返回。" };
}
function readConfig(db: Db): ProviderConfig {
  const row = db.prepare("SELECT provider, base_url, api_key, model FROM ai_provider_configs WHERE id = ?").get("default") as { provider?: string; base_url?: string; api_key?: string; model?: string } | undefined;
  return { provider: row?.provider === "claude" ? "claude" : "openai", baseUrl: row?.base_url || process.env.AI_BASE_URL || "https://api.openai.com/v1", apiKey: row?.api_key || process.env.AI_API_KEY || "", model: row?.model || process.env.AI_MODEL || "gpt-4o-mini" };
}
function verifiedAnchor(db: Db, input: Input): ReadingAnchor | undefined {
  const { paragraphId, selectionStart: startOffset, selectionEnd: endOffset, selectedText } = input;
  if (!paragraphId || startOffset === null || endOffset === null || !Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset < 0 || endOffset <= startOffset) return;
  const row = db.prepare("SELECT p.text, p.chapter_id FROM paragraphs p JOIN chapters c ON c.id = p.chapter_id WHERE p.id = ? AND c.edition_id = ?").get(paragraphId, input.editionId) as { text: string; chapter_id: string } | undefined;
  if (!row || (input.chapterId && input.chapterId !== row.chapter_id) || endOffset > row.text.length || row.text.slice(startOffset, endOffset) !== selectedText) return;
  return { paragraphId, startOffset, endOffset, selectedText };
}
function reserveMessages(db: Db, threadId: string, meta: RequestMeta, model: string): MessageRow | undefined {
  // WHY：原消息校验与幂等占位必须原子完成，避免双击或并发重试插入重复消息。
  db.exec("BEGIN IMMEDIATE");
  try {
    const thread = db.prepare("SELECT edition_id FROM reading_threads WHERE id = ?").get(threadId) as { edition_id: string } | undefined;
    if (thread && thread.edition_id !== meta.input.editionId) throw new RequestError("会话不属于当前书籍版本");
    const user = messageRow(db, meta.clientUserMessageId);
    const assistant = messageRow(db, meta.clientAssistantMessageId);
    if (user && (user.thread_id !== threadId || user.role !== "user" || user.content !== meta.input.question)) throw new RequestError("原用户消息与重试输入不匹配");
    if (assistant) {
      const saved = parseSaved(assistant)._request;
      if (assistant.thread_id !== threadId || assistant.role !== "assistant" || !isRecord(saved) || saved.clientUserMessageId !== meta.clientUserMessageId || saved.fingerprint !== meta.fingerprint) throw new RequestError("原助手消息与重试输入不匹配");
      if (!user) throw new RequestError("原用户消息不存在");
      // WHY：重试必须沿用首次已保存的上下文，新 body 不能覆盖；旧记录无快照时仅补录一次兼容快照。
      meta.contextSnapshot = readReadingContextSnapshot(saved.contextSnapshot) ?? meta.contextSnapshot;
      if (assistant.status === "completed" && assistant.content.trim()) { db.exec("COMMIT"); return assistant; }
      if (assistant.status === "streaming" && typeof saved.leaseUntil === "number" && saved.leaseUntil > Date.now()) throw new RequestError("原消息仍在生成，请停止后重试", 409, "request_in_progress");
    } else if (user) throw new RequestError("已有用户消息不能绑定另一个助手 ID");
    const now = new Date().toISOString();
    db.prepare("INSERT OR IGNORE INTO reading_threads (id, book_id, edition_id, chapter_id, paragraph_id, selected_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(threadId, meta.input.bookId, meta.input.editionId, meta.input.chapterId, meta.input.paragraphId, meta.input.selectedText, now, now);
    db.prepare("INSERT OR IGNORE INTO chat_messages (id, thread_id, role, content, raw_content, structured_output, status, model_name, prompt_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(meta.clientUserMessageId, threadId, "user", meta.input.question, meta.input.question, null, "completed", model, "v5", now);
    db.prepare("INSERT INTO chat_messages (id, thread_id, role, content, raw_content, structured_output, status, model_name, prompt_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content, raw_content = excluded.raw_content, structured_output = excluded.structured_output, status = excluded.status, model_name = excluded.model_name, prompt_version = excluded.prompt_version").run(meta.clientAssistantMessageId, threadId, "assistant", "", "", JSON.stringify({ _request: meta }), "streaming", model, "v5", new Date(Date.parse(now) + 1).toISOString());
    db.prepare("UPDATE reading_threads SET updated_at = ? WHERE id = ?").run(now, threadId);
    db.exec("COMMIT");
    return undefined;
  } catch (error: unknown) { db.exec("ROLLBACK"); throw error; }
}
function persistAssistant(db: Db, threadId: string, meta: RequestMeta, raw: string, status: "streaming" | "completed" | "error", analysis?: SavedAnalysis, failure?: Failure): void {
  // WHY：attemptId 是写入栅栏；已取消的旧请求不能覆盖后来重试成功的同一条消息。
  db.prepare("UPDATE chat_messages SET content = ?, raw_content = ?, structured_output = ?, status = ? WHERE id = ? AND thread_id = ? AND json_extract(structured_output, '$._request.attemptId') = ?").run(raw, raw, JSON.stringify({ ...analysis, _request: { ...meta, failure } }), status, meta.clientAssistantMessageId, threadId, meta.attemptId);
}
function buildContext(db: Db, input: Input, meta: RequestMeta) {
  const snapshot = meta.contextSnapshot;
  const { contextSettings, chatHistory: history } = snapshot;
  const compacted = compactContext(history, contextSettings);
  const rows = db.prepare("SELECT p.id, p.text FROM paragraphs p JOIN chapters c ON c.id = p.chapter_id WHERE c.edition_id = ?").all(input.editionId) as { id: string; text: string }[];
  const sources: CitationSource[] = rows.map((row) => ({ sourceId: sourceIdForParagraph(input.editionId, row.id), paragraphId: row.id, text: row.text }));
  const sourcePrompt = sources.slice(0, 200).map((source) => source.sourceId + " | paragraphId=" + source.paragraphId + " | 原文=" + source.text).join("\n");
  const content = ["模式：" + input.mode, "整本书：" + String(snapshot.bookTitle ?? "未知"), "当前章节：" + String(snapshot.chapterTitle ?? "未知"), "选中文本：" + (input.selectedText || "（本轮没有选中文本）"), "上下文：" + String(snapshot.context ?? ""), "本轮用户问题：" + input.question, "对话历史：" + JSON.stringify(compacted.messages), "压缩摘要：" + compacted.summary, "本书检索：" + JSON.stringify(snapshot.bookSearch), "可引用原文来源：\n" + sourcePrompt].join("\n");
  const instructions = input.mode === "analyze" ? "你是中文经典原著阅读助手。只基于原文、上下文和检索资料回答。只输出合法 JSON，字段为 summary、breakdown、concepts、context、uncertainty、citations。citations 中每项含 sourceId、paragraphId、quote。concepts.name 必须是选中文本里逐字出现的术语，不能用关系标题或概括句代替词条；概念释义放在 concepts.text。" : "你是句读阅读器的普通聊天助手。自然简洁回答当前问题，不要输出 JSON。";
  const messages: ProviderMessage[] = [{ role: "system", content: instructions }, { role: "user", content }];
  return { sources, contextSettings, compacted, messages };
}
const encoder = new TextEncoder();
const encode = (event: string, payload: unknown) => encoder.encode("event: " + event + "\ndata: " + JSON.stringify(payload) + "\n\n");
const streamHeaders = { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" };
function replayMessage(threadId: string, meta: RequestMeta, row: MessageRow): Response {
  const saved = parseSaved(row);
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(encode("meta", { threadId, mode: meta.input.mode, messageId: row.id, userMessageId: meta.clientUserMessageId, replayed: true }));
    controller.enqueue(encode("raw_delta", { text: row.content }));
    if (isAnalysis(saved)) {
      const result: Record<string, unknown> = { ...saved };
      delete result._request;
      controller.enqueue(encode("structured", { result, messageId: row.id }));
    }
    controller.enqueue(encode("done", { content: row.content, messageId: row.id }));
    controller.close();
  } });
  return new Response(stream, { headers: streamHeaders });
}
export async function POST(request: NextRequest) {
  let value: unknown;
  try { value = await request.json(); }
  catch (error: unknown) { console.error("读取阅读请求失败", error); return NextResponse.json({ error: "请求不是合法 JSON" }, { status: 400 }); }
  if (!isRecord(value)) return NextResponse.json({ error: "请求必须是对象" }, { status: 400 });
  const body = value;
  let db: Db | undefined;
  let meta: RequestMeta | undefined;
  let threadId = "";
  let reserved = false;
  try {
    if ((body.clientUserMessageId === undefined) !== (body.clientAssistantMessageId === undefined)) throw new RequestError("必须同时提供用户和助手消息 ID", 400, "invalid_id");
    threadId = requestId(body.threadId);
    const userId = requestId(body.clientUserMessageId);
    const assistantId = requestId(body.clientAssistantMessageId);
    if (userId === assistantId) throw new RequestError("用户和助手消息 ID 不能相同", 400, "invalid_id");
    const mode = body.mode === "chat" ? "chat" : "analyze";
    const input: Input = { mode, question: typeof body.question === "string" ? body.question : mode === "analyze" ? "请句读这一段" : "", selectedText: typeof body.selectedText === "string" ? body.selectedText : "", editionId: nullableString(body.editionId) ?? "demo", bookId: nullableString(body.bookId), chapterId: nullableString(body.chapterId), paragraphId: nullableString(body.paragraphId), selectionStart: typeof body.selectionStart === "number" ? body.selectionStart : null, selectionEnd: typeof body.selectionEnd === "number" ? body.selectionEnd : null };
    if (!input.question.trim() || (mode === "analyze" && !input.selectedText.trim())) throw new RequestError("问题或选中文本不能为空", 400, "invalid_input");
    meta = { version: 1, clientUserMessageId: userId, clientAssistantMessageId: assistantId, fingerprint: createHash("sha256").update(JSON.stringify(input)).digest("hex"), attemptId: randomUUID(), leaseUntil: Date.now() + TIMEOUT_MS + 10_000, input, contextSnapshot: captureReadingContext(body, [userId, assistantId]) };
    db = getDb();
    const config = readConfig(db);
    const replay = reserveMessages(db, threadId, meta, config.model);
    if (replay) return replayMessage(threadId, meta, replay);
    reserved = true;
    if (!config.apiKey.trim()) throw new RequestError("未配置 AI 服务，保存配置后可重试", 503, "not_configured");
    const context = buildContext(db, input, meta);
    if (context.compacted.compacted) db.prepare("INSERT INTO context_snapshots (id, thread_id, book_id, edition_id, summary, recent_messages, token_count, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), threadId, input.bookId, input.editionId, context.compacted.summary, JSON.stringify(context.compacted.messages), context.compacted.estimatedTokens, context.compacted.version, new Date().toISOString());
    return createReadingStream(request, db, threadId, meta, config, context);
  } catch (error: unknown) {
    console.error("创建阅读请求失败", error);
    const failure = { code: error instanceof RequestError ? error.code : "request_failed", message: error instanceof RequestError ? error.message : "读取请求失败，请重试", retryable: !(error instanceof RequestError) || error.status >= 500 || error.code === "request_in_progress" };
    if (reserved && db && meta) persistAssistant(db, threadId, meta, "", "error", undefined, failure);
    return NextResponse.json({ error: failure.message, ...failure, threadId, userMessageId: meta?.clientUserMessageId, messageId: meta?.clientAssistantMessageId }, { status: error instanceof RequestError ? error.status : 500 });
  }
}
function createReadingStream(request: NextRequest, db: Db, threadId: string, meta: RequestMeta, config: ProviderConfig, context: ReturnType<typeof buildContext>): Response {
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let sink: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let terminal = false;
  let raw = "";
  let lastSaved = 0;
  const send = (event: string, payload: unknown) => { if (!closed) sink.enqueue(encode(event, payload)); };
  const close = () => { if (!closed) { closed = true; sink.close(); } };
  const fail = (code: string, message: string) => {
    if (terminal) return;
    try { persistAssistant(db, threadId, meta, raw, "error", undefined, { code, message, retryable: true }); }
    catch (error: unknown) { console.error("保存失败状态失败", error); code = "persistence_failed"; message = "保存失败状态失败，请重试"; }
    terminal = true;
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", cancel);
    send("error", { code, message, retryable: true, messageId: meta.clientAssistantMessageId });
    close();
  };
  const cancel = () => {
    abort.abort();
    fail("cancelled", "已停止生成，可以重试");
    void reader?.cancel().catch((error: unknown) => console.error("取消上游消息流失败", error));
  };
  const timeout = setTimeout(() => { abort.abort(); fail("timeout", "模型响应超时，可以重试"); }, TIMEOUT_MS);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      sink = controller;
      send("meta", { threadId, mode: meta.input.mode, messageId: meta.clientAssistantMessageId, userMessageId: meta.clientUserMessageId });
      request.signal.addEventListener("abort", cancel, { once: true });
      async function pump() {
        let finished = false;
        const handle = (events: StreamEvent[]) => {
          for (const event of events) {
            if (terminal || finished) break;
            if (event.event === "error" || event.event === "response.failed") throw new Error("上游服务返回流式错误");
            if (event.data !== "[DONE]") {
              const payload: unknown = JSON.parse(event.data);
              if (isRecord(payload) && (payload.error || payload.type === "error")) throw new Error("上游服务返回流式错误");
            }
            const parsed = parseProviderSseEvent(event);
            if (parsed?.text) {
              raw += parsed.text;
              send("raw_delta", { text: parsed.text });
              if (Date.now() - lastSaved > 500) { persistAssistant(db, threadId, meta, raw, "streaming"); lastSaved = Date.now(); }
            }
            if (parsed?.done) finished = true;
          }
        };
        try {
          if (request.signal.aborted) { cancel(); return; }
          const upstream = await fetch(buildProviderUrl(config), { method: "POST", headers: buildProviderHeaders(config), body: JSON.stringify(buildProviderRequestBody(config, { messages: context.messages, temperature: 0.2, maxTokens: context.contextSettings.maxOutputTokens, stream: true })), signal: abort.signal });
          if (!upstream.ok || !upstream.body) { await upstream.body?.cancel(); throw new Error("AI 服务请求失败（HTTP " + upstream.status + "）"); }
          reader = upstream.body.getReader();
          const decoder = new SseDecoder();
          while (!terminal && !finished) {
            const part = await reader.read();
            if (part.done) { handle(decoder.finish()); break; }
            handle(decoder.push(part.value));
          }
          if (terminal) return;
          if (!finished) { fail("interrupted", "消息流中断，未收到完成确认，请重试"); return; }
          if (!raw.trim()) { fail("empty_output", "模型没有返回内容，请重试"); return; }
          let analysis: SavedAnalysis | undefined;
          if (meta.input.mode === "analyze") {
            const parsed = extractAnalysis(raw);
            const anchor = verifiedAnchor(db, meta.input);
            analysis = { ...parsed, citations: validateCitations(parsed.citations ?? [], context.sources, meta.clientAssistantMessageId), ...(anchor ? { anchor } : {}) };
          }
          persistAssistant(db, threadId, meta, raw, "completed", analysis);
          terminal = true;
          if (analysis) send("structured", { result: analysis, messageId: meta.clientAssistantMessageId });
          send("done", { content: raw, messageId: meta.clientAssistantMessageId });
          close();
        } catch (error: unknown) {
          console.error("阅读流式请求失败", error);
          fail(abort.signal.aborted ? "cancelled" : "upstream_failed", abort.signal.aborted ? "已停止生成，可以重试" : "模型生成失败，可以重试");
        } finally {
          clearTimeout(timeout);
          request.signal.removeEventListener("abort", cancel);
          if (reader) {
            try { await reader.cancel(); } catch (error: unknown) { console.error("释放上游消息流失败", error); }
            reader.releaseLock();
          }
        }
      }
      void pump().catch((error: unknown) => {
        console.error("持久化阅读消息失败", error);
        send("error", { code: "persistence_failed", message: "保存消息失败，请重试", retryable: true });
        close();
      });
    },
    cancel() { closed = true; cancel(); },
  });
  return new Response(stream, { headers: streamHeaders });
}
