import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { guideFixture } from "./guide-test-support";
import { enqueueGuideSource, historicalGuideIds, readGuideSources } from "./guide-sources";
let f: ReturnType<typeof guideFixture>;
beforeEach(() => { f = guideFixture(); }); afterEach(() => f.db.close());
describe("仅已完成句读选文进入导读", () => {
  it("入队幂等且保留准确来源", () => { f.message(); expect(enqueueGuideSource(f.db, "m")).toBe(true); expect(enqueueGuideSource(f.db, "m")).toBe(false); expect(readGuideSources(f.db, "b", ["m"])[0].anchor).toEqual(f.anchor); expect(readGuideSources(f.db, "other", ["m"])).toEqual([]); });
  it("聊天、半成品、语义父任务不入队", () => { f.message("chat", { _request: { input: { mode: "chat" } } }); f.message("stream", {}, "streaming"); f.message("error", {}, "error"); f.message("parent", { semantic: { version: 1 } }); for (const id of ["chat", "stream", "error", "parent"]) expect(enqueueGuideSource(f.db, id)).toBe(false); });
  it("已完成语义子块独立入队，导航指回父任务", () => { f.message("unit", { _request: undefined, _semanticParent: "parent" }); expect(enqueueGuideSource(f.db, "unit")).toBe(true); expect(readGuideSources(f.db, "b", ["unit"])[0].messageId).toBe("parent"); });
  it("锚点不能越过书籍版本或改写原文", () => { f.message("wrong", {}, "completed", "t2"); expect(enqueueGuideSource(f.db, "wrong")).toBe(false); f.message("fake", { anchor: { ...f.anchor, selectedText: "这是伪造文字" } }); expect(enqueueGuideSource(f.db, "fake")).toBe(false); });
  it("历史迁移只查本书未纳入的已完成句读", () => { f.message(); f.message("unread", {}, "error"); expect(historicalGuideIds(f.db, "b")).toEqual(["m"]); enqueueGuideSource(f.db, "m"); expect(historicalGuideIds(f.db, "b")).toEqual([]); });
});
