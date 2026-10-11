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

it('等主Agent结束后一次领取本次全部句读，分析正文批量注入且一次提交完成',async()=>{f.db.exec('DELETE FROM guide_sources');f.message('parent',{semantic:{version:1}},'streaming');for(const id of ['u1','u2']){f.message(id,{_semanticParent:'parent',_request:undefined});enqueueGuideSource(f.db,id);}expect(claimGuideJob(f.db)).toBeNull();f.db.prepare("UPDATE chat_messages SET status='completed' WHERE id='parent'").run();const job=claimGuideJob(f.db)!;expect(job.sourceIds).toEqual(['u1','u2']);const planner=vi.fn(async(input:Parameters<Parameters<typeof runGuideJob>[2]>[0])=>{expect(input.sources?.map(s=>s.analysisText)).toEqual(['已完成句读','已完成句读']);return {patch:{...patch,upserts:[{...patch.upserts[0],sourceIds:['u1','u2']}]}};});await runGuideJob(f.db,job,planner);expect(planner).toHaveBeenCalledOnce();expect(readGuideState(f.db,'b')).toMatchObject({processed:2,pending:0});});

it('崩溃留下的父消息租约过期后，已完成分析仍能整理，不永久卡在等待',()=>{f.db.exec('DELETE FROM guide_sources');f.message('parent',{semantic:{version:1},_request:{leaseUntil:Date.now()-1}},'streaming');f.message('u',{_semanticParent:'parent',_request:undefined});enqueueGuideSource(f.db,'u');expect(claimGuideJob(f.db)?.sourceIds).toEqual(['u']);});

it('同书不同历史父消息一起合批，容量不足的后续来源保持pending且不截断',async()=>{
 f.message('legacy-two');enqueueGuideSource(f.db,'legacy-two');
 const first=claimGuideJob(f.db,Date.now(),{maxInputTokens:4096,fixedPrompt:'真实提示',toolSchema:'真实Schema',maxSources:1})!;
 expect(first.sourceIds).toHaveLength(1);await runGuideJob(f.db,first,async()=>({patch:{...patch,upserts:[{...patch.upserts[0],sourceIds:first.sourceIds!}]}}));
 const next=claimGuideJob(f.db,Date.now(),{maxInputTokens:4096,fixedPrompt:'真实提示',toolSchema:'真实Schema'})!;
 expect(next.sourceIds).toHaveLength(1);expect(next.sourceIds).not.toEqual(first.sourceIds);
});
it('独立旧句读一次规划消费，保留来源锚点且每则来源有自己的失败次数',async()=>{
 vi.spyOn(console,'error').mockImplementation(()=>{});f.message('legacy-two');enqueueGuideSource(f.db,'legacy-two');
 f.db.prepare("UPDATE guide_sources SET attempts=2 WHERE message_id='m'").run();
 const job=claimGuideJob(f.db)!;expect(job.sourceIds).toEqual(expect.arrayContaining(['m','legacy-two']));
 const planner=vi.fn(async()=>{throw new Error('受控模型失败');});await runGuideJob(f.db,job,planner);expect(planner).toHaveBeenCalledOnce();
 expect(f.db.prepare('SELECT status,attempts FROM guide_sources WHERE message_id=?').get('m')).toEqual({status:'failed',attempts:3});
 expect(f.db.prepare('SELECT status,attempts FROM guide_sources WHERE message_id=?').get('legacy-two')).toEqual({status:'pending',attempts:1});
});
it('完整框架加一则已超容量时明确失败，不能静默缩短分析或卡在排队',()=>{
 expect(claimGuideJob(f.db,Date.now(),{maxInputTokens:1,fixedPrompt:'完整提示',toolSchema:'工具'}) ).toBeNull();
 expect(readGuideState(f.db,'b')).toMatchObject({failed:1,pending:0});
});

it('注入选择使用真实版本时间线，并将本轮输入预算传给Agent',async()=>{
 guideTransaction(f.db,()=>saveGuideRevision(f.db,'b',0,patch.upserts,'user','添加'));
 const capacity={maxInputTokens:16000,fixedPrompt:'提示',toolSchema:'工具'};
 const job=claimGuideJob(f.db,Date.now(),capacity)!;
 await runGuideJob(f.db,job,async input=>{
  expect(input.capacity).toEqual(capacity);expect(input.nodes[0].timeline?.updated).toBeGreaterThan(0);
  return {patch:{reason:'无须修改',upserts:[],removeIds:[]}};
 });
 expect(readGuideState(f.db,'b').processed).toBe(1);
});
