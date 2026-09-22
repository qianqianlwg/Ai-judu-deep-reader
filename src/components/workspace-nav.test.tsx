// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceNav, type WorkspaceNavProps } from "./workspace-nav";
let root: Root; let host: HTMLDivElement;
const navigate = vi.fn(), openBook = vi.fn(), openChapter = vi.fn(), importBook = vi.fn();
const props: WorkspaceNavProps = { view: "reader", onNavigate: navigate, books: [{ id: "a", title: "甲书", author: "甲" }], currentBookId: "a", chapters: [{ id: "c", title: "第一章" }], currentChapterId: "c", onOpenBook: openBook, onOpenChapter: openChapter, onImport: importBook };
function render(patch: Partial<WorkspaceNavProps> = {}) { act(() => root.render(<WorkspaceNav {...props} {...patch} />)); }
function button(text: string): HTMLButtonElement { const node = Array.from(host.querySelectorAll("button")).find(item => item.textContent === text); if (!node) throw new Error("未找到按钮" + text); return node; }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
describe("WorkspaceNav", () => {
  it("三个视图入口真正调用导航且保持当前视图标识", () => {
    render(); expect(button("阅读").getAttribute("aria-current")).toBe("page");
    act(() => button("书架").click()); expect(navigate).toHaveBeenLastCalledWith("bookshelf");
    act(() => button("知识库").click()); expect(navigate).toHaveBeenLastCalledWith("knowledge");
    render({ view: "knowledge" }); expect(button("知识库").getAttribute("aria-current")).toBe("page");
  });
  it("导入归书架菜单，设置只在侧栏底部", () => {
    render(); act(() => button("导入书籍").click()); expect(navigate).toHaveBeenCalledWith("bookshelf"); expect(importBook).toHaveBeenCalledOnce();
    expect(host.querySelectorAll('a[href="/settings"]')).toHaveLength(1); expect(host.querySelector('footer a[href="/settings"]')).not.toBeNull();
  });
  it("只保留本书目录，折叠不清空章节选择", () => {
    render(); expect(host.querySelector(".book-shelf")).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>(".toc-item")?.click()); expect(openChapter).toHaveBeenCalledWith("c");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="收起目录"]')?.click()); expect(host.querySelector(".toc-item")).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="展开目录"]')?.click()); expect(host.querySelector(".toc-item.active")).not.toBeNull();
  });
  it("生成中禁用导入，但仍允许查看知识库，侧栏不再有切书入口", () => {
    render({busy: true}); expect(button("导入书籍").disabled).toBe(true); expect(host.querySelector(".shelf-book")).toBeNull();
    act(() => button("知识库").click()); expect(navigate).toHaveBeenCalledWith("knowledge"); expect(openBook).not.toHaveBeenCalled();
  });
  it.each(["reader", "bookshelf", "knowledge"] as const)("%s 视图都移除重复书籍列表与说明文字", view => {
    render({view}); expect(host.textContent).not.toContain("我的书籍"); expect(host.textContent).not.toContain("在书架搜索");
    expect(host.querySelector(".book-shelf")).toBeNull(); expect(host.querySelector("[data-edition-id]")).toBeNull();
    expect(host.querySelector(".toc-item") !== null).toBe(view === "reader");
  });
});
