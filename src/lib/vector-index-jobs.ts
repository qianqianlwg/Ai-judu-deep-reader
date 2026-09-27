import { randomUUID } from "node:crypto";
import { ensureEmbeddingSchema, type EmbeddingStore } from "./embedding-store";
import { buildVectorBatch, vectorIndexStatus } from "./vector-index";
import type { EmbeddingConfig } from "./embedding-provider";

type BatchResult = Pick<ReturnType<typeof vectorIndexStatus>, "vectorIndexed" | "chunkCount">;
type Build = (db: EmbeddingStore, editionId: string, config: EmbeddingConfig) => Promise<BatchResult>;
type JobRow = { token: string; status: "running" | "pausing" | "paused" | "completed" | "failed"; error: string; updatedAt: number };
export type IndexJobStatus = { state: JobRow["status"] | "idle" | "interrupted"; error: string };
const STALE_MS = 90_000;

export function createVectorIndexJobs(build: Build = buildVectorBatch) {
  function row(db: EmbeddingStore, editionId: string): JobRow | undefined {
    ensureEmbeddingSchema(db);
    return db.prepare("SELECT token,status,error,updated_at AS updatedAt FROM embedding_index_jobs WHERE edition_id=?").get(editionId) as JobRow | undefined;
  }
  function status(db: EmbeddingStore, editionId: string): IndexJobStatus {
    const current = row(db, editionId);
    if (!current) return { state: "idle", error: "" };
    if ((current.status === "running" || current.status === "pausing") && Date.now() - current.updatedAt > STALE_MS)
      return { state: "interrupted", error: "服务重启或任务中断，可确认后继续准备；已完成的内容会保留。" };
    return { state: current.status, error: current.error };
  }
  function update(db: EmbeddingStore, editionId: string, token: string, state: JobRow["status"], error = "") {
    db.prepare("UPDATE embedding_index_jobs SET status=?,error=?,updated_at=? WHERE edition_id=? AND token=?")
      .run(state, error, Date.now(), editionId, token);
  }
  function pause(db: EmbeddingStore, editionId: string): IndexJobStatus {
    db.prepare("UPDATE embedding_index_jobs SET status='pausing',updated_at=? WHERE edition_id=? AND status='running'").run(Date.now(), editionId);
    return status(db, editionId);
  }
  function start(db: EmbeddingStore, editionId: string, config: EmbeddingConfig): IndexJobStatus {
    if (!db.prepare("SELECT id FROM editions WHERE id=?").get(editionId)) throw new Error("书籍版本不存在");
    if (!config.apiKey.trim()) throw new Error("请先在设置中保存向量模型 API Key");
    if (vectorIndexStatus(db, editionId).vectorIndexed) return { state: "completed", error: "" };
    const token = randomUUID(), now = Date.now();
    // WHY：任务状态通过 SQLite 原子竞争，不依赖 API 路由是否共享进程；浏览器离开时不取消已授权的网络请求。
    const claimed = db.prepare("INSERT INTO embedding_index_jobs(edition_id,token,status,error,updated_at) VALUES(? ,?,'running','',?) ON CONFLICT(edition_id) DO UPDATE SET token=excluded.token,status='running',error='',updated_at=excluded.updated_at WHERE embedding_index_jobs.status NOT IN ('running','pausing') OR embedding_index_jobs.updated_at<? RETURNING edition_id")
      .get(editionId, token, now, now - STALE_MS);
    if (!claimed) return status(db, editionId);
    void (async () => {
      try {
        while (true) {
          const current = row(db, editionId);
          if (current?.token !== token) return;
          if (current.status === "pausing") { update(db, editionId, token, "paused"); return; }
          const result = await build(db, editionId, config);
          const next = row(db, editionId);
          if (next?.token !== token) return;
          if (result.vectorIndexed || result.chunkCount === 0) { update(db, editionId, token, "completed"); return; }
          if (next.status === "pausing") { update(db, editionId, token, "paused"); return; }
          update(db, editionId, token, "running");
        }
      } catch (cause: unknown) {
        console.error("后台向量索引失败", { name: cause instanceof Error ? cause.name : "UnknownError" });
        // WHY：上游异常可能包含密钥或正文；只写入固定错误提示，不持久化原始异常。
        update(db, editionId, token, "failed", "索引批次失败，请检查向量服务连接，稍后可继续准备。");
      }
    })();
    return { state: "running", error: "" };
  }
  return { start, pause, status };
}
