import { getDb } from "./db";
import { planGuide } from "./guide-agent";
import { claimGuideJob, runGuideJob } from "./guide-worker";
import type { ProviderConfig } from "./ai-provider";
export function readGuideConfig(db: ReturnType<typeof getDb>): ProviderConfig {
  const row = db.prepare("SELECT provider,base_url,api_key,model FROM ai_provider_configs WHERE id='default'").get() as { provider?: string; base_url?: string; api_key?: string; model?: string } | undefined;
  return { provider: row?.provider === "claude" ? "claude" : "openai", baseUrl: row?.base_url || process.env.AI_BASE_URL || "https://api.openai.com/v1", apiKey: row?.api_key || process.env.AI_API_KEY || "", model: row?.model || process.env.AI_MODEL || "gpt-4o-mini" };
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
      const db = getDb(), job = claimGuideJob(db);
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
