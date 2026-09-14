// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceSelection } from "./workspace-selection";
let host: HTMLDivElement; let root: Root; let frames: Map<number, FrameRequestCallback>; let nextFrame: number;
const received = vi.fn();
function View({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null); useWorkspaceSelection(ref, received, enabled);
  return <><div ref={ref}><p data-paragraph-id="p" data-source-start="29"><span data-reader-text="">自我意识😀通过承认认识自己。</span><span data-reader-decoration="">注</span></p></div><p data-paragraph-id="other" data-source-start="0">外部聊天原文</p><button type="button">句读一下</button></>;
}
function select(id = "p", start = 2, end = 8) {
  const node = host.querySelector('[data-paragraph-id="' + id + '"]')?.firstChild;
  const text = node?.nodeType === Node.TEXT_NODE ? node : node?.firstChild;
  if (!text) throw new Error("选文节点不存在");
  const range = document.createRange(); range.setStart(text, start); range.setEnd(text, end);
  const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
}
function flush() { act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(performance.now())); }); }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); received.mockReset(); frames = new Map(); nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); act(() => root.render(<View />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.getSelection()?.removeAllRanges(); vi.unstubAllGlobals(); });
describe("useWorkspaceSelection", () => {
  it("selectionchange 无需 mouseup 即可捕获程序选区及UTF-16偏移", () => {
    act(() => { select(); document.dispatchEvent(new Event("selectionchange")); }); flush();
    expect(received).toHaveBeenCalledWith({ paragraphId: "p", startOffset: 31, endOffset: 37, text: "意识😀通过" });
  });
  it("键盘选文后keyup捕获，不依赖鼠标事件", () => {
    act(() => { select(); host.querySelector("[data-reader-text]")?.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", shiftKey: true, bubbles: true })); }); flush();
    expect(received).toHaveBeenCalledOnce();
  });
  it("点击操作按钮折叠DOM选区时保留前一刻有效快照", () => {
    act(() => { select(); document.dispatchEvent(new Event("selectionchange")); document.getSelection()?.removeAllRanges(); host.querySelector("button")?.click(); document.dispatchEvent(new Event("selectionchange")); }); flush();
    expect(received).toHaveBeenCalledOnce(); expect(received.mock.calls[0][0].text).toBe("意识😀通过");
    act(() => document.dispatchEvent(new Event("selectionchange"))); flush(); expect(received).toHaveBeenCalledOnce();
  });
  it("不捕获聊天区或停用阅读器的选文", () => {
    act(() => { select("other", 0, 4); document.dispatchEvent(new Event("selectionchange")); }); flush(); expect(received).not.toHaveBeenCalled();
    act(() => root.render(<View enabled={false} />)); act(() => { select(); document.dispatchEvent(new Event("selectionchange")); }); flush(); expect(received).not.toHaveBeenCalled();
  });
  it("同帧多次选文更新只保留最新一份快照", () => {
    act(() => { select(); document.dispatchEvent(new Event("selectionchange")); select("p", 0, 4); document.dispatchEvent(new Event("selectionchange")); }); flush();
    expect(received).toHaveBeenCalledOnce(); expect(received.mock.calls[0][0]).toMatchObject({ startOffset: 29, endOffset: 33, text: "自我意识" });
  });
});
