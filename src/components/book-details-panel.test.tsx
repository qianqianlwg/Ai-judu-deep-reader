// @vitest-environment jsdom
import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {BookDetailsPanel, type BookDetailsPanelProps} from "./book-details-panel";
let host: HTMLDivElement; let root: Root; let trigger: HTMLButtonElement;
const open = vi.fn(), close = vi.fn(), updated = vi.fn(), archived = vi.fn(), retry = vi.fn();
const book = {id: "a", title: "原始长书名", displayTitle: "简洁书名", author: "作者", editions: [
  {id: "new", fileName: "新版.epub", fileType: ".epub", hasOriginalFile: true, createdAt: "2026-09-22"},
  {id: "old", fileName: "旧版.pdf", fileType: ".pdf", hasOriginalFile: true, createdAt: "2025-01-01"},
]};
async function render(patch: Partial<BookDetailsPanelProps> = {}) {
  await act(async () => root.render(<BookDetailsPanel book={book} currentBookId="b" resumeEdition="old" location="第二章" onClose={close} onOpen={open} onUpdated={updated} onArchived={archived} onRetryCover={retry} {...patch} />));
}
function click(label: string) {
  const target = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label || button.getAttribute("aria-label") === label);
  if (!target) throw new Error("缺少按钮 " + label); act(() => target.click());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks();
  // WHY：jsdom不实现顶层对话框；只替代浏览器原生能力，产品仍使用showModal。
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {configurable: true, value: function(this: HTMLDialogElement) {this.open = true; this.querySelector<HTMLButtonElement>("button")?.focus();}});
  Object.defineProperty(HTMLDialogElement.prototype, "close", {configurable: true, value: function(this: HTMLDialogElement) {this.open = false;}});
  trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {act(() => root.unmount()); host.remove(); trigger.remove(); Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal"); Reflect.deleteProperty(HTMLDialogElement.prototype, "close"); vi.restoreAllMocks(); vi.unstubAllGlobals();});
it("模态概览先显示书名和位置，不把技术ID、改名及下架放在主层", async () => {
  await render(); expect(host.querySelector("dialog")?.open).toBe(true);
  const overview = host.querySelector<HTMLElement>('[aria-label="书籍概览"]')!;
  expect(overview.hidden).toBe(false); expect(overview.textContent).toContain("第二章"); expect(overview.textContent).toContain("旧版.pdf");
  expect(host.querySelector<HTMLElement>('[aria-label="管理书籍"]')?.hidden).toBe(true);
  expect(host.querySelector<HTMLElement>('[aria-label="文件与版本"]')?.hidden).toBe(true);
  expect(host.querySelector("h3")?.textContent).toBe("简洁书名"); expect(open).not.toHaveBeenCalled();
});
it("查看非当前书籍版本不打开正文，明确点击才传递准确身份", async () => {
  await render({initialSection: "files", currentBookId: "a", currentEditionId: "old"});
  const old = host.querySelector<HTMLButtonElement>('[data-edition-id="old"]')!;
  expect(old.getAttribute("aria-current")).toBe("true"); expect(host.querySelector("details")?.open).toBe(false);
  expect(open).not.toHaveBeenCalled(); act(() => old.click()); expect(open).toHaveBeenCalledWith("a", "old");
});
it("继续阅读使用记住的版本而非最新文件，新书保持默认打开语义", async () => {
  await render(); click("继续阅读↗"); expect(open).toHaveBeenLastCalledWith("a", "old");
  await render({resumeEdition: undefined, location: undefined}); click("开始阅读↗"); expect(open).toHaveBeenLastCalledWith("a");
});
it("关闭按钮、Escape都通知关闭，卸载后焦点回到触发器", async () => {
  await render(); click("关闭书籍信息"); expect(close).toHaveBeenCalledOnce();
  const cancel = new Event("cancel", {cancelable: true}); act(() => host.querySelector("dialog")!.dispatchEvent(cancel));
  expect(cancel.defaultPrevented).toBe(true); expect(close).toHaveBeenCalledTimes(2);
  act(() => root.render(null)); expect(document.activeElement).toBe(trigger);
});
it("忙碌期间禁用阅读和写操作，允许切分区与关闭", async () => {
  await render({busy: true}); click("管理"); click("重新加载封面"); click("继续阅读↗");
  expect(open).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLButtonElement>('[aria-label="下架《简洁书名》"]')?.disabled).toBe(true);
  expect(host.querySelector<HTMLInputElement>("input")?.disabled).toBe(true); click("关闭书籍信息"); expect(close).toHaveBeenCalledOnce();
});
it("封面重试和下架确认分开，不触发阅读；下架失败保留面板并显示错误", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({error: "暂时无法下架"}, {status: 503})));
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  await render({initialSection: "manage"}); click("重新加载封面"); expect(retry).toHaveBeenCalledOnce();
  click("下架《简洁书名》"); expect(archived).not.toHaveBeenCalled();
  expect(host.querySelector(".book-shelf-confirm")?.textContent).toContain("均保留");
  await act(async () => click("确认下架")); expect(host.querySelector('[role="alert"]')?.textContent).toBe("暂时无法下架");
  expect(consoleError).toHaveBeenCalled(); expect(archived).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
});
it("管理中成功改名刷新书架；成功下架才通知父层", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({bookId: "a", displayTitle: "简洁书名"})).mockResolvedValueOnce(Response.json({bookId: "a", archived: true}));
  vi.stubGlobal("fetch", fetcher); await render({initialSection: "manage"});
  await act(async () => click("保存书名")); expect(updated).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe("/api/books/a/display-title");
  click("下架《简洁书名》"); await act(async () => click("确认下架")); expect(archived).toHaveBeenCalledOnce(); expect(open).not.toHaveBeenCalled();
});
