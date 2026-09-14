// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bookshelf, type BookshelfProps } from "./bookshelf";
let root: Root; let host: HTMLDivElement;
const onOpen = vi.fn(), onImport = vi.fn(), onRefresh = vi.fn();
const props: BookshelfProps = { books: [{ id: "a", title: "精神现象学", author: "黑格尔" }, { id: "b", title: "国富论", author: "斯密" }], currentBookId: "a", onOpenBook: onOpen, onImport, onRefresh };
function render(patch: Partial<BookshelfProps> = {}) { act(() => root.render(<Bookshelf {...props} {...patch} />)); }
function click(selector: string) { act(() => host.querySelector<HTMLButtonElement>(selector)?.click()); }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
describe("Bookshelf", () => {
  it("真实书卡可阅读，当前书提供继续阅读入口", () => {
    render(); expect(host.querySelectorAll("[data-book-id]")).toHaveLength(2);
    expect(host.querySelector('[data-book-id="a"]')?.textContent).toContain("继续阅读");
    click('[data-book-id="b"] button'); expect(onOpen).toHaveBeenCalledWith("b");
  });
  it("按书名/作者实际筛选，不修改书架数据", () => {
    render(); const input = host.querySelector("input")!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "黑格尔"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(host.querySelectorAll("[data-book-id]")).toHaveLength(1); expect(host.querySelector('[data-book-id="a"]')).not.toBeNull();
  });
  it("空书架提供导入入口，错误有刷新恢复路径", () => {
    render({ books: [] }); expect(host.textContent).toContain("从一本书开始");
    click(".workspace-empty button"); expect(onImport).toHaveBeenCalledOnce();
    render({ books: [], error: "读取失败" }); expect(host.querySelector('[role="alert"]')?.textContent).toContain("读取失败");
    click('[role="alert"] button'); expect(onRefresh).toHaveBeenCalledOnce();
  });
  it("运行中书卡及导入不能绕过保护", () => {
    render({ busy: true }); click(".bookshelf-open"); click(".workspace-heading button");
    expect(onOpen).not.toHaveBeenCalled(); expect(onImport).not.toHaveBeenCalled();
  });
});


describe("书架全部版本入口", () => {
  it("同名BookID分别展示，每个版本按钮提交准确BookID和EditionID", () => {
    const editions = [{ id: "new", fileName: "新版.epub", fileType: "epub", createdAt: "2026-01-01" }, { id: "old", fileName: "旧版.pdf", fileType: "pdf", createdAt: "2025-01-01" }];
    render({ books: [{ id: "a", title: "同名书", author: "作者", editions }, { id: "b", title: "同名书", author: "作者", editions: [{ ...editions[0], id: "b-edition" }] }], currentEditionId: "old" });
    expect(host.querySelectorAll(".bookshelf-card")).toHaveLength(2); expect(host.querySelectorAll("[data-edition-id]")).toHaveLength(3);
    const old = host.querySelector<HTMLButtonElement>('[data-book-id="a"] [data-edition-id="old"]')!;
    expect(old.textContent).toContain("旧版.pdf"); expect(old.textContent).toContain("2025"); expect(old.getAttribute("aria-current")).toBe("true");
    act(() => old.click()); expect(onOpen).toHaveBeenCalledWith("a", "old");
    act(() => host.querySelector<HTMLButtonElement>('[data-book-id="b"] [data-edition-id="b-edition"]')?.click()); expect(onOpen).toHaveBeenCalledWith("b", "b-edition");
  });
});
