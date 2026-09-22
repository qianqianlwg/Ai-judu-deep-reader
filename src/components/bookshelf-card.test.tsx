// @vitest-environment jsdom
import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {beforeEach, afterEach, it, expect, vi} from "vitest";
import {BookshelfCard} from "./bookshelf-card";
let host: HTMLDivElement; let root: Root;
const open = vi.fn(), details = vi.fn();
const book = {id: "book-a", title: "同名书", author: "作者", editions: [{id: "old", fileName: "旧.pdf", fileType: ".pdf", createdAt: "2026-01-01"}]};
beforeEach(() => {vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);});
afterEach(() => {act(() => root.unmount()); host.remove(); vi.unstubAllGlobals();});
async function render(busy = false) {await act(async () => root.render(<BookshelfCard book={book} currentBookId="other" resumeEdition="old" onOpen={open} onDetails={details} busy={busy} />));}
it("书卡不内嵌维护表单和ID，仅用小菜单打开独立详情", async () => {
  await render(); const menu = host.querySelector("details")!;
  expect(menu.open).toBe(false); expect(host.querySelector("input")).toBeNull(); expect(host.textContent).not.toContain("book-a");
  act(() => {menu.open = true; menu.querySelector<HTMLButtonElement>("button")!.click();});
  expect(details).toHaveBeenCalledWith("book-a", "overview"); expect(open).not.toHaveBeenCalled(); expect(menu.open).toBe(false);
  expect(document.activeElement).toBe(menu.querySelector("summary"));
});
it("菜单各入口传递真实书籍身份与正确分区", async () => {
  await render(); const actions = host.querySelectorAll<HTMLButtonElement>(".bookshelf-menu-content button");
  act(() => actions[1].click()); expect(details).toHaveBeenLastCalledWith("book-a", "files");
  act(() => actions[2].click()); expect(details).toHaveBeenLastCalledWith("book-a", "manage"); expect(open).not.toHaveBeenCalled();
});
it("Escape与外部点击关闭菜单，Escape归还焦点", async () => {
  await render(); const menu = host.querySelector("details")!;
  act(() => {menu.open = true; menu.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));});
  expect(menu.open).toBe(false); expect(document.activeElement).toBe(menu.querySelector("summary"));
  act(() => {menu.open = true; document.body.dispatchEvent(new Event("pointerdown", {bubbles: true}));}); expect(menu.open).toBe(false);
});
it("继续阅读恢复旧版本，忙碌时只允许查看信息不允许阅读", async () => {
  await render(); act(() => host.querySelector<HTMLButtonElement>(".bookshelf-open")!.click()); expect(open).toHaveBeenCalledWith("book-a", "old");
  open.mockClear(); await render(true); act(() => host.querySelector<HTMLButtonElement>(".bookshelf-open")!.click()); expect(open).not.toHaveBeenCalled();
  act(() => host.querySelector<HTMLButtonElement>(".bookshelf-menu-content button")!.click()); expect(details).toHaveBeenCalled();
});
