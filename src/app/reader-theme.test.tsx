// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_READING_APPEARANCE, READING_APPEARANCE_STORAGE_KEYS, READING_THEMES, writeReadingAppearance, type ReadingThemeId } from "@/lib/reading-appearance";

const pagination = vi.hoisted(() => ({ pages: [], pageIndex: 0, currentPage: undefined, setPageIndex: vi.fn(), setAnchor: vi.fn(), anchor: null, busy: false, error: "", renderedScale: 1 }));
// WHY：只替换 jsdom 不具备的排版测量；使用真实页面、外观控件、存储事件和工作区切换。
vi.mock("@/hooks/use-reader-pages", () => ({ useReaderPages: () => pagination }));
import Home from "./page";
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", undefined);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    if (url.pathname === "/api/library") return Response.json([]);
    if (url.pathname === "/api/settings/ai") return Response.json({ model: "test-model" });
    if (url.pathname === "/api/annotations") return Response.json({ annotations: [] });
    throw new Error("测试未允许访问 " + url.pathname);
  }));
  localStorage.clear(); document.documentElement.removeAttribute("style"); delete document.documentElement.dataset.readingTheme;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); localStorage.clear();
  document.documentElement.removeAttribute("style"); delete document.documentElement.dataset.readingTheme;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function click(name: string) {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.getAttribute("aria-label") === name || button.textContent === name);
  if (!button) throw new Error("按钮不存在：" + name);
  await act(async () => button.click());
}
function expectTheme(themeId: ReadingThemeId) {
  const theme = READING_THEMES.find(theme => theme.id === themeId)!;
  const shell = host.querySelector<HTMLElement>(".app-shell")!;
  expect(shell.classList.contains("theme-" + themeId)).toBe(true);
  expect(document.documentElement.dataset.readingTheme).toBe(themeId);
  for (const node of [shell, document.documentElement]) {
    expect(node.style.getPropertyValue("--reading-paper")).toBe(theme.paper);
    expect(node.style.getPropertyValue("--reading-text")).toBe(theme.text);
    expect(node.style.getPropertyValue("--reading-sidebar-background")).toBe(theme.sidebar);
    expect(node.style.getPropertyValue("--reading-assistant-background")).toBe(theme.assistant);
  }
}
async function chooseTheme(theme: ReadingThemeId) {
  await click("更多阅读选项");
  const select = host.querySelector<HTMLSelectElement>('[aria-label="阅读主题"]')!;
  await act(async () => { select.value = theme; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await click("关闭阅读选项");
}

describe("工作台整页主题同步", () => {
  it.each(READING_THEMES.map(theme => theme.id))("已保存的 %s 主题挂载后同时恢复到根节点与工作台", async theme => {
    writeReadingAppearance(localStorage, { ...DEFAULT_READING_APPEARANCE, theme });
    await act(async () => root.render(<Home />)); expectTheme(theme);
  });
  it("阅读选项、书架切换、跨标签更新均保持根主题一致", async () => {
    await act(async () => root.render(<Home />)); await click("阅读");
    await chooseTheme("dark"); expectTheme("dark");
    await click("书架"); expectTheme("dark"); expect(host.querySelector(".bookshelf-workspace")).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(READING_APPEARANCE_STORAGE_KEYS.preferences)!).theme).toBe("dark");
    writeReadingAppearance(localStorage, { ...DEFAULT_READING_APPEARANCE, theme: "paper" });
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: READING_APPEARANCE_STORAGE_KEYS.preferences })));
    expectTheme("paper");
  });
  it("保存失败仍同步本次选中主题到根节点，并明确反馈未保存", async () => {
    await act(async () => root.render(<Home />)); await click("阅读");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    await chooseTheme("green"); expectTheme("green");
    expect(host.textContent).toContain("阅读选项已应用，但保存失败"); expect(error).toHaveBeenCalled();
  });
});
