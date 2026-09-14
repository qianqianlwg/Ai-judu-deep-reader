import type { HistoricalToolActivity, ToolActivity } from "./chat-stream";

export type ConversationSummary = {
  id: string; editionId: string; bookId: string | null; title: string;
  createdAt: string; updatedAt: string; messageCount: number;
};
export type ConversationMessage = {
  id: string; role: "user" | "assistant"; content: string; status: string;
  rawContent?: string | null; structuredOutput?: string | null; usageJson?: string | null;
  tools?: ToolActivity[]; historicalTools?: HistoricalToolActivity[]; warnings?: string[];
  modelName?: string; promptVersion?: string; createdAt?: string;
};
export type ConversationHistory = {
  threadId: string;
  thread: ConversationSummary & { chapterId?: string | null; paragraphId?: string | null; selectedText?: string | null };
  messages: ConversationMessage[];
};
export class ConversationInputError extends Error {
  constructor(message: string) { super(message); this.name = "ConversationInputError"; }
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const CONVERSATION_ID = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/u;
export function isConversationId(value: unknown): value is string {
  // WHY：列表、跳转和路由采用同一规则；完整匹配比较还能拒绝 $ 断言前的尾换行。
  return typeof value === "string" && CONVERSATION_ID.exec(value)?.[0] === value;
}
export function conversationId(value: unknown, label = "会话 ID"): string {
  if (!isConversationId(value)) throw new ConversationInputError(label + "不合法");
  return value;
}
export function conversationTitle(value: unknown): string {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/u.test(value)) throw new ConversationInputError("会话名称必须是单行文本");
  const title = value.trim();
  if (!title || Array.from(title).length > 80) throw new ConversationInputError("会话名称需为 1–80 个字符");
  return title;
}
function strictBody(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!record(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new ConversationInputError("会话请求包含未知字段或格式错误");
  return value;
}
export function conversationEditionQuery(params: URLSearchParams): string {
  if ([...params.keys()].some((key) => key !== "editionId") || params.getAll("editionId").length !== 1) throw new ConversationInputError("必须提供唯一的 editionId");
  return conversationId(params.get("editionId"), "书籍版本 ID");
}
export function newConversationInput(value: unknown): { editionId: string; title?: string; threadId?: string } {
  const body = strictBody(value, ["editionId", "title", "threadId"]);
  return { editionId: conversationId(body.editionId, "书籍版本 ID"), ...(body.title === undefined ? {} : { title: conversationTitle(body.title) }), ...(body.threadId === undefined ? {} : { threadId: conversationId(body.threadId) }) };
}
export function renameConversationInput(value: unknown): { editionId: string; title: string } {
  const body = strictBody(value, ["editionId", "title"]);
  return { editionId: conversationId(body.editionId, "书籍版本 ID"), title: conversationTitle(body.title) };
}
export function displayConversationTitle(title: string | null | undefined, firstQuestion?: string | null, selectedText?: string | null): string {
  if (title?.trim() && title.trim() !== "新会话") return title.trim();
  // WHY：旧会话没有 title 时仅生成展示名，不替换其 ID，也不迁移、覆盖原消息或选区。
  const question = firstQuestion?.trim();
  const text = question && !/^请?句读(?:一下|这一段|这段)?[。！!？?]?$/u.test(question) ? question : selectedText?.trim();
  if (!text) return "新会话";
  const characters = Array.from(text.replace(/\s+/gu, " "));
  return characters.slice(0, 28).join("") + (characters.length > 28 ? "…" : "");
}
export function isConversationSummary(value: unknown): value is ConversationSummary {
  return record(value) && isConversationId(value.id) && isConversationId(value.editionId) && (typeof value.bookId === "string" || value.bookId === null)
    && typeof value.title === "string" && typeof value.createdAt === "string" && typeof value.updatedAt === "string"
    && typeof value.messageCount === "number" && Number.isInteger(value.messageCount) && value.messageCount >= 0;
}
export function conversationFromRow(value: unknown): ConversationSummary {
  if (!record(value)) throw new Error("会话数据格式错误");
  const summary = { ...value, title: displayConversationTitle(typeof value.title === "string" ? value.title : null, typeof value.firstQuestion === "string" ? value.firstQuestion : null, typeof value.titleSelectedText === "string" ? value.titleSelectedText : typeof value.selectedText === "string" ? value.selectedText : null) };
  if (!isConversationSummary(summary)) throw new Error("会话数据不完整");
  return { id: summary.id, editionId: summary.editionId, bookId: summary.bookId, title: summary.title, createdAt: summary.createdAt, updatedAt: summary.updatedAt, messageCount: summary.messageCount };
}
export function canSelectConversation(conversations: ConversationSummary[], editionId: string, id: string, busy: boolean): boolean {
  return !busy && isConversationId(id) && isConversationId(editionId) && conversations.some((conversation) => conversation.id === id && conversation.editionId === editionId);
}

export function createConversationClient(fetcher: typeof fetch) {
  async function request(url: string, init?: RequestInit): Promise<unknown> {
    const response = await fetcher(url, init);
    let value: unknown;
    try { value = await response.json(); }
    catch (cause: unknown) { throw new Error("会话服务返回了无法读取的数据", { cause }); }
    if (!response.ok) throw new Error(record(value) && typeof value.error === "string" ? value.error : "会话请求失败（HTTP " + response.status + "）");
    return value;
  }
  const scopedUrl = (id: string, editionId: string) => "/api/threads/" + encodeURIComponent(conversationId(id)) + "?editionId=" + encodeURIComponent(conversationId(editionId, "书籍版本 ID"));
  const one = (value: unknown, editionId: string) => {
    if (!record(value) || !isConversationSummary(value.thread) || value.thread.editionId !== editionId) throw new Error("会话服务返回了错误的书籍版本");
    return value.thread;
  };
  return {
    async list(editionId: string, signal?: AbortSignal): Promise<ConversationSummary[]> {
      const value = await request("/api/threads?editionId=" + encodeURIComponent(conversationId(editionId, "书籍版本 ID")), { signal });
      if (!record(value) || !Array.isArray(value.threads) || !value.threads.every(isConversationSummary) || value.threads.some((thread) => thread.editionId !== editionId)) throw new Error("会话列表数据不合法或混入其他版本");
      return value.threads;
    },
    async create(input: { editionId: string; title?: string; threadId?: string }, signal?: AbortSignal): Promise<ConversationSummary> {
      const body = newConversationInput(input);
      const result = one(await request("/api/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal }), body.editionId);
      if (body.threadId && result.id !== body.threadId) throw new Error("创建响应与客户端会话 ID 不一致");
      return result;
    },
    async rename(id: string, editionId: string, title: string, signal?: AbortSignal): Promise<ConversationSummary> {
      const body = renameConversationInput({ editionId, title });
      const result = one(await request("/api/threads/" + encodeURIComponent(conversationId(id)), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal }), editionId);
      if (result.id !== id) throw new Error("会话服务返回了错误的会话 ID");
      return result;
    },
    async load(id: string, editionId: string, signal?: AbortSignal): Promise<ConversationHistory> {
      const value = await request(scopedUrl(id, editionId), { signal });
      const thread = one(value, editionId);
      if (!record(value) || value.threadId !== id || thread.id !== id || !Array.isArray(value.messages)
        || !value.messages.every((item) => record(item) && typeof item.id === "string" && (item.role === "user" || item.role === "assistant") && typeof item.content === "string" && typeof item.status === "string")) throw new Error("会话历史不合法");
      return { threadId: id, thread, messages: value.messages as ConversationMessage[] };
    },
  };
}

const PUBLIC_TOOLS = new Set(["search_book", "read_source", "save_reading_analysis"]);
const TOOL_FIELDS = new Set(["ok", "saved", "analysisId", "locationAvailable", "sources", "result", "summary", "breakdown", "label", "text", "concepts", "name", "context", "uncertainty", "citations", "sourceId", "paragraphId", "chapterId", "chapterTitle", "quote", "messageId", "anchor", "startOffset", "endOffset", "selectedText", "invalidConcepts"]);
type ToolDisplayJson = string | number | boolean | null | ToolDisplayJson[] | { [key: string]: ToolDisplayJson };
export function conversationToolFromRow(value: unknown, editionId: string): { messageId: string; tool: ToolActivity } | undefined {
  if (!record(value) || typeof value.id !== "string" || typeof value.messageId !== "string" || typeof value.name !== "string" || (value.status !== "running" && value.status !== "completed" && value.status !== "error")) {
    console.warn("历史工具记录格式不合法，未展示"); return;
  }
  const tool: ToolActivity = { id: value.id, name: PUBLIC_TOOLS.has(value.name) ? value.name : "unknown_tool", status: value.status };
  const finish = (result: unknown) => ({ messageId: value.messageId as string, tool: { ...tool, result } });
  if (!PUBLIC_TOOLS.has(value.name)) return finish({ message: "此工具尚无安全展示适配，历史输出已隐藏。" });
  if (typeof value.outputJson !== "string" || value.outputJson.length > 120000) return finish({ message: "历史工具输出过大或缺失，已省略。" });
  let output: unknown;
  try { output = JSON.parse(value.outputJson); }
  catch (error: unknown) { console.warn("读取历史工具结果失败", { id: value.id, reason: error instanceof Error ? error.name : "unknown" }); return finish({ message: "历史工具输出损坏，无法展示。" }); }
  if (!record(output)) return finish({ message: "工具未提供可安全展示的结构化结果。" });
  // WHY：错误文本可能包含内部异常或请求内容，历史只展示通用说明；绝不把审计输入/密钥/原始异常下发。
  if (output.ok === false || value.status === "error") return finish({ ok: false, message: "此工具执行未成功；请查看原回复中的提示或重试。" });
  let limited = false;
  const clean = (item: unknown, depth = 0): ToolDisplayJson | undefined => {
    if (depth > 7) { limited = true; return; }
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") { if (item.length > 2000) limited = true; return item.slice(0, 2000); }
    if (typeof item === "number") return Number.isFinite(item) ? item : undefined;
    if (Array.isArray(item)) { if (item.length > 24) limited = true; return item.slice(0, 24).flatMap((entry) => { const saved = clean(entry, depth + 1); return saved === undefined ? [] : [saved]; }); }
    if (!record(item)) return;
    if ("sourceId" in item && (typeof item.sourceId !== "string" || typeof item.paragraphId !== "string" || item.sourceId !== "book:" + editionId + ":paragraph:" + item.paragraphId)) { limited = true; return; }
    const saved: { [key: string]: ToolDisplayJson } = {};
    for (const [key, entry] of Object.entries(item)) {
      if (!TOOL_FIELDS.has(key)) continue;
      const next = clean(entry, depth + 1);
      if (next !== undefined) saved[key] = next;
    }
    return saved;
  };
  const result = clean(output);
  return finish(record(result) ? { ...result, ...(limited ? { displayLimited: true } : {}) } : { message: "没有可安全展示的工具字段。" });
}
