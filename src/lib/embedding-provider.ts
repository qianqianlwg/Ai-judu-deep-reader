import { createHash } from "node:crypto";

export const EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-8B";
export const EMBEDDING_BASE_URL = "https://api.siliconflow.cn/v1";
export const EMBEDDING_URL = `${EMBEDDING_BASE_URL}/embeddings`;
export const EMBEDDING_DIMENSIONS = 1024;
export const EMBEDDING_REQUEST_TIMEOUT_MS = 60_000;
export const EMBEDDING_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
// WHY：租约覆盖 4 次最长请求和 7 秒退让，避免长重试被误判失联后重复付费。
export const EMBEDDING_BATCH_LEASE_MS = 300_000;
// WHY：模型、维度、切块协议一起标识向量空间，绝不把不同模型的向量混合比较。
export const EMBEDDING_PROFILE = `${EMBEDDING_URL}|${EMBEDDING_MODEL}|${EMBEDDING_DIMENSIONS}|chunks-v1`;

export type EmbeddingConfig = { apiKey: string; baseUrl?: string; model?: string; dimensions?: number | null };
export type RetryWait = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function normalizeEmbeddingBaseUrl(value: string): string {
  if (!value.trim() || value.trim().length > 2_048) throw new EmbeddingError("请输入有效的 Embeddings API 地址");
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new EmbeddingError("Embeddings API 地址必须是有效的 HTTP(S) 地址"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new EmbeddingError("Embeddings API 地址不可包含账号、查询参数或片段");
  }
  let pathname = url.pathname.replace(/\/+$/u, "");
  // WHY：兼容用户填写 OpenAI 风格 base URL 或完整 /embeddings 地址，避免重复拼接端点。
  pathname = pathname.replace(/\/embeddings$/u, "");
  return url.origin + pathname;
}

export function embeddingEndpoint(config: EmbeddingConfig): string {
  return `${normalizeEmbeddingBaseUrl(config.baseUrl ?? EMBEDDING_BASE_URL)}/embeddings`;
}

export function embeddingModel(config: EmbeddingConfig): string {
  const model = config.model?.trim() || EMBEDDING_MODEL;
  if (model.length > 200 || /[\r\n\x00-\x1f]/u.test(model)) throw new EmbeddingError("Embedding 模型名称无效");
  return model;
}

export function embeddingDimensions(config: EmbeddingConfig): number | null {
  const dimensions = config.dimensions === undefined ? EMBEDDING_DIMENSIONS : config.dimensions;
  if (dimensions !== null && (!Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > 16_384)) {
    throw new EmbeddingError("向量维度必须是 1–16384 的整数，或留空由模型决定");
  }
  return dimensions;
}

export function embeddingProfile(config: EmbeddingConfig): string {
  const endpoint = embeddingEndpoint(config);
  const model = embeddingModel(config);
  const dimensions = embeddingDimensions(config);
  if (endpoint === EMBEDDING_URL && model === EMBEDDING_MODEL && dimensions === EMBEDDING_DIMENSIONS) return EMBEDDING_PROFILE;
  // WHY：模型、API、维度变更必须落入不同索引空间，防止把旧向量误当成新模型结果。
  const identity = `${endpoint}|${model}|${dimensions ?? "auto"}|chunks-v1`;
  return `embedding-v1:${createHash("sha256").update(identity).digest("hex")}`;
}
export function validateVector(value: unknown, dimensions: number | null = EMBEDDING_DIMENSIONS): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16_384 || (dimensions !== null && value.length !== dimensions) || value.some(n => typeof n !== "number" || !Number.isFinite(n)) || !value.some(n => n !== 0)) {
    throw new EmbeddingError("向量服务返回了无效的维度或数值");
  }
  return value as number[];
}

function containsSourceExcerpt(message: string, texts: readonly string[]): boolean {
  const minimumLength = 12;
  const sourceWindows = new Set<string>();
  for (const text of texts) {
    const characters = Array.from(text);
    if (characters.length < minimumLength) {
      if (characters.length >= 8 && message.includes(text)) return true;
      continue;
    }
    for (let index = 0; index <= characters.length - minimumLength; index++) {
      sourceWindows.add(characters.slice(index, index + minimumLength).join(""));
    }
  }
  const messageCharacters = Array.from(message);
  for (let index = 0; index <= messageCharacters.length - minimumLength; index++) {
    if (sourceWindows.has(messageCharacters.slice(index, index + minimumLength).join(""))) return true;
  }
  return false;
}

function safeDiagnostic(message: string, apiKey: string, texts: readonly string[]): string {
  let safe = message.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  if (apiKey) safe = safe.split(apiKey).join("[API Key 已隐藏]");
  safe = safe
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [凭据已隐藏]")
    .replace(/\b(?:sk|sf)-[A-Za-z0-9_-]{8,}\b/giu, "[凭据已隐藏]")
    .slice(0, 500);
  if (containsSourceExcerpt(safe, texts)) return "服务端错误信息包含书籍原文片段，已隐藏";
  return safe;
}

async function providerErrorDetail(response: Response, apiKey: string, texts: readonly string[]): Promise<string> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return "";
  }
  if (!record(body)) return "";

  const error = body.error;
  const message = typeof error === "string"
    ? error
    : record(error) && typeof error.message === "string"
      ? error.message
      : typeof body.message === "string"
        ? body.message
        : typeof body.error_description === "string"
          ? body.error_description
          : "";
  const code = record(error) ? error.code : body.code;
  const safeCode = typeof code === "string" || typeof code === "number"
    ? safeDiagnostic(String(code), apiKey, texts)
    : "";
  const safeMessage = message ? safeDiagnostic(message, apiKey, texts) : "";
  return [safeCode && `错误代码 ${safeCode}`, safeMessage].filter(Boolean).join("：");
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function withRetryCount(message: string, retries: number): string {
  return retries > 0 ? `${message}（已重试 ${retries} 次）` : message;
}

const waitBeforeRetry: RetryWait = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(new EmbeddingError("向量请求已取消"));
    return;
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, milliseconds);
  const onAbort = () => {
    clearTimeout(timer);
    reject(new EmbeddingError("向量请求已取消"));
  };
  signal?.addEventListener("abort", onAbort, { once: true });
});

export async function embedTexts(
  config: EmbeddingConfig,
  texts: readonly string[],
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
  onUsage?: (usage: { promptTokens: number }) => void,
  wait: RetryWait = waitBeforeRetry,
): Promise<number[][]> {
  if (!config.apiKey.trim()) throw new EmbeddingError("请先在设置中保存向量模型 API Key");
  const endpoint = embeddingEndpoint(config);
  const model = embeddingModel(config);
  const dimensions = embeddingDimensions(config);
  if (!texts.length || texts.length > 32 || texts.some(text => !text.trim() || Array.from(text).length > 6000)) {
    throw new EmbeddingError("向量输入长度或批量数量不合法");
  }

  let retries = 0;
  while (true) {
    const timeout = AbortSignal.timeout(EMBEDDING_REQUEST_TIMEOUT_MS);
    const attemptSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model, input: texts, encoding_format: "float", ...(dimensions === null ? {} : { dimensions }) }),
        signal: attemptSignal,
      });
    } catch (cause: unknown) {
      if (signal?.aborted) throw new EmbeddingError("向量请求已取消");
      const original = cause instanceof Error ? cause.message : String(cause);
      const diagnostic = safeDiagnostic(original, config.apiKey, texts);
      if (retries < EMBEDDING_RETRY_DELAYS_MS.length) {
        await wait(EMBEDDING_RETRY_DELAYS_MS[retries], signal);
        retries++;
        continue;
      }
      throw new EmbeddingError(withRetryCount(`向量服务连接失败或超时${diagnostic ? `：${diagnostic}` : ""}`, retries));
    }

    if (!response.ok) {
      const detail = await providerErrorDetail(response, config.apiKey, texts);
      const original = `向量服务返回 HTTP ${response.status}${detail ? `：${detail}` : ""}`;
      if (retryableStatus(response.status) && retries < EMBEDDING_RETRY_DELAYS_MS.length) {
        await wait(EMBEDDING_RETRY_DELAYS_MS[retries], signal);
        retries++;
        continue;
      }
      throw new EmbeddingError(withRetryCount(original, retries));
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause: unknown) {
      const original = cause instanceof Error ? cause.message : String(cause);
      const diagnostic = safeDiagnostic(original, config.apiKey, texts);
      throw new EmbeddingError(`向量服务返回了无效 JSON${diagnostic ? `：${diagnostic}` : ""}`);
    }
    if (!record(body) || !Array.isArray(body.data) || body.data.length !== texts.length) {
      throw new EmbeddingError("向量服务返回的条数不匹配");
    }
    const result = new Map<number, number[]>();
    for (const item of body.data) {
      if (!record(item) || !Number.isInteger(item.index) || Number(item.index) < 0 || Number(item.index) >= texts.length || result.has(Number(item.index))) {
        throw new EmbeddingError("向量服务返回了无效序号");
      }
      result.set(Number(item.index), validateVector(item.embedding, dimensions));
    }
    const vectors = texts.map((_, index) => result.get(index)!);
    if (vectors.some(vector => vector.length !== vectors[0].length)) throw new EmbeddingError("同一批次的向量维度不一致，无法安全建立索引");
    if (record(body.usage) && typeof body.usage.prompt_tokens === "number" && Number.isInteger(body.usage.prompt_tokens) && body.usage.prompt_tokens >= 0) {
      onUsage?.({ promptTokens: body.usage.prompt_tokens });
    }
    return vectors;
  }
}