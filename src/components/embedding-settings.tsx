"use client";

import { useEffect, useState } from "react";
import styles from "@/app/settings/settings.module.css";

type EmbeddingSettingsResponse = { baseUrl: string; model: string; dimensions: number | null; hasApiKey: boolean; agentSemanticEnabled: boolean };
const COPY = {
  title: "\u5411\u91cf\u7d22\u5f15\u4e0e\u8bed\u4e49\u641c\u7d22",
  modelFallback: "\u81ea\u5b9a\u4e49 Embedding \u6a21\u578b",
  autoDimensions: "\u81ea\u52a8\u7ef4\u5ea6",
  waitingUrl: "API \u5730\u5740\u5f85\u914d\u7f6e",
  overview: "\u4e0e\u804a\u5929\u6a21\u578b\u72ec\u7acb\u3002\u5efa\u7d22\u5f15\u4f1a\u628a\u672c\u4e66\u6587\u5b57\u53d1\u9001\u81f3\u4f60\u914d\u7f6e\u7684\u5411\u91cf API\uff1b\u8bed\u4e49\u67e5\u8be2\u53ea\u53d1\u9001\u67e5\u8be2\u6587\u672c\uff0c\u53ef\u80fd\u4ea7\u751f API \u8d39\u7528\u3002\u5411\u91cf\u4fdd\u5b58\u5728\u672c\u5730\u4e66\u5e93\uff0c\u66f4\u6362\u6a21\u578b\u6216 API \u540e\u9700\u91cd\u5efa\u7d22\u5f15\u3002",
  apiUrl: "API \u5730\u5740",
  model: "Embedding \u6a21\u578b",
  dimensions: "\u5411\u91cf\u7ef4\u5ea6",
  dimensionsHint: "\u652f\u6301 1\u201316384\uff1b\u7559\u7a7a\u65f6\u7531\u670d\u52a1\u8fd4\u56de\u7684\u5411\u91cf\u51b3\u5b9a\u3002",
  apiKey: "\u5411\u91cf API Key",
  keySaved: "\u5df2\u914d\u7f6e\uff1b\u7559\u7a7a\u4fdd\u7559\u73b0\u6709 Key",
  keyPlaceholder: "\u8bf7\u8f93\u5165 Embedding \u670d\u52a1 API Key",
  allowSemantic: "\u5141\u8bb8 AI \u6309\u9700\u4f7f\u7528\u8bed\u4e49\u68c0\u7d22",
  toggleHint: "\u4ec5\u68c0\u7d22\u5df2\u5efa\u7acb\u7d22\u5f15\u7684\u5f53\u524d\u4e66\u7c4d\uff1b\u5173\u95ed\u540e AI \u4ec5\u4f7f\u7528\u672c\u5730\u5173\u952e\u8bcd\u68c0\u7d22\u3002",
  save: "\u4fdd\u5b58\u5411\u91cf\u914d\u7f6e",
  test: "\u6d4b\u8bd5\u5df2\u4fdd\u5b58\u914d\u7f6e",
  saveNotice: "\u5411\u91cf\u914d\u7f6e\u5df2\u4fdd\u5b58\uff1b\u66f4\u6362\u6a21\u578b\u6216 API \u5730\u5740\u540e\uff0c\u9700\u8981\u4e3a\u4e66\u7c4d\u91cd\u5efa\u7d22\u5f15\u3002",
  readError: "\u8bfb\u53d6\u8bed\u4e49\u641c\u7d22\u914d\u7f6e\u5931\u8d25",
  saveError: "\u4fdd\u5b58\u5411\u91cf\u914d\u7f6e\u5931\u8d25",
  dimensionError: "\u5411\u91cf\u7ef4\u5ea6\u8bf7\u8f93\u5165 1\u201316384 \u7684\u6574\u6570\uff0c\u6216\u7559\u7a7a\u81ea\u52a8\u8bc6\u522b",
  testProgress: "\u6b63\u5728\u6d4b\u8bd5\u5df2\u4fdd\u5b58\u7684\u914d\u7f6e\u2026",
  testError: "\u5411\u91cf\u670d\u52a1\u8fde\u63a5\u6d4b\u8bd5\u5931\u8d25",
  testSuccess: "\u5411\u91cf\u670d\u52a1\u8fde\u63a5\u6210\u529f",
  toggleError: "\u4fdd\u5b58\u8bed\u4e49\u68c0\u7d22\u5f00\u5173\u5931\u8d25",
  enabled: "AI \u53ef\u4f7f\u7528\u5df2\u5efa\u7acb\u7d22\u5f15\u7684\u8bed\u4e49\u68c0\u7d22",
  disabled: "AI \u5c06\u53ea\u4f7f\u7528\u672c\u5730\u5173\u952e\u8bcd\u68c0\u7d22",
  retry: "\u8bf7\u91cd\u8bd5",
  loading: "\u6b63\u5728\u8bfb\u53d6\u8bed\u4e49\u641c\u7d22\u914d\u7f6e\u2026",
  keyError: "\u8bf7\u5148\u586b\u5199\u5411\u91cf API Key",
  responseError: "\u5411\u91cf\u8bbe\u7f6e\u54cd\u5e94\u65e0\u6548",
  saveFailed: "\u4fdd\u5b58\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u914d\u7f6e\u540e\u91cd\u8bd5",
} as const;
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function readSettings(value: unknown): EmbeddingSettingsResponse {
  if (!isRecord(value)) throw new Error(COPY.responseError);
  if (typeof value.error === "string") throw new Error(value.error);
  const { baseUrl, model, dimensions, hasApiKey, agentSemanticEnabled } = value;
  if (typeof baseUrl !== "string" || typeof model !== "string" || (dimensions !== null && typeof dimensions !== "number") || typeof hasApiKey !== "boolean" || typeof agentSemanticEnabled !== "boolean") throw new Error(COPY.responseError);
  return { baseUrl, model, dimensions, hasApiKey, agentSemanticEnabled };
}
function readError(value: unknown, fallback: string): string { return isRecord(value) && typeof value.error === "string" ? value.error : fallback; }

export function EmbeddingSettings() {
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [dimensions, setDimensions] = useState("1024");
  const [key, setKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [agentSemanticEnabled, setAgentSemanticEnabled] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/settings/embedding", { signal: controller.signal, cache: "no-store" }).then(async response => {
      const value: unknown = await response.json();
      if (!response.ok) throw new Error(readError(value, COPY.readError));
      const settings = readSettings(value);
      if (controller.signal.aborted) return;
      setBaseUrl(settings.baseUrl); setModel(settings.model); setDimensions(settings.dimensions === null ? "" : String(settings.dimensions));
      setConfigured(settings.hasApiKey); setAgentSemanticEnabled(settings.agentSemanticEnabled); setReady(true);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) { console.error("Embedding settings read failed", { name: cause instanceof Error ? cause.name : "UnknownError" }); setError(cause instanceof Error ? cause.message : COPY.readError); }
    });
    return () => controller.abort();
  }, []);
  async function saveConfig(): Promise<void> {
    setBusy(true); setError(""); setNotice("");
    try {
      const dimension = dimensions.trim() === "" ? null : Number(dimensions);
      if (dimension !== null && (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > 16_384)) throw new Error(COPY.dimensionError);
      const response = await fetch("/api/settings/embedding", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl, model, dimensions: dimension, apiKey: key || undefined }) });
      const value: unknown = await response.json();
      if (!response.ok) throw new Error(readError(value, COPY.saveError));
      const settings = readSettings(value);
      setBaseUrl(settings.baseUrl); setModel(settings.model); setDimensions(settings.dimensions === null ? "" : String(settings.dimensions));
      setConfigured(settings.hasApiKey); setKey(""); setNotice(COPY.saveNotice);
    } catch (cause: unknown) {
      console.error("Embedding settings save failed", { name: cause instanceof Error ? cause.name : "UnknownError" });
      setError(cause instanceof Error ? cause.message : COPY.saveFailed);
    } finally { setBusy(false); }
  }
  async function testConnection(): Promise<void> {
    setBusy(true); setError(""); setNotice(COPY.testProgress);
    try {
      // WHY：本地代理拒绝非 JSON 写请求；连接测试没有业务载荷时也发送空对象，保留统一同源防护。
      const response = await fetch("/api/settings/embedding", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const value: unknown = await response.json();
      if (!response.ok) throw new Error(readError(value, COPY.testError));
      setNotice(readError(value, COPY.testSuccess));
    } catch (cause: unknown) {
      console.error("Embedding connection test failed", { name: cause instanceof Error ? cause.name : "UnknownError" });
      setError(cause instanceof Error ? cause.message : COPY.testError);
    } finally { setBusy(false); }
  }
  async function toggleAgent(enabled: boolean): Promise<void> {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/settings/embedding", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentSemanticEnabled: enabled }) });
      const value: unknown = await response.json();
      if (!response.ok) throw new Error(readError(value, COPY.toggleError));
      setAgentSemanticEnabled(enabled); setNotice(enabled ? COPY.enabled : COPY.disabled);
    } catch (cause: unknown) {
      console.error("Semantic retrieval toggle failed", { name: cause instanceof Error ? cause.name : "UnknownError" });
      setError(cause instanceof Error ? cause.message : COPY.retry);
    } finally { setBusy(false); }
  }
  const dimensionValue = dimensions.trim() === "" ? null : Number(dimensions);
  const dimensionsValid = dimensionValue === null || (Number.isSafeInteger(dimensionValue) && dimensionValue >= 1 && dimensionValue <= 16_384);
  const summary = [model || COPY.modelFallback, dimensionValue === null ? COPY.autoDimensions : dimensionValue + " \u7ef4", baseUrl || COPY.waitingUrl].join(" \u00b7 ");
  return <section className={styles.card} aria-label={COPY.title} aria-busy={!ready || busy}>
    <h2>{COPY.title}</h2>
    <p className={styles.hint}>{summary}</p>
    <p className={styles.hint}>{COPY.overview}</p>
    <fieldset className={styles.embeddingFields} data-testid="embedding-settings-fields" data-layout="responsive-grid" disabled={!ready || busy}>
      {/* WHY：标签与控件各自占位，避免行内拥压。 */}
      <label className={styles.embeddingField}>{COPY.apiUrl}<input aria-label="Embedding API URL" type="url" autoComplete="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://api.siliconflow.cn/v1" /></label>
      <label className={styles.embeddingField}>{COPY.model}<input aria-label="Embedding model" value={model} onChange={event => setModel(event.target.value)} placeholder="Qwen/Qwen3-Embedding-8B" /></label>
      <label className={styles.embeddingField}>{COPY.dimensions}<input aria-label="Embedding dimensions" type="number" inputMode="numeric" min={1} max={16_384} step={1} value={dimensions} onChange={event => setDimensions(event.target.value)} placeholder="\u7559\u7a7a\u81ea\u52a8\u8bc6\u522b" /><span className={styles.embeddingFieldHint}>{COPY.dimensionsHint}</span></label>
      <label className={styles.embeddingField}>{COPY.apiKey}<input aria-label="Embedding API key" type="password" autoComplete="new-password" value={key} onChange={event => setKey(event.target.value)} placeholder={configured ? COPY.keySaved : COPY.keyPlaceholder} /></label>
      <label className={styles.embeddingToggle}><input aria-label="Allow semantic retrieval" type="checkbox" checked={agentSemanticEnabled} onChange={event => void toggleAgent(event.target.checked)} />{COPY.allowSemantic}</label>
      <p className={`${styles.hint} ${styles.embeddingHint}`}>{COPY.toggleHint}</p>
      <div className={`${styles.actions} ${styles.embeddingActions}`}>
        <button type="button" data-testid="embedding-save" disabled={busy || !ready || !dimensionsValid || !baseUrl.trim() || !model.trim() || (!configured && !key.trim())} onClick={() => void saveConfig()}>{COPY.save}</button>
        <button type="button" data-testid="embedding-test" disabled={busy || !ready || !configured} onClick={() => void testConnection()}>{COPY.test}</button>
      </div>
    </fieldset>
    {!ready && !error && <p role="status">{COPY.loading}</p>}
    {notice && <p className={styles.hint} role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
