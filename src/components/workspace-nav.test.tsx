// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceNav, type WorkspaceNavProps } from "./workspace-nav";
let root: Root; let host: HTMLDivElement;
const navigate = vi.fn(), openChapter = vi.fn();
const props: WorkspaceNavProps = { view: "reader", onNavigate: navigate, books: [{ id: "a", title: "甲书", author: "甲" }], currentBookId: "a", chapters: [{ id: "c", title: "第一章" }], currentChapterId: "c", onOpenChapter: openChapter };
function render(patch: Partial<WorkspaceNavProps> = {}) { act(() => root.render(<WorkspaceNav {...props} {...patch} />)); }
function button(text: string): HTMLButtonElement { const node = Array.from(host.querySelectorAll("button")).find(item => item.textContent === text); if (!node) throw new Error("未找到按钮" + text); return node; }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
describe("书内导航层级", () => {
  it("主导航仅有阅读、导读、知识库，并明确展示当前书籍", () => {
    render(); expect(button("阅读").getAttribute("aria-current")).toBe("page");
    expect([...host.querySelectorAll('.workspace-destinations button')].map(node => node.textContent)).toEqual(["阅读", "思维导读", "知识库"]);
    expect(host.querySelector('.workspace-book-context')?.textContent).toContain("甲书");
    act(() => button("思维导读").click()); expect(navigate).toHaveBeenLastCalledWith("guide");
    act(() => button("知识库").click()); expect(navigate).toHaveBeenLastCalledWith("knowledge");
    render({ view: "knowledge" }); expect(button("知识库").getAttribute("aria-current")).toBe("page");
  });
  it("返回书架独立于书内导航，导入只在外层，设置保留在底部", () => {
    render(); const back = host.querySelector<HTMLAnchorElement>('.workspace-shelf-back')!;
    expect(back.getAttribute('href')).toBe('/'); expect(back.closest('.workspace-destinations')).toBeNull(); expect(host.textContent).not.toContain('导入书籍');
    expect(host.querySelector('footer a[href="/settings"]')).not.toBeNull();
  });
  it("只保留本书目录，折叠不清空章节选择", () => {
    render(); expect(host.querySelector('.book-shelf')).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('.toc-item')?.click()); expect(openChapter).toHaveBeenCalledWith('c');
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="收起目录"]')?.click()); expect(host.querySelector('.toc-item')).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="展开目录"]')?.click()); expect(host.querySelector('.toc-item.active')).not.toBeNull();
  });
  it("生成中阻止离开当前书籍，但仍能查看本书知识库", () => {
    render({ busy: true }); const back = host.querySelector<HTMLAnchorElement>('.workspace-shelf-back')!;
    expect(back.getAttribute('aria-disabled')).toBe('true'); const event = new MouseEvent('click', { bubbles: true, cancelable: true }); act(() => back.dispatchEvent(event)); expect(event.defaultPrevented).toBe(true);
    act(() => button('知识库').click()); expect(navigate).toHaveBeenCalledWith('knowledge');
  });
  it.each(['reader', 'knowledge', 'guide'] as const)('%s 都没有其他书籍或版本切换入口', view => { render({ view }); expect(host.querySelector('.book-shelf')).toBeNull(); expect(host.querySelector('[data-edition-id]')).toBeNull(); expect(host.querySelector('.toc-item') !== null).toBe(view === 'reader'); });
});
it("保留目录字体层级，收起导航仍有返回书架的入口", async () => {
  const css = await readFile('src/components/workspace-nav.css', 'utf8');
  expect(css).toContain('[aria-label="主导航"] .workspace-nav-item { font-size: max(14px'); expect(css).toContain('[aria-label="本书目录"] .toc-item { min-height: 32px; padding: 5px 7px; font-size: max(12px');
  expect(css).toContain('.toc-item.active { color: var(--reading-text); font-weight: 600; }'); expect(css).toContain('.workspace-shelf-back::before');
});
