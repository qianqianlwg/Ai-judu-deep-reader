// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { useReadingAnnotations, type ReadingAnnotationsResult } from "./use-reading-annotations";
import type { ReadingSelection } from "@/lib/reader-selection";
import type { TextAnnotation } from "@/lib/annotations";

let host: HTMLDivElement; let root: Root; let latest: ReadingAnnotationsResult | null; let fetchMock: ReturnType<typeof vi.fn>;
const source = [{ id: "p", text: "甲乙丙", chapterId: "c", chapterTitle: "章" }];
const selection: ReadingSelection = { paragraphId: "p", startOffset: 0, endOffset: 2, text: "甲乙" };
const notice = vi.fn(); const setWorkspaceView = vi.fn(); const setSelected = vi.fn(); const setSelectionAnchor = vi.fn(); const setReadingAnchor = vi.fn(); const setActiveSource = vi.fn(); const setSelectionMenu = vi.fn(); const openConversation = vi.fn();
function Harness({ anchor = selection, editionId = "e" }: { anchor?: ReadingSelection | null; editionId?: string } = {}) {
  const result = useReadingAnnotations({ bookId: "b", editionId, sourceParagraphs: source, bookConcepts: [{ name: "甲", text: "概念" }], selectionAnchor: anchor, setNotice: notice, setWorkspaceView, setSelected, setSelectionAnchor, setReadingAnchor, setActiveSource, setSelectionMenu, openConversation });
  useEffect(() => { latest = result; }, [result]);
  return <output data-testid="concepts">{result.visibleConcepts.map(item => item.name).join(",")}</output>;
}
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); latest = null; localStorage.clear();
  fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes("reading-marks") ? Response.json({ marks: [] }) : Response.json({ annotations: [] })); vi.stubGlobal("fetch", fetchMock);
  await act(async () => root.render(<Harness />)); await act(async () => { await Promise.resolve(); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("useReadingAnnotations", () => {
  it("读取服务端标注和阅读标注，并合并句读概念", () => {
    expect(host.querySelector("[data-testid=concepts]")?.textContent).toBe("甲");
    expect(fetchMock).toHaveBeenCalledWith("/api/annotations?editionId=e");
    expect(fetchMock).toHaveBeenCalledWith("/api/reading-marks?editionId=e", { cache: "no-store" });
  });
  it("保存句读标注时先更新离线回退，再提交服务端", async () => {
    const annotation: TextAnnotation = { id: "a", paragraphId: "p", startOffset: 0, endOffset: 2, textHash: "hash", threadId: "t", messageId: "m", summary: "句读", concepts: [], createdAt: "now" };
    await act(async () => { await latest!.saveAnnotation(annotation); });
    expect(localStorage.getItem("judu:annotations:b:e")).toContain('"id":"a"'); expect(fetchMock).toHaveBeenCalledWith("/api/annotations", expect.objectContaining({ method: "POST" }));
  });
  it("打开历史标注会回填选区并定位会话", () => {
    latest!.openAnnotation({ id: "a", paragraphId: "p", startOffset: 1, endOffset: 3, textHash: "hash", threadId: "t", messageId: "m", summary: "", concepts: [], createdAt: "now" });
    expect(setWorkspaceView).toHaveBeenCalledWith("reader"); expect(setSelected).toHaveBeenCalledWith("乙丙"); expect(setReadingAnchor).toHaveBeenCalledWith({ paragraphId: "p", offset: 1 }); expect(openConversation).toHaveBeenCalledWith("t", "m");
  });
  it("保存手动标注生成UTF16锚点并给出状态", async () => {
    const mark = { id: "mark-1", editionId: "e", kind: "favorite", color: "yellow", note: "", anchors: [{ paragraphId: "p", startOffset: 0, endOffset: 2, selectedText: "甲乙", textHash: "hash" }], createdAt: "now", updatedAt: "now" };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => String(input).endsWith("/api/reading-marks") ? Response.json({ mark }) : Response.json({ annotations: [] }));
    await act(async () => { await latest!.saveManualMark("favorite"); });
    expect(fetchMock).toHaveBeenCalledWith("/api/reading-marks", expect.objectContaining({ method: "POST", body: expect.stringContaining('"startOffset":0') })); expect(notice).toHaveBeenCalledWith("已收藏选文"); expect(latest!.readingMarks).toEqual([mark]);
  });
});


describe("手动标注失败反馈", () => {
  it.each([null, {}, { marks: [] }, { mark: { id: "invalid" } }])("无有效保存回执不误报成功也不关闭选区：%j", async (body) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(Response.json(body));
    await act(async () => { await latest!.saveManualMark("highlight"); });
    expect(notice).toHaveBeenCalledWith(expect.stringContaining("无法确认是否已保存"));
    expect(setSelectionMenu).not.toHaveBeenCalled(); expect(latest!.readingMarks).toEqual([]);
    expect(error).toHaveBeenCalled(); error.mockRestore();
  });
  it("选文已经丢失时明确反馈，不静默无操作", async () => {
    await act(async () => root.render(<Harness anchor={null} />)); fetchMock.mockClear();
    await act(async () => { await latest!.saveManualMark("note", "笔记"); });
    expect(notice).toHaveBeenCalledWith(expect.stringContaining("选文已失效"));
    expect(fetchMock).not.toHaveBeenCalled(); expect(setSelectionMenu).not.toHaveBeenCalled();
  });
  it("版本尚未就绪时明确反馈", async () => {
    await act(async () => root.render(<Harness editionId="" />)); fetchMock.mockClear();
    await act(async () => { await latest!.saveManualMark("highlight"); });
    expect(notice).toHaveBeenCalledWith(expect.stringContaining("版本尚未就绪")); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["highlight", "note"] as const)("有效 %s 回执更新状态后才关闭选文浮层", async (kind) => {
    const mark = { id: "mark-1", editionId: "e", kind, color: "green", note: kind === "note" ? "保留这段想法" : "", anchors: [{ paragraphId: "p", startOffset: 0, endOffset: 2, selectedText: "甲乙", textHash: "hash" }], createdAt: "now", updatedAt: "now" };
    fetchMock.mockResolvedValueOnce(Response.json({ mark }));
    await act(async () => { await latest!.saveManualMark(kind, mark.note, "green"); });
    expect(latest!.readingMarks).toEqual([mark]); expect(setSelectionMenu).toHaveBeenCalledWith(null);
    expect(notice).toHaveBeenCalledWith(kind === "note" ? "笔记已保存" : "已标亮选文");
    if (kind === "highlight") expect(latest!.renderedAnnotations).toEqual([expect.objectContaining({ kind: "highlight", markColor: "green" })]);
  });
});
