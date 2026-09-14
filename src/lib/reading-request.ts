import { decodeChatEvent, isAnalysis, isRecord, type Analysis, type ChatEvent, type ChatMessage, type ToolActivity, type TokenUsage } from "./chat-stream";
import { DEFAULT_CONTEXT_SETTINGS, type ContextMessage, type ContextSettings } from "./context-compaction";
import { SseDecoder } from "./sse";

export type ReadingAnchor = { paragraphId: string; startOffset: number; endOffset: number; selectedText: string };

export type RetryContextSettings = Pick<ContextSettings, "maxInputTokens" | "maxOutputTokens">;
export function readRetryContextSettings(value: unknown): RetryContextSettings {
  if (!isRecord(value) || !Number.isSafeInteger(value.maxInputTokens) || !Number.isSafeInteger(value.maxOutputTokens) || (value.maxInputTokens as number) < 4096 || (value.maxInputTokens as number) > 131072 || (value.maxOutputTokens as number) < 1024 || (value.maxOutputTokens as number) > 16384) throw new Error("重试预算须为有效的输入/输出 Token 整数上限");
  return { maxInputTokens: value.maxInputTokens as number, maxOutputTokens: value.maxOutputTokens as number };
}
export function withRetryContextSettings(state: ReadingRequestState, value: RetryContextSettings): ReadingRequestState {
  if (state.status !== "error" && state.status !== "cancelled") throw new Error("只有未完成的消息可调整重试预算");
  // WHY：只更新执行预算；问题、原文、历史快照和两个消息ID仍沿用首次提交。
  return { ...state, payload: { ...state.payload, retryContextSettings: readRetryContextSettings(value) } };
}
export type ReadingRequestInput = {
  retryContextSettings?: RetryContextSettings;
  mode: "chat" | "analyze";
  question: string;
  selectedText: string;
  threadId?: string;
  bookId?: string;
  editionId?: string;
  chapterId?: string;
  paragraphId?: string;
  bookTitle?: string;
  chapterTitle?: string;
  context?: string;
  selectionStart?: number;
  selectionEnd?: number;
  textHash?: string;
  contextSettings?: ContextSettings;
  chatHistory?: ContextMessage[];
  bookSearch?: unknown[];
};
export type ReadingContextSnapshot = {
  version: 1;
  bookTitle?: string;
  chapterTitle?: string;
  context?: string;
  textHash?: string;
  contextSettings: ContextSettings;
  chatHistory: ContextMessage[];
  bookSearch: unknown[];
};
type SnapshotJson = string | number | boolean | null | SnapshotJson[] | { [key: string]: SnapshotJson };
const SEARCH_CONTEXT_FIELDS = new Set([
  "id", "sourceId", "paragraphId", "chapterId", "chapterTitle", "bookId", "bookTitle", "editionId", "sourceType",
  "text", "quote", "content", "excerpt", "matchedText", "startOffset", "endOffset", "paragraphIndex", "orderIndex",
  "context", "before", "after", "retrieval", "backend", "keywordScore", "vectorSimilarity", "rrfScore", "vectorUsed",
  "score", "rank", "distance", "similarity", "keywordRank", "vectorRank", "title", "author",
]);
function searchSnapshotValue(value: unknown, depth = 0): SnapshotJson | undefined {
  if (depth > 8) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.flatMap((item) => { const saved = searchSnapshotValue(item, depth + 1); return saved === undefined ? [] : [saved]; });
  if (!isRecord(value)) return undefined;
  const saved: { [key: string]: SnapshotJson } = {};
  for (const [key, item] of Object.entries(value)) {
    if (!SEARCH_CONTEXT_FIELDS.has(key)) continue;
    const result = searchSnapshotValue(item, depth + 1);
    if (result !== undefined) saved[key] = result;
  }
  return saved;
}
export function captureReadingContext(value: unknown, excludedMessageIds: readonly string[] = []): ReadingContextSnapshot {
  const body = isRecord(value) ? value : {};
  const settings = isRecord(body.contextSettings) ? body.contextSettings : {};
  const optionalString = (item: unknown) => typeof item === "string" ? item : undefined;
  const bounded = (item: unknown, min: number, max: number, fallback: number) => typeof item === "number" && Number.isFinite(item) ? Math.max(min, Math.min(max, item)) : fallback;
  const contextSettings: ContextSettings = {
    maxInputTokens: bounded(settings.maxInputTokens, 4096, 131072, DEFAULT_CONTEXT_SETTINGS.maxInputTokens),
    maxOutputTokens: bounded(settings.maxOutputTokens, 1024, 16384, DEFAULT_CONTEXT_SETTINGS.maxOutputTokens),
    compressionStrategy: settings.compressionStrategy === "conservative" || settings.compressionStrategy === "aggressive" ? settings.compressionStrategy : "balanced",
  };
  // WHY：只保存阅读上下文白名单，不复制整个请求、Provider 配置、鉴权或隐藏在检索元数据里的密钥。
  const chatHistory: ContextMessage[] = Array.isArray(body.chatHistory) ? body.chatHistory.flatMap((item) => {
    if (!isRecord(item) || (item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string" || item.status === "error" || item.status === "streaming" || (typeof item.id === "string" && excludedMessageIds.includes(item.id))) return [];
    return [{ role: item.role, content: item.content, ...(typeof item.id === "string" ? { id: item.id } : {}) }];
  }) : [];
  const bookSearch = Array.isArray(body.bookSearch) ? body.bookSearch.slice(0, 8).flatMap((item) => { const saved = searchSnapshotValue(item); return saved === undefined ? [] : [saved]; }) : [];
  return { version: 1, bookTitle: optionalString(body.bookTitle), chapterTitle: optionalString(body.chapterTitle), context: optionalString(body.context), textHash: optionalString(body.textHash), contextSettings, chatHistory, bookSearch };
}
export function readReadingContextSnapshot(value: unknown): ReadingContextSnapshot | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.contextSettings) || !Array.isArray(value.chatHistory) || !Array.isArray(value.bookSearch)) throw new Error("已保存的上下文快照损坏");
  const settings = value.contextSettings;
  if (typeof settings.maxInputTokens !== "number" || !Number.isFinite(settings.maxInputTokens) || typeof settings.maxOutputTokens !== "number" || !Number.isFinite(settings.maxOutputTokens) || !["conservative", "balanced", "aggressive"].includes(String(settings.compressionStrategy))) throw new Error("已保存的上下文设置损坏");
  return captureReadingContext(value);
}

export type ReadingRequestPayload = ReadingRequestInput & {
  threadId: string;
  clientUserMessageId: string;
  clientAssistantMessageId: string;
};
export type ReadingRequestState = {
  payload: ReadingRequestPayload;
  status: "idle" | "streaming" | "completed" | "error" | "cancelled";
  attempt: number;
  content: string;
  analysis?: Analysis & { anchor?: ReadingAnchor };
  error?: string;
  usage?: TokenUsage;
  tools?: ToolActivity[];
  warnings?: string[];
  outputFormat?: "text" | "legacy-json";
};

export function createReadingRequest(input: ReadingRequestInput, makeId = () => crypto.randomUUID()): ReadingRequestState {
  if (!input.question.trim()) throw new Error("问题不能为空");
  if (input.mode === "analyze" && !input.selectedText.trim()) throw new Error("没有选中文本");
  // WHY：重试使用第一次提交的完整输入快照，不受切书、选区或当前输入框变化影响。
  const payload = structuredClone({ ...input, threadId: input.threadId || makeId(), clientUserMessageId: makeId(), clientAssistantMessageId: makeId() });
  return { payload, status: "idle", attempt: 0, content: "" };
}

type StoredReadingMessage = { id: string; role: string; content: string; status: string; structuredOutput?: string | null };
export function restoreReadingRequest(threadId: string, message: StoredReadingMessage, chatHistory: ContextMessage[] = []): ReadingRequestState | null {
  // WHY：刷新后从已保存的请求身份恢复失败消息；旧消息没有元数据时不猜选区、不生成新身份冒充重试。
  if (message.role !== "assistant" || !message.structuredOutput) return null;
  const saved: unknown = JSON.parse(message.structuredOutput);
  if (!isRecord(saved) || !isRecord(saved._request)) return null;
  const meta = saved._request;
  const input = meta.input;
  if (meta.version !== 1 || typeof meta.clientUserMessageId !== "string" || meta.clientAssistantMessageId !== message.id || !isRecord(input) || (input.mode !== "chat" && input.mode !== "analyze") || typeof input.question !== "string" || typeof input.selectedText !== "string") throw new Error("已保存的重试请求不完整");
  const optionalString = (value: unknown) => typeof value === "string" ? value : undefined;
  const snapshot = readReadingContextSnapshot(meta.contextSnapshot);
  const failure = isRecord(meta.failure) ? meta.failure : undefined;
  const status = message.status === "completed" && message.content.trim() ? "completed" : failure?.code === "cancelled" ? "cancelled" : "error";
  return {
    payload: { threadId, clientUserMessageId: meta.clientUserMessageId, clientAssistantMessageId: message.id, mode: input.mode, question: input.question, selectedText: input.selectedText, editionId: optionalString(input.editionId), bookId: optionalString(input.bookId), chapterId: optionalString(input.chapterId), paragraphId: optionalString(input.paragraphId), selectionStart: typeof input.selectionStart === "number" ? input.selectionStart : undefined, selectionEnd: typeof input.selectionEnd === "number" ? input.selectionEnd : undefined, ...(snapshot ? { bookTitle: snapshot.bookTitle, chapterTitle: snapshot.chapterTitle, context: snapshot.context, textHash: snapshot.textHash, contextSettings: snapshot.contextSettings, chatHistory: snapshot.chatHistory, bookSearch: snapshot.bookSearch } : { chatHistory: structuredClone(chatHistory) }) },
    status, attempt: 1, content: message.content, analysis: isAnalysis(saved) ? saved : undefined,
    error: status === "completed" ? undefined : typeof failure?.message === "string" ? failure.message : "上次生成未完成，可以重试",
  };
}

export function beginReadingRequest(state: ReadingRequestState, messages: ChatMessage[]): { state: ReadingRequestState; messages: ChatMessage[] } {
  if (state.status === "streaming" || state.status === "completed") throw new Error("当前请求不能重试");
  const next: ReadingRequestState = { ...state, status: "streaming", attempt: state.attempt + 1, content: "", analysis: undefined, usage: undefined, tools: [], warnings: [], outputFormat: "text", error: undefined };
  return { state: next, messages: applyReadingRequest(messages, next) };
}

export function applyReadingRequest(messages: ChatMessage[], state: ReadingRequestState): ChatMessage[] {
  const { clientUserMessageId: userId, clientAssistantMessageId: assistantId, question, mode } = state.payload;
  const user = messages.find((message) => message.id === userId);
  const assistant = messages.find((message) => message.id === assistantId);
  if (user && (user.role !== "user" || user.content !== question)) throw new Error("重试用户消息不匹配");
  if (assistant && assistant.role !== "assistant") throw new Error("重试助手消息不匹配");
  const { paragraphId, selectionStart, selectionEnd, selectedText } = state.payload;
  const anchor = paragraphId && selectionStart !== undefined && selectionEnd !== undefined ? {paragraphId,startOffset:selectionStart,endOffset:selectionEnd,selectedText} : undefined;
  const next = messages.map(message => {
    const sameAnchor = message.anchor?.paragraphId === anchor?.paragraphId && message.anchor?.startOffset === anchor?.startOffset && message.anchor?.endOffset === anchor?.endOffset && message.anchor?.selectedText === anchor?.selectedText;
    return message.id === userId && !sameAnchor ? { ...message, anchor } : message;
  });
  if (!user) next.push({ id: userId, role: "user", kind: "chat", anchor, content: question, status: "completed" });
  const replacement: ChatMessage = { id: assistantId, anchor, role: "assistant", kind: mode === "analyze" ? "analysis" : "chat", content: state.content, analysis: state.analysis, outputFormat: state.outputFormat ?? "text", usage: state.usage, tools: state.tools, warnings: state.warnings, status: state.status === "completed" ? "completed" : state.status === "streaming" ? "streaming" : "error" };
  const index = next.findIndex((message) => message.id === assistantId);
  // WHY：只替换原助手消息；后续对话的位置和原用户消息不动，也不把旧的半截回答拼进重试结果。
  if (index >= 0) next[index] = replacement;
  else next.splice(next.findIndex((message) => message.id === userId) + 1, 0, replacement);
  return next;
}

function endPendingTools(tools: ToolActivity[] | undefined): ToolActivity[] | undefined {
  return tools?.map(tool => tool.status === "running" ? { ...tool, status: "error", result: { ok: false, message: "本轮生成已结束，工具未完成" } } : tool);
}

export function reduceReadingRequest(state: ReadingRequestState, event: ChatEvent): ReadingRequestState {
  if (state.status !== "streaming") return state;
  switch (event.type) {
    case "meta":
      if (event.threadId !== state.payload.threadId || (event.messageId && event.messageId !== state.payload.clientAssistantMessageId)) throw new Error("服务端返回了其他请求的消息 ID");
      return event.outputFormat ? { ...state, outputFormat: event.outputFormat } : state;
    case "raw_delta": return { ...state, content: state.content + event.text };
    case "structured": return { ...state, analysis: event.result };
    case "usage": return { ...state, usage: event.usage };
    case "tool": return { ...state, tools: [...(state.tools ?? []).filter(tool => tool.id !== event.tool.id), event.tool] };
    case "warning": return { ...state, warnings: [...(state.warnings ?? []), event.message] };
    case "error": return { ...state, status: "error", error: event.message, tools: endPendingTools(state.tools) };
    case "done": {
      const content = event.content ?? state.content;
      return content.trim() ? { ...state, content, status: "completed" } : { ...state, status: "error", error: "模型没有返回内容，请重试" };
    }
  }
}

type ExecutionOptions = {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  onState?: (state: ReadingRequestState) => void;
  onEvent?: (event: ChatEvent) => void;
};
export async function executeReadingRequest(started: ReadingRequestState, options: ExecutionOptions = {}): Promise<ReadingRequestState> {
  if (started.status !== "streaming") throw new Error("请先调用 beginReadingRequest");
  let state = started;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const publish = (next: ReadingRequestState) => { state = next; options.onState?.(state); };
  const cancelled = () => {
    if (state.status !== "streaming") return;
    publish({ ...state, status: "cancelled", error: "已停止生成，可以重试", tools: endPendingTools(state.tools) });
    void reader?.cancel().catch((error: unknown) => console.error("取消聊天流失败", error));
  };
  const consume = (events: ReturnType<SseDecoder["push"]>) => {
    for (const rawEvent of events) {
      if (state.status !== "streaming") break;
      const event = decodeChatEvent(rawEvent);
      if (!event) continue;
      publish(reduceReadingRequest(state, event));
      options.onEvent?.(event);
    }
  };
  options.signal?.addEventListener("abort", cancelled, { once: true });
  try {
    if (options.signal?.aborted) { cancelled(); return state; }
    // WHY：本轮消息只在问题字段出现一次，不把失败占位消息当作新的历史交给模型。
    const { clientUserMessageId, clientAssistantMessageId } = state.payload;
    const chatHistory = state.payload.chatHistory?.filter((message) => message.id !== clientUserMessageId && message.id !== clientAssistantMessageId);
    const response = await (options.fetcher ?? fetch)("/api/analyze/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...state.payload, chatHistory }), signal: options.signal });
    if (!response.ok) {
      const text = await response.text();
      let message = "句读请求失败（HTTP " + response.status + "），请重试";
      try { const value: unknown = JSON.parse(text); if (value && typeof value === "object" && "error" in value && typeof value.error === "string") message = value.error; }
      catch (error: unknown) { console.error("读取请求错误说明失败", error); }
      throw new Error(message);
    }
    if (!response.body) throw new Error("服务没有返回消息流，请重试");
    reader = response.body.getReader();
    const decoder = new SseDecoder();
    while (state.status === "streaming") {
      const chunk = await reader.read();
      if (chunk.done) { consume(decoder.finish()); break; }
      consume(decoder.push(chunk.value));
    }
    if (state.status === "streaming") publish({ ...state, status: "error", error: "消息流中断，未收到完成确认，请重试", tools: endPendingTools(state.tools) });
  } catch (error: unknown) {
    if (options.signal?.aborted) cancelled();
    else { console.error("阅读请求失败", error); publish({ ...state, status: "error", error: error instanceof Error ? error.message : "生成失败，请重试", tools: endPendingTools(state.tools) }); }
  } finally {
    options.signal?.removeEventListener("abort", cancelled);
    if (reader) {
      try { await reader.cancel(); } catch (error: unknown) { console.error("释放聊天流失败", error); }
      reader.releaseLock();
    }
  }
  return state;
}
