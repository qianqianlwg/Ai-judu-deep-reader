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
  it("书籍与目录入口可用、折叠不清空当前选择", () => {
    render(); act(() => button("甲书").click()); expect(openBook).toHaveBeenCalledWith("a");
    act(() => host.querySelector<HTMLButtonElement>(".toc-item")?.click()); expect(openChapter).toHaveBeenCalledWith("c");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="收起书籍"]')?.click()); expect(host.querySelector(".shelf-book")).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="展开书籍"]')?.click()); expect(host.querySelector(".shelf-book.active")).not.toBeNull();
  });
  it("生成中禁用切书与导入，但仍允许查看知识库", () => {
    render({ busy: true }); expect(button("甲书").disabled).toBe(true); expect(button("导入书籍").disabled).toBe(true);
    act(() => button("甲书").click()); expect(openBook).not.toHaveBeenCalled();
    act(() => button("知识库").click()); expect(navigate).toHaveBeenCalledWith("knowledge");
  });
});


describe("侧栏版本导航", () => {
  it("折叠同名记录不丢身份，展开后每个版本都可选", () => {
    const editions = [{ id: "new", fileName: "新文件.epub", fileType: "epub", createdAt: "2026-01-01" }, { id: "old", fileName: "旧文件.epub", fileType: "epub", createdAt: "2025-01-01" }];
    render({ books: [{ id: "a", title: "同名书", author: "作者", editions }, { id: "b", title: "同名书", author: "作者", editions: [{ ...editions[0], id: "b-new" }] }], currentEditionId: "new" });
    expect(host.querySelectorAll(".shelf-book-group")).toHaveLength(2); expect(host.querySelectorAll("[data-edition-id]")).toHaveLength(3);
    expect(host.querySelector('[data-edition-id="new"]')?.getAttribute("aria-current")).toBe("true");
    act(() => host.querySelector<HTMLButtonElement>('[data-edition-id="old"]')?.click()); expect(openBook).toHaveBeenCalledWith("a", "old");
  });
});
