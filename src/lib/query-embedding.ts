import { createHash } from "node:crypto";
import { EMBEDDING_PROFILE, embedTexts, type EmbeddingConfig } from "./embedding-provider";
import type { EmbedBatch } from "./vector-index";

type Cached = { vector: number[]; expires: number };
// WHY：只缓存成功的查询向量，不缓存正文或凭证；配置指纹隔离不同账号，缓存有 TTL 和容量上限。
const cache = new Map<string, Cached>();
export function createQueryEmbeddingSession(config: EmbeddingConfig, provider: typeof embedTexts = embedTexts, maxRequests = 6) {
  let requests = 0;
  const pending = new Map<string, { signal?: AbortSignal; promise: Promise<number[][]> }>();
  return {
    createCall() {
      const stats: { cacheHit: boolean; promptTokens?: number } = { cacheHit: false };
      const embed: EmbedBatch = async (_config, texts, signal) => {
        signal?.throwIfAborted();
        if (texts.length !== 1) throw new Error("查询嵌入只接受一条查询");
        const key = createHash("sha256").update(EMBEDDING_PROFILE + "|" + config.apiKey + "|" + texts[0]).digest("hex");
        const saved = cache.get(key);
        if (saved && saved.expires > Date.now()) { stats.cacheHit = true; return [[...saved.vector]]; }
        // WHY：同轮并行工具可能改写出相同查询；仅共享同一取消作用域的在途请求，避免重复付费和跨请求取消。
        const active = pending.get(key);
        if (active && active.signal === signal) {
          const vectors = await active.promise; signal?.throwIfAborted();
          stats.cacheHit = true; return vectors.map(vector => [...vector]);
        }
        if (requests >= maxRequests) throw new Error("本轮语义检索已达到调用预算，请使用关键词检索");
        requests++;
        const promise = (async () => {
          const vectors = await provider(config, texts, signal, fetch, usage => { stats.promptTokens = usage.promptTokens; });
          signal?.throwIfAborted();
          if (cache.size >= 128) cache.delete(cache.keys().next().value!);
          cache.set(key, { vector: [...vectors[0]], expires: Date.now() + 600000 });
          return vectors;
        })();
        pending.set(key, { promise, signal });
        try { return await promise; }
        finally { if (pending.get(key)?.promise === promise) pending.delete(key); }
      };
      return { embed, stats };
    },
  };
}
