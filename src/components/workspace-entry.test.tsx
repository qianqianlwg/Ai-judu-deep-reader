// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceEntry } from "./workspace-entry";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock("./bookshelf-home", () => ({ BookshelfHome: () => <main aria-label="全局书架">所有书籍</main> }));
let root: Root; let host: HTMLDivElement;
const mountBook = vi.fn();
function Book() { mountBook(); return <main aria-label="本书工作台">阅读 · 导读 · 知识库</main>; }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); localStorage.clear(); window.history.replaceState(null, "", "/"); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); window.history.replaceState(null, "", "/"); vi.unstubAllGlobals(); });
const render = () => act(() => root.render(<WorkspaceEntry><Book /></WorkspaceEntry>));
it("首页始终从全部书籍开始，不因最近阅读缓存挂载书内工作台", () => { localStorage.setItem("judu:active-book", "a"); render(); expect(host.textContent).toBe("所有书籍"); expect(mountBook).not.toHaveBeenCalled(); });
it("明确选书后进入本书工作台，返回无选书参数的首页后退出它", () => { window.history.replaceState(null, "", "/?bookId=a&editionId=old"); render(); expect(host.querySelector('[aria-label="本书工作台"]')).not.toBeNull(); window.history.replaceState(null, "", "/"); render(); expect(host.querySelector('[aria-label="本书工作台"]')).toBeNull(); expect(host.querySelector('[aria-label="全局书架"]')).not.toBeNull(); });
it("空选书参数不能越过书架进入未绑定书籍的工作台", () => { window.history.replaceState(null, "", "/?bookId="); render(); expect(mountBook).not.toHaveBeenCalled(); });
