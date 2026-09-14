// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceLibrary } from "./workspace-library";
let host: HTMLDivElement; let root: Root;
const restore = vi.fn(async () => undefined), empty = vi.fn(), fetcher = vi.fn<typeof fetch>();
const books = [{ id: "a", title: "同名", author: "作者", editions: [{ id: "new", fileName: "新版.epub", fileType: "epub", createdAt: "2026-01-01" }, { id: "old", fileName: "旧版.epub", fileType: "epub", createdAt: "2025-01-01" }] }, { id: "b", title: "同名", author: "作者", editions: [] }];
function View() { const library = useWorkspaceLibrary(restore, empty, fetcher); return <><output>{library.books.map(book => book.id).join(",")}|{library.error}</output><button onClick={library.refresh}>刷新</button></>; }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); localStorage.clear(); fetcher.mockImplementation(async () => Response.json(books)); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("useWorkspaceLibrary", () => {
  it("保留同名不同书，按BookID+EditionID恢复旧版", async () => {
    localStorage.setItem("judu:active-book", "a"); localStorage.setItem("judu:edition:a", "old");
    await act(async () => root.render(<View />)); expect(host.textContent).toContain("a,b"); expect(restore).toHaveBeenCalledWith("a", "old");
    await act(async () => host.querySelector("button")?.click()); expect(restore).toHaveBeenCalledOnce();
  });
  it("不存在的缓存版本不借用另一书版本", async () => {
    localStorage.setItem("judu:active-book", "b"); localStorage.setItem("judu:edition:b", "old");
    await act(async () => root.render(<View />)); expect(restore).toHaveBeenCalledWith("b", undefined);
  });
  it("读取失败有错误与刷新恢复，不伪造空书架成功", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined); fetcher.mockRejectedValueOnce(new Error("网络失败"));
    await act(async () => root.render(<View />)); expect(host.textContent).toContain("网络失败"); expect(empty).toHaveBeenCalledOnce();
    await act(async () => host.querySelector("button")?.click()); expect(host.textContent).toContain("a,b"); expect(restore).toHaveBeenCalledOnce();
  });
});
