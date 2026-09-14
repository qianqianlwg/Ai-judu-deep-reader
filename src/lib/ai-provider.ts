export type AiProviderKind = "openai" | "claude";
export type ProviderConfig = { provider: AiProviderKind; baseUrl: string; apiKey: string; model: string };
export type ProviderMessage = { role: "system" | "user" | "assistant"; content: string };
export type ProviderRequest = { messages: ProviderMessage[]; temperature?: number; maxTokens?: number; stream?: boolean };
type ClaudeMessage = { role: "user" | "assistant"; content: string };
export type OpenAiRequestBody = { model: string; messages: ProviderMessage[]; temperature?: number; max_tokens: number; stream: boolean };
export type ClaudeRequestBody = { model: string; system?: string; messages: ClaudeMessage[]; temperature?: number; max_tokens: number; stream: boolean };
export type ProviderRequestBody = OpenAiRequestBody | ClaudeRequestBody;
export type ProviderDelta = { text: string; done: boolean };
export type ProviderSseEvent = { event: string; data: string };

export function normalizeProviderBaseUrl(config: ProviderConfig): string {
  const url = new URL(config.baseUrl.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("AI 地址必须是无账号、查询参数的 HTTP(S) 地址");
  let path = url.pathname.replace(/\/+$/u, "");
  // WHY：连接测试和实际 Agent 共用规范化，防止 Claude 出现 /v1/v1/messages。
  path = config.provider === "claude" ? path.replace(/(?:\/v1)?\/messages$/u, "").replace(/\/v1$/u, "") : path.replace(/\/(?:chat\/completions|responses)$/u, "");
  return url.origin + path;
}
function positiveInteger(value: number | undefined): number { return value !== undefined && Number.isInteger(value) && value > 0 ? value : 4096; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object"; }
function isClaudeMessage(message: ProviderMessage): message is ClaudeMessage { return message.role !== "system"; }
function stringValue(value: unknown): string | null { return typeof value === "string" ? value : null; }

export function buildProviderUrl(config: ProviderConfig): string {
  const base = normalizeProviderBaseUrl(config);
  return config.provider === "openai" ? `${base}/chat/completions` : `${base}/v1/messages`;
}
export function buildProviderHeaders(config: ProviderConfig): Record<string, string> {
  if (!config.apiKey.trim()) throw new Error("AI API Key 不能为空");
  const common = { "Content-Type": "application/json", Accept: "text/event-stream" };
  return config.provider === "openai" ? { ...common, Authorization: `Bearer ${config.apiKey}` } : { ...common, "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" };
}
export function buildProviderRequestBody(config: ProviderConfig, request: ProviderRequest): ProviderRequestBody {
  if (!config.model.trim()) throw new Error("AI 模型名称不能为空");
  const common = { model: config.model, temperature: request.temperature, max_tokens: positiveInteger(request.maxTokens), stream: request.stream ?? true };
  if (config.provider === "openai") return { ...common, messages: request.messages };
  const system = request.messages.find((message) => message.role === "system")?.content;
  return { ...common, ...(system ? { system } : {}), messages: request.messages.filter(isClaudeMessage) };
}
function openAiDelta(payload: Record<string, unknown>): ProviderDelta | null {
  const choices = payload.choices;
  if (!Array.isArray(choices) || !isRecord(choices[0])) return null;
  const delta = choices[0].delta;
  const text = isRecord(delta) ? stringValue(delta.content) : null;
  const finish = stringValue(choices[0].finish_reason);
  return text !== null || finish !== null ? { text: text ?? "", done: finish !== null } : null;
}
function claudeDelta(event: string, payload: Record<string, unknown>): ProviderDelta | null {
  if (event === "content_block_delta") {
    const delta = payload.delta;
    const text = isRecord(delta) && delta.type === "text_delta" ? stringValue(delta.text) : null;
    return text === null ? null : { text, done: false };
  }
  return event === "message_stop" ? { text: "", done: true } : null;
}
export function parseProviderSseEvent(event: ProviderSseEvent): ProviderDelta | null {
  if (event.data === "[DONE]") return { text: "", done: true };
  let parsed: unknown;
  try { parsed = JSON.parse(event.data) as unknown; } catch { throw new Error("AI 流式事件不是合法 JSON"); }
  if (!isRecord(parsed)) return null;
  return claudeDelta(event.event, parsed) ?? openAiDelta(parsed);
}
