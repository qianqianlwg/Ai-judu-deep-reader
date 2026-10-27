import { openSecret, sealSecret } from "./secret-storage";
import { EMBEDDING_BASE_URL, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embeddingProfile, normalizeEmbeddingBaseUrl, type EmbeddingConfig } from "./embedding-provider";
export type EmbeddingStore = { exec(sql: string): void; prepare(sql: string): { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[]; run(...args: unknown[]): unknown } };
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }

export function ensureEmbeddingSchema(db: EmbeddingStore): void {
  // WHY：模型输出维度可能与默认值不同，独立保存配置并与向量模型信息一起读取。
  db.exec(`CREATE TABLE IF NOT EXISTS paragraph_embeddings (edition_id TEXT NOT NULL, paragraph_id TEXT NOT NULL, chunk_start INTEGER NOT NULL, chunk_end INTEGER NOT NULL, text_hash TEXT NOT NULL, profile TEXT NOT NULL, vector_json TEXT NOT NULL, PRIMARY KEY(edition_id, paragraph_id, chunk_start, profile));
    CREATE TABLE IF NOT EXISTS embedding_preferences (id INTEGER PRIMARY KEY CHECK(id=1), agent_semantic INTEGER NOT NULL CHECK(agent_semantic IN (0,1)));
    CREATE TABLE IF NOT EXISTS embedding_provider_settings (id INTEGER PRIMARY KEY CHECK(id=1), dimensions INTEGER);
    CREATE TABLE IF NOT EXISTS embedding_build_leases (edition_id TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS embedding_index_jobs (edition_id TEXT PRIMARY KEY, token TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','pausing','paused','completed','failed')), error TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL);`);
}

export function readEmbeddingConfig(db: EmbeddingStore): EmbeddingConfig {
  ensureEmbeddingSchema(db);
  const row = db.prepare("SELECT base_url, api_key, model FROM ai_provider_configs WHERE id = ?").get("embedding");
  const savedUrl = record(row) && typeof row.base_url === "string" && row.base_url.trim() ? row.base_url : EMBEDDING_BASE_URL;
  const savedModel = record(row) && typeof row.model === "string" && row.model.trim() ? row.model : EMBEDDING_MODEL;
  const savedKey = record(row) && typeof row.api_key === "string" ? row.api_key : "";
  const dimensionRow = db.prepare("SELECT dimensions FROM embedding_provider_settings WHERE id = 1").get();
  let dimensions: number | null = EMBEDDING_DIMENSIONS;
  if (record(dimensionRow) && "dimensions" in dimensionRow) {
    const value = dimensionRow.dimensions;
    if (value === null) dimensions = null;
    else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 16_384) dimensions = value;
    else throw new Error("\u5df2\u4fdd\u5b58\u7684\u5411\u91cf\u7ef4\u5ea6\u914d\u7f6e\u65e0\u6548");
  }
  return { apiKey: openSecret(savedKey) || process.env.SILICONFLOW_API_KEY?.trim() || "", baseUrl: normalizeEmbeddingBaseUrl(savedUrl), model: savedModel, dimensions };
}

export function saveEmbeddingConfig(db: EmbeddingStore, value: unknown): EmbeddingConfig {
  if (!record(value)) throw new Error("\u5411\u91cf\u670d\u52a1\u914d\u7f6e\u683c\u5f0f\u65e0\u6548");
  const current = readEmbeddingConfig(db);
  let apiKey = current.apiKey;
  if ("apiKey" in value) {
    if (typeof value.apiKey !== "string" || value.apiKey.length > 500 || /\s/u.test(value.apiKey.trim())) throw new Error("\u8bf7\u8f93\u5165\u6709\u6548\u7684\u5411\u91cf API Key");
    apiKey = value.apiKey.trim() || current.apiKey;
  }
  if (!apiKey) throw new Error("\u8bf7\u5148\u586b\u5199\u5411\u91cf API Key");
  let baseUrl = current.baseUrl ?? EMBEDDING_BASE_URL;
  if ("baseUrl" in value) {
    if (typeof value.baseUrl !== "string") throw new Error("\u5411\u91cf API \u5730\u5740\u65e0\u6548");
    baseUrl = normalizeEmbeddingBaseUrl(value.baseUrl);
  }
  let model = current.model ?? EMBEDDING_MODEL;
  if ("model" in value) {
    if (typeof value.model !== "string") throw new Error("Embedding \u6a21\u578b\u540d\u79f0\u65e0\u6548");
    model = value.model.trim();
  }
  if (!model || model.length > 200 || /[\r\n\x00-\x1f]/u.test(model)) throw new Error("Embedding \u6a21\u578b\u540d\u79f0\u5fc5\u586b\u4e14\u4e0d\u8d85\u8fc7 200 \u4e2a\u5b57\u7b26");
  let dimensions = current.dimensions ?? null;
  if ("dimensions" in value) {
    if (value.dimensions === null) dimensions = null;
    else if (typeof value.dimensions === "number" && Number.isSafeInteger(value.dimensions) && value.dimensions >= 1 && value.dimensions <= 16_384) dimensions = value.dimensions;
    else throw new Error("\u5411\u91cf\u7ef4\u5ea6\u5fc5\u987b\u662f 1-16384 \u7684\u6574\u6570\uff0c\u6216\u7559\u7a7a\u7531\u6a21\u578b\u51b3\u5b9a");
  }
  const next: EmbeddingConfig = { apiKey, baseUrl, model, dimensions };
  if (embeddingProfile(current) !== embeddingProfile(next)) {
    // WHY：切换模型空间时使旧任务失效，避免旧模型的后台结果误报为新索引。
    db.prepare("DELETE FROM embedding_index_jobs").run();
    db.prepare("DELETE FROM embedding_build_leases").run();
  }
  const updatedAt = new Date().toISOString();
  db.prepare("INSERT INTO ai_provider_configs (id, provider, base_url, api_key, model, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, base_url=excluded.base_url, api_key=excluded.api_key, model=excluded.model, updated_at=excluded.updated_at").run("embedding", "openai", baseUrl, sealSecret(apiKey), model, updatedAt);
  db.prepare("INSERT INTO embedding_provider_settings (id, dimensions) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET dimensions=excluded.dimensions").run(dimensions);
  return next;
}

export function readAgentRetrievalEnabled(db: EmbeddingStore): boolean {
  ensureEmbeddingSchema(db);
  const row = db.prepare("SELECT agent_semantic FROM embedding_preferences WHERE id=1").get();
  return !(record(row) && "agent_semantic" in row && row.agent_semantic === 0);
}

export function saveAgentRetrievalEnabled(db: EmbeddingStore, value: unknown): void {
  if (typeof value !== "boolean") throw new Error("\u81ea\u52a8\u68c0\u7d22\u8bbe\u7f6e\u5fc5\u987b\u662f\u5e03\u5c14\u503c");
  ensureEmbeddingSchema(db);
  db.prepare("INSERT INTO embedding_preferences(id, agent_semantic) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET agent_semantic=excluded.agent_semantic").run(value ? 1 : 0);
}
