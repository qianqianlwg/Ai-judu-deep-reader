import { describe, expect, it, vi } from "vitest";
import { restoreWorkspaceReadingAnchor, selectionFromSearchResult } from "./workspace-reading-location";
const paragraph = { id: "b", text: "前😀承认需要双方，承认形成关系。" };
describe("原文导航位置", () => {
  it("命中文本和UTF16位置一起验证，不保留旧段落的偏移", () => {
    expect(selectionFromSearchResult({ paragraphId: "b", matchedText: "承认", startOffset: 3 }, paragraph)).toEqual({ paragraphId: "b", startOffset: 3, endOffset: 5, text: "承认" });
    expect(selectionFromSearchResult({ paragraphId: "b", matchedText: "承认", startOffset: 2 }, paragraph)).toBeNull();
  });
  it("缺省偏移可定位精确摘录，概括、省略片段或错误段落不作为选区", () => {
    expect(selectionFromSearchResult({ paragraphId: "b", excerpt: "承认需要双方" }, paragraph)?.startOffset).toBe(3);
    expect(selectionFromSearchResult({ paragraphId: "b", excerpt: "承认…双方" }, paragraph)).toBeNull();
    expect(selectionFromSearchResult({ paragraphId: "a", matchedText: "承认" }, paragraph)).toBeNull();
    expect(selectionFromSearchResult({ paragraphId: "b", matchedText: "未出现", excerpt: "承认" }, paragraph)).toBeNull();
  });
  it("无效偏移不被强制转换或裁剪为可提交选区", () => {
    for (const startOffset of [-1, 3.5, Number.NaN, 1000]) expect(selectionFromSearchResult({ paragraphId: "b", matchedText: "承认", startOffset }, paragraph)).toBeNull();
  });
  it("阅读恢复仍验证实际段落和边界", () => {
    expect(restoreWorkspaceReadingAnchor(JSON.stringify({ paragraphId: "b", offset: 3 }), [paragraph])).toEqual({ paragraphId: "b", offset: 3 });
    expect(restoreWorkspaceReadingAnchor(JSON.stringify({ paragraphId: "b", offset: 100 }), [paragraph])).toBeNull();
    expect(restoreWorkspaceReadingAnchor(JSON.stringify({ paragraphId: "a", offset: 0 }), [paragraph])).toBeNull();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(restoreWorkspaceReadingAnchor("broken", [paragraph])).toBeNull(); expect(log).toHaveBeenCalled(); log.mockRestore();
  });
});
