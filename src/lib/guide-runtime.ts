import { getDb } from "./db";
import { DEFAULT_CONTEXT_SETTINGS } from "./context-compaction";
import { isRecord } from "./chat-stream";
import { GUIDE_PROMPT, GUIDE_TOOL_SCHEMA, planGuide } from "./guide-agent";
import { claimGuideJob, runGuideJob } from "./guide-worker";
import type { ProviderConfig } from "./ai-provider";
export function readGuideConfig(db: ReturnType<typeof getDb>): ProviderConfig {
  const row = db.prepare("SELECT provider,base_url,api_key,model FROM ai_provider_configs WHERE id='default'").get() as { provider?: string; base_url?: string; api_key?: string; model?: string } | undefined;
  return { provider: row?.provider === "claude" ? "claude" : "openai", baseUrl: row?.base_url || process.env.AI_BASE_URL || "https://api.openai.com/v1", apiKey: row?.api_key || process.env.AI_API_KEY || "", model: row?.model || process.env.AI_MODEL || "gpt-4o-mini" };
}
export function readGuideCapacity(db: ReturnType<typeof getDb>, bookId: string) {
  const row = db.prepare("SELECT m.structured_output FROM chat_messages m JOIN reading_threads t ON t.id=m.thread_id JOIN editions e ON e.id=t.edition_id WHERE e.book_id=? AND m.role='assistant' AND json_valid(m.structured_output) AND json_extract(m.structured_output,'$._request') IS NOT NULL ORDER BY m.created_at DESC LIMIT 1").get(bookId) as { structured_output: string } | undefined;
  const data: unknown = row ? JSON.parse(row.structured_output) : undefined;
  const request = isRecord(data) && isRecord(data._request) ? data._request : undefined;
  const snapshot = isRecord(request?.contextSnapshot) ? request.contextSnapshot : undefined;
  const settings = isRecord(request?.executionSettings) ? request.executionSettings : isRecord(snapshot?.contextSettings) ? snapshot.contextSettings : undefined;
  const budget = typeof settings?.maxInputTokens === 'number' && Number.isSafeInteger(settings.maxInputTokens) && settings.maxInputTokens >= 4096 ? settings.maxInputTokens : DEFAULT_CONTEXT_SETTINGS.maxInputTokens;
  return { maxInputTokens: budget, fixedPrompt: GUIDE_PROMPT, toolSchema: GUIDE_TOOL_SCHEMA, maxSources: 64 };
}
type WorkerGlobal = typeof globalThis & { juduGuideWorker?: { timer: ReturnType<typeof setTimeout> | null; running: boolean } };
// WHY：运行装配集中在这里；持久队列不依赖浏览器打开导读，重启后也能继续未完成任务。
export function startGuideWorker(): void {
  const host = globalThis as WorkerGlobal;
  if (host.juduGuideWorker) return;
  const state = { timer: null as ReturnType<typeof setTimeout> | null, running: false };
  host.juduGuideWorker = state;
  const tick = async () => {
    if (host.juduGuideWorker !== state) return;
    state.running = true;
    try {
      const db = getDb(), job = claimGuideJob(db, Date.now(), bookId => readGuideCapacity(db, bookId));
      if (job) await runGuideJob(db, job, input => planGuide(readGuideConfig(db), input));
    } catch (error: unknown) { console.error("导读后台任务暂不可用", { name: error instanceof Error ? error.name : "UnknownError" }); }
    finally { state.running = false; if (host.juduGuideWorker === state) { state.timer = setTimeout(() => void tick(), 2000); state.timer.unref(); } }
  };
  state.timer = setTimeout(() => void tick(), 2000); state.timer.unref();
}
export function stopGuideWorker(): void {
  const host = globalThis as WorkerGlobal;
  if (host.juduGuideWorker?.timer) clearTimeout(host.juduGuideWorker.timer);
  delete host.juduGuideWorker;
}
