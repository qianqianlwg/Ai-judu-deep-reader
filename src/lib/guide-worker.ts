import { randomUUID } from "node:crypto";
import { applyGuidePatch, GuideError, type GuideNode, type GuidePatch } from "./guide";
import { guideHead, guideNodes, guideSourceIds, guideTransaction, saveGuideRevision, type GuideDb } from "./guide-store";
import { readGuideSources, type GuideSource } from "./guide-sources";
export type GuideJob = { message_id: string; book_id: string; lease_token: string; attempts: number };
export type GuidePlanInput = { bookId: string; nodes: GuideNode[]; source: GuideSource; readSources: (ids: string[]) => GuideSource[]; signal: AbortSignal };
export type GuidePlanner = (input: GuidePlanInput) => Promise<{ patch: GuidePatch; usage?: unknown }>;
export function claimGuideJob(db: GuideDb, now = Date.now()): GuideJob | null {
  return guideTransaction(db, () => {
    // WHY：数据库租约跨进程互斥；Next 开发热更新和重启不允许两个 worker 同时改一本书。
    db.prepare("UPDATE guide_sources SET status='pending',lease_token=NULL,lease_until=0 WHERE status='processing' AND lease_until<?").run(now);
    const row = db.prepare("SELECT message_id,book_id,attempts FROM guide_sources s WHERE status='pending' AND next_attempt<=? AND NOT EXISTS(SELECT 1 FROM guide_sources other WHERE other.book_id=s.book_id AND other.status='processing') ORDER BY created_at,message_id LIMIT 1").get(now) as Omit<GuideJob, "lease_token"> | undefined;
    if (!row) return null;
    const job = { ...row, attempts: row.attempts + 1, lease_token: randomUUID() };
    db.prepare("UPDATE guide_sources SET status='processing',attempts=?,lease_token=?,lease_until=?,error=NULL WHERE message_id=?").run(job.attempts, job.lease_token, now + 300_000, job.message_id);
    return job;
  });
}
export async function runGuideJob(db: GuideDb, job: GuideJob, plan: GuidePlanner): Promise<void> {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 240_000);
  try {
    const head = guideHead(db, job.book_id), nodes = guideNodes(db, head.current_revision);
    const [source] = readGuideSources(db, job.book_id, [job.message_id]);
    if (!source) throw new Error("导读来源不存在");
    const result = await plan({ bookId: job.book_id, nodes, source, readSources: ids => readGuideSources(db, job.book_id, ids), signal: controller.signal });
    controller.signal.throwIfAborted();
    guideTransaction(db, () => {
      const own = db.prepare("SELECT message_id FROM guide_sources WHERE message_id=? AND status='processing' AND lease_token=? AND lease_until>?").get(job.message_id, job.lease_token, Date.now());
      if (!own) throw new GuideError("导读任务租约已被替代", 409);
      if (guideHead(db, job.book_id).version !== head.version) throw new GuideError("导读已被编辑，将基于新版本继续更新", 409);
      const next = applyGuidePatch(nodes, result.patch, guideSourceIds(db, job.book_id));
      if (JSON.stringify(next) !== JSON.stringify(nodes)) saveGuideRevision(db, job.book_id, head.version, next, "ai", result.patch.reason, result.usage);
      db.prepare("UPDATE guide_sources SET status='completed',completed_at=?,lease_token=NULL,lease_until=0,error=NULL WHERE message_id=? AND lease_token=?").run(new Date().toISOString(), job.message_id, job.lease_token);
    });
  } catch (error: unknown) {
    const conflict = error instanceof GuideError && error.status === 409;
    const retry = conflict || job.attempts < 3;
    const message = error instanceof GuideError ? error.message : "AI 导读更新未完成，请检查模型连接后重试；已保存的句读和导读不受影响。";
    console.error("导读更新失败", { messageId: job.message_id, name: error instanceof Error ? error.name : "UnknownError", conflict });
    db.prepare("UPDATE guide_sources SET status=?,attempts=?,lease_token=NULL,lease_until=0,next_attempt=?,error=? WHERE message_id=? AND lease_token=?").run(retry ? "pending" : "failed", conflict ? Math.max(0, job.attempts - 1) : job.attempts, Date.now() + (conflict ? 1000 : 5000 * job.attempts), message, job.message_id, job.lease_token);
  } finally { clearTimeout(timeout); }
}
