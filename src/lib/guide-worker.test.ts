import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { guideFixture } from "./guide-test-support";
import { enqueueGuideSource } from "./guide-sources";
import { claimGuideJob, runGuideJob } from "./guide-worker";
import { guideTransaction, navigateGuideHistory, readGuideState, saveGuideRevision } from "./guide-store";
let f: ReturnType<typeof guideFixture>;
beforeEach(() => { f = guideFixture(); f.message(); enqueueGuideSource(f.db, "m"); }); afterEach(() => { f.db.close(); vi.restoreAllMocks(); });
const patch = { reason: "新增实践主题", upserts: [{ id: "a", parentId: null, title: "实践", summary: "认识的来源", sourceIds: ["m"] }], removeIds: [] };
it("同一本书只允许一个worker持租约", () => { f.message("n"); enqueueGuideSource(f.db, "n"); expect(claimGuideJob(f.db)).not.toBeNull(); expect(claimGuideJob(f.db)).toBeNull(); });
it("应用补丁和消费消息同事务，撤销不重复消费", async () => { const job = claimGuideJob(f.db)!; await runGuideJob(f.db, job, async () => ({ patch })); expect(readGuideState(f.db, "b")).toMatchObject({ processed: 1, pending: 0, nodes: [{ title: "实践" }] }); guideTransaction(f.db, () => navigateGuideHistory(f.db, "b", 1, "undo")); expect(claimGuideJob(f.db)).toBeNull(); expect(readGuideState(f.db, "b").nodes).toEqual([]); });
it("AI在用户编辑后重排队而非覆盖新版本", async () => { vi.spyOn(console, "error").mockImplementation(() => {}); const job = claimGuideJob(f.db)!; await runGuideJob(f.db, job, async () => { guideTransaction(f.db, () => saveGuideRevision(f.db, "b", 0, [{ ...patch.upserts[0], title: "用户编辑" }], "user", "编辑")); return { patch }; }); expect(readGuideState(f.db, "b")).toMatchObject({ pending: 1, nodes: [{ title: "用户编辑" }] }); });
it("进程崩溃后过期租约可以领取，旧worker不再提交", () => { const old = claimGuideJob(f.db, 1000)!; const current = claimGuideJob(f.db, 302000)!; expect(current.message_id).toBe(old.message_id); expect(current.lease_token).not.toBe(old.lease_token); });
it("模型失败三次后可见失败状态，错误不泄露密钥", async () => { vi.spyOn(console, "error").mockImplementation(() => {}); f.db.prepare("UPDATE guide_sources SET attempts=2").run(); await runGuideJob(f.db, claimGuideJob(f.db)!, async () => { throw new Error("secret-api-key"); }); const state = readGuideState(f.db, "b"); expect(state.failed).toBe(1); expect(state.lastError).not.toContain("secret"); expect(state.nodes).toEqual([]); });
it("租约被新进程接管后，旧worker实际返回的补丁也不能写入", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const old = claimGuideJob(f.db)!;
  f.db.prepare("UPDATE guide_sources SET lease_until=0 WHERE message_id=?").run(old.message_id);
  const current = claimGuideJob(f.db)!;
  await runGuideJob(f.db, old, async () => ({ patch: { ...patch, upserts: [{ ...patch.upserts[0], title: "过期结果" }] } }));
  expect(readGuideState(f.db, "b")).toMatchObject({ version: 0, nodes: [], pending: 1, processed: 0 });
  await runGuideJob(f.db, current, async () => ({ patch }));
  expect(readGuideState(f.db, "b")).toMatchObject({ version: 1, nodes: [{ title: "实践" }], processed: 1 });
});
it("并发重试基于用户新版继续整理，AI仍可修改手动节点且能撤销", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await runGuideJob(f.db, claimGuideJob(f.db)!, async () => {
    guideTransaction(f.db, () => saveGuideRevision(f.db, "b", 0, [{ ...patch.upserts[0], title: "手动归纳" }], "user", "编辑"));
    return { patch };
  });
  f.db.prepare("UPDATE guide_sources SET next_attempt=0").run();
  await runGuideJob(f.db, claimGuideJob(f.db)!, async input => {
    expect(input.nodes[0].title).toBe("手动归纳");
    return { patch: { ...patch, upserts: [{ ...input.nodes[0], title: "AI继续归纳" }] } };
  });
  expect(readGuideState(f.db, "b")).toMatchObject({ version: 2, nodes: [{ title: "AI继续归纳" }], processed: 1 });
  guideTransaction(f.db, () => navigateGuideHistory(f.db, "b", 2, "undo"));
  expect(readGuideState(f.db, "b").nodes[0].title).toBe("手动归纳");
});
