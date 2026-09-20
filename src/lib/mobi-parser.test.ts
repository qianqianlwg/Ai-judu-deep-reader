import { describe, expect, it, vi } from "vitest";
import { inspectMobiContainer } from "./mobi-format";
import { parseMobiFile } from "./mobi-parser";
import { makeMobiFixture } from "./mobi-fixture";
import * as worker from "./mobi-worker-client";

describe("候选MOBI解析：未宣称KF8通过", () => {
  it.each([1, 2] as const)("MOBI6 compression=%s真实候选库提取中文和emoji", async compression => {
    const bytes = makeMobiFixture({ compression });
    expect(inspectMobiContainer(bytes)).toMatchObject({ kind: "mobi", version: 6 });
    const result = await parseMobiFile(bytes, "candidate.mobi");
    expect(result.title).toBe("本地测试标题");
    expect(result.chapters.map(chapter => chapter.paragraphs)).toEqual([["第一段。"], ["第二段😀。"]]);
    expect(result.chapters.map(chapter => chapter.sourceHref)).toEqual(["mobi-v1/mobi/0", "mobi-v1/mobi/1"]);
  }, 20000);
  it("原调用方在await期间修改Buffer不改变已核验快照", async () => {
    const bytes = makeMobiFixture(); const pending = parseMobiFile(bytes, "snapshot.mobi"); bytes.fill(0);
    const parsed = await pending; expect(parsed.chapters[0].paragraphs).toEqual(["第一段。"]);
  }, 20000);
  it("DRM在启动解析进程之前被拒绝", async () => {
    const bytes = makeMobiFixture(); bytes.writeUInt16BE(2, bytes.readUInt32BE(78) + 12);
    const spy = vi.spyOn(worker, "runMobiWorker");
    try { await expect(parseMobiFile(bytes, "encrypted.azw")).rejects.toThrow(/DRM|加密/u); expect(spy).not.toHaveBeenCalled(); }
    finally { spy.mockRestore(); }
  });
  it("合法无EXTH文件可由固定候选补丁解析，不注入伪EXTH", async () => {
    const bytes = makeMobiFixture({ exth: false });
    expect(inspectMobiContainer(bytes).kind).toBe("mobi");
    const result = await parseMobiFile(bytes, "no-exth.mobi");
    expect(result.chapters).toHaveLength(2);
  }, 20000);
  it("正文与标题同文不删除真实段落", async () => {
    const result = await parseMobiFile(makeMobiFixture({ text: "<html><body><h1>同文标题</h1><p>同文标题</p><p>独立正文。</p></body></html>" }), "same.mobi");
    expect(result.chapters[0].paragraphs).toEqual(["同文标题", "独立正文。"]);
  }, 20000);
});
