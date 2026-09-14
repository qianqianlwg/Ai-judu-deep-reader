import type { StreamEvent } from "./sse";

export type Citation = { sourceId: string; paragraphId: string; quote: string; messageId?: string };
export type Analysis = { summary: string; breakdown: { label: string; text: string }[]; concepts: { name: string; text: string }[]; context: string; uncertainty: string; citations?: Citation[] };
export type MessageAnchor = { paragraphId: string; startOffset: number; endOffset: number; selectedText: string };
export type ChatMessage = { anchor?: MessageAnchor; id?: string; role: "user" | "assistant"; kind?: "chat" | "analysis"; content: string; analysis?: Analysis; status?: "streaming" | "completed" | "error" };
export type ChatEvent =
  | { type: "meta"; threadId: string; messageId?: string }
  | { type: "raw_delta"; text: string }
  | { type: "structured"; result: Analysis; messageId?: string }
  | { type: "done"; content?: string }
  | { type: "error"; message: string };
export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
export function isAnalysis(value: unknown): value is Analysis {
  return isRecord(value) && typeof value.summary === "string" && typeof value.context === "string" && typeof value.uncertainty === "string"
    && Array.isArray(value.breakdown) && value.breakdown.every((item) => isRecord(item) && typeof item.label === "string" && typeof item.text === "string")
    && Array.isArray(value.concepts) && value.concepts.every((item) => isRecord(item) && typeof item.name === "string" && typeof item.text === "string");
}
function decodePartialJsonString(value: string): string { try { return JSON.parse('"' + value + '"') as string; } catch { return value.replace(/\\n/gu, "\n").replace(/\\"/gu, '"'); } }
export function streamingPreview(content: string, kind: ChatMessage["kind"] = "chat"): string {
  if (kind !== "analysis") return content;
  if (!content.trim()) return "正在生成句读…";
  const match = content.match(/"summary"\s*:\s*"/u);
  if (!match || match.index === undefined) return content.trimStart().startsWith("{") ? "正在整理句读…" : content;
  const start = match.index + match[0].length;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (escaped) { escaped = false; continue; }
    if (character === "\\") { escaped = true; continue; }
    if (character === '"') return decodePartialJsonString(content.slice(start, index));
  }
  return decodePartialJsonString(content.slice(start));
}
export function decodeChatEvent(event: StreamEvent): ChatEvent | null {
  const data: unknown = JSON.parse(event.data);
  if (!isRecord(data)) throw new Error("聊天流返回了无效的数据");
  if (event.event === "meta" && typeof data.threadId === "string") return { type: "meta", threadId: data.threadId, messageId: typeof data.messageId === "string" ? data.messageId : undefined };
  if (event.event === "raw_delta" && typeof data.text === "string") return { type: "raw_delta", text: data.text };
  if (event.event === "structured" && isAnalysis(data.result)) return { type: "structured", result: data.result, messageId: typeof data.messageId === "string" ? data.messageId : undefined };
  if (event.event === "done") return { type: "done", content: typeof data.content === "string" ? data.content : undefined };
  if (event.event === "error") return { type: "error", message: typeof data.message === "string" ? data.message : "生成失败，请重试" };
  throw new Error("聊天流包含无法识别的事件：" + event.event);
}
export function applyChatEvent(messages: ChatMessage[], assistantId: string, event: ChatEvent): ChatMessage[] {
  if (event.type === "meta") return messages;
  // WHY：所有增量都更新同一个消息 ID，避免历史快照替换正在生成的消息。
  return messages.map((message) => {
    if (message.id !== assistantId || message.role !== "assistant") return message;
    switch (event.type) {
      case "raw_delta": return { ...message, content: message.content + event.text, status: "streaming" };
      case "structured": return { ...message, kind: "analysis", analysis: event.result };
      case "done": return { ...message, content: event.content ?? message.content, status: "completed" };
      case "error": return { ...message, status: "error" };
    }
  });
}
