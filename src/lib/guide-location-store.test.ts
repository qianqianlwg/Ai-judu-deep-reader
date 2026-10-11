import { afterEach, beforeEach, expect, it } from "vitest";
import { guideFixture } from "./guide-test-support";
import { enqueueGuideSource } from "./guide-sources";
import { saveGuideRevision } from "./guide-store";
import { readGuideLocations } from "./guide-location-store";
let f: ReturnType<typeof guideFixture>;
beforeEach(() => { f = guideFixture(); f.db.exec("ALTER TABLE editions ADD COLUMN file_name TEXT NOT NULL DEFAULT '原书.txt'"); });
afterEach(() => f.db.close());
function addNode(ids = ["m"]) {
  f.message(); enqueueGuideSource(f.db, "m");
  saveGuideRevision(f.db, "b", 0, [{ id: "a", parentId: null, title: "主题", summary: "归纳", sourceIds: ids }], "user", "测试");
}
it("按全书原文顺序和 UTF-16 偏移计算，不按节点时间或屏幕页数", () => {
  f.db.prepare("INSERT INTO paragraphs VALUES('before','c',?,-1)").run("😀");
  addNode();
  const result = readGuideLocations(f.db, "b"), total = 2 + "认识来自实践，也回到实践。".length;
  expect(result).toMatchObject({ bookId: "b", version: 1, issues: [], sources: [{ sourceId: "m", editionId: "e", spans: [{ start: 2 / total, end: 8 / total }] }] });
});
it("跨段来源逐段核对，不把间隔补成一个大范围", () => {
  addNode();
  f.db.prepare("INSERT INTO paragraphs VALUES('later','c','后文依据',2)").run();
  const parts = [f.anchor, { paragraphId: "later", startOffset: 0, endOffset: 2, selectedText: "后文" }];
  f.db.prepare("UPDATE guide_sources SET anchor_json=? WHERE message_id='m'").run(JSON.stringify({ ...f.anchor, version: 2, fragments: parts }));
  expect(readGuideLocations(f.db, "b").sources[0].spans).toHaveLength(2);
  expect(readGuideLocations(f.db, "b").sources[0].spans[1].start).toBeGreaterThan(readGuideLocations(f.db, "b").sources[0].spans[0].end);
});
it("正文失配或跨书版本不伪造位置，返回可见警告且不修改导读", () => {
  addNode();
  f.db.prepare("UPDATE paragraphs SET text='正文已不同' WHERE id='p'").run();
  expect(readGuideLocations(f.db, "b")).toMatchObject({ sources: [], issues: [expect.stringContaining("无法核对")] });
  f.db.prepare("UPDATE guide_sources SET edition_id='e2' WHERE message_id='m'").run();
  expect(readGuideLocations(f.db, "b")).toMatchObject({ version: 1, sources: [], issues: [expect.stringContaining("无法核对")] });
});
it("个人主题没有原文来源时不制造位置，未知书籍返回404", () => {
  saveGuideRevision(f.db, "b", 0, [{ id: "a", parentId: null, title: "个人", summary: "", sourceIds: [] }], "user", "测试");
  expect(readGuideLocations(f.db, "b")).toEqual({ bookId: "b", version: 1, sources: [], issues: [] });
  expect(() => readGuideLocations(f.db, "absent")).toThrow("不存在");
});
