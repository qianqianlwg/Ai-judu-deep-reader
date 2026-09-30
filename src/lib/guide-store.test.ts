import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { guideFixture } from "./guide-test-support";
import { guideTransaction, navigateGuideHistory, readGuideState, restoreGuideRevision, saveGuideRevision } from "./guide-store";
import { enqueueGuideSource } from "./guide-sources";
let f: ReturnType<typeof guideFixture>;
const node = { id: "a", parentId: null, title: "实践", summary: "来自已句读选文", sourceIds: ["m"] };
beforeEach(() => { f = guideFixture(); f.message(); enqueueGuideSource(f.db, "m"); }); afterEach(() => f.db.close());
const save = (version: number, title: string, actor: "user" | "ai" = "user") => guideTransaction(f.db, () => saveGuideRevision(f.db, "b", version, [{ ...node, title }], actor, "整理主题"));
describe("可撤销快照", () => {
  it("用户和AI改动都能撤销重做，版本号只递增", () => { save(0, "初版", "ai"); save(1, "编辑"); guideTransaction(f.db, () => navigateGuideHistory(f.db, "b", 2, "undo")); expect(readGuideState(f.db, "b")).toMatchObject({ version: 3, nodes: [{ title: "初版" }], canRedo: true }); guideTransaction(f.db, () => navigateGuideHistory(f.db, "b", 3, "redo")); expect(readGuideState(f.db, "b").nodes[0].title).toBe("编辑"); });
  it("撤销首版得到空树，来源队列不复活", () => { save(0, "初版"); guideTransaction(f.db, () => navigateGuideHistory(f.db, "b", 1, "undo")); expect(readGuideState(f.db, "b")).toMatchObject({ nodes: [], canUndo: false, canRedo: true }); });
  it("分支编辑清空redo但历史仍可恢复", () => { save(0, "初版"); save(1, "第二版"); const old = readGuideState(f.db, "b").revisions[0].id; guideTransaction(f.db, () => navigateGuideHistory(f.db, "b", 2, "undo")); save(3, "新分支"); expect(readGuideState(f.db, "b").canRedo).toBe(false); guideTransaction(f.db, () => restoreGuideRevision(f.db, "b", 4, old)); expect(readGuideState(f.db, "b").nodes[0].title).toBe("第二版"); });
  it("版本竞争不覆盖新编辑，跨书恢复拒绝", () => { save(0, "初版"); expect(() => save(0, "过期")).toThrow("新"); expect(() => guideTransaction(f.db, () => restoreGuideRevision(f.db, "other", 0, readGuideState(f.db, "b").revisions[0].id))).toThrow("不存在"); expect(readGuideState(f.db, "b").nodes[0].title).toBe("初版"); });
});
it("超过历史面板页数后仍可撤销到空树，旧快照未被裁剪", () => {
  for (let index = 0; index < 65; index++) save(index, "修订" + index, index % 2 ? "user" : "ai");
  const newest = readGuideState(f.db, "b").revisions[0].id;
  expect(readGuideState(f.db, "b").revisions).toHaveLength(60);
  for (let index = 0; index < 65; index++) guideTransaction(f.db, () => navigateGuideHistory(f.db, "b", 65 + index, "undo"));
  expect(readGuideState(f.db, "b")).toMatchObject({ version: 130, nodes: [], canUndo: false, canRedo: true });
  expect(f.db.prepare("SELECT count(*) AS n FROM guide_revisions").get()).toMatchObject({ n: 65 });
  guideTransaction(f.db, () => navigateGuideHistory(f.db, "b", 130, "redo"));
  expect(readGuideState(f.db, "b").nodes[0].title).toBe("修订0");
  guideTransaction(f.db, () => restoreGuideRevision(f.db, "b", 131, newest));
  expect(readGuideState(f.db, "b").nodes[0].title).toBe("修订64");
});
