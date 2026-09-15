// @vitest-environment jsdom
import { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaginatedParagraph } from "@/lib/pagination";
import type { BookKnowledge } from "@/lib/knowledge";

// WHY：只替换无布局引擎的分页测量，书架、知识卡、会话面板和page请求装配均使用真实组件。
vi.mock("@/hooks/use-reader-pages", () => ({
  useReaderPages: (paragraphs: readonly PaginatedParagraph[]) => {
    const [anchor, update] = useState<{ paragraphId: string; offset: number } | null>(null);
    const setAnchor = useCallback((next: { paragraphId: string; offset: number } | null) => update(next), []);
    const page = { pageNumber: 1, chapterId: paragraphs[0]?.chapterId, chapterTitle: paragraphs[0]?.chapterTitle, paragraphs: [...paragraphs], isChapterStart: true };
    return { pages: [page], currentPage: page, pageIndex: 0, anchor, setAnchor, setPageIndex: vi.fn(), busy: false, error: "", renderedScale: 1 };
  },
}));
import Home from "./page";

const editions = [
  { id: "edition-new", fileName: "新校版.epub", fileType: "epub", createdAt: "2026-09-14T02:00:00Z" },
  { id: "edition-old", fileName: "原译版.epub", fileType: "epub", createdAt: "2026-09-12T02:00:00Z" },
];
const otherEdition = { id: "edition-other", fileName: "另外导入.pdf", fileType: "pdf", createdAt: "2026-09-13T02:00:00Z" };
const books = [
  { id: "book-main", title: "同名哲学书", author: "作者", editions },
  { id: "book-other", title: "同名哲学书", author: "作者", editions: [otherEdition] },
];
const texts: Record<string, string> = { "edition-old": "old:承认 original text with enough context", "edition-new": "new:承认 main text with enough context", "edition-other": "other:承认 text with enough context" };
const threadId = (edition: string) => "thread-" + edition;
const paragraphId = (edition: string) => "paragraph-" + edition;
function thread(edition: string) {
  return { id: threadId(edition), editionId: edition, bookId: edition === "edition-other" ? "book-other" : "book-main", title: edition + "旧会话", createdAt: "2026-09-14", updatedAt: "2026-09-14", messageCount: 2 };
}
function knowledge(edition: string): BookKnowledge {
  const text = texts[edition]; const startOffset = text.indexOf("承认");
  return { editionId: edition, concepts: [{ id: "concept-" + edition, name: "承认", definitions: [{ text: edition + "的定义", recordIds: ["record-" + edition] }], recordIds: ["record-" + edition], updatedAt: "2026-09-14" }], records: [
    { id: "record-" + edition, editionId: edition, annotationId: "annotation-" + edition, messageId: "assistant-" + edition, threadId: threadId(edition), createdAt: "2026-09-14", summary: edition + "的句读记录", excerpt: "承认", chapterTitle: edition + "章", anchor: { editionId: edition, chapterId: "chapter-" + edition, paragraphId: paragraphId(edition), startOffset, endOffset: startOffset + 2, selectedText: "承认" }, locationReason: null, concepts: [{ name: "承认", text: edition + "的定义" }] },
  ] };
}
const fetcher = vi.fn<typeof fetch>();
let host: HTMLDivElement; let root: Root; let frames: Map<number, FrameRequestCallback>; let frameId: number;
let requests: Record<string, unknown>[]; let failFirst: boolean;
let delayedSearch: { promise: Promise<Response>; resolve: (response: Response) => void } | undefined;
function endpoint(input: Parameters<typeof fetch>[0]) { return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://local"); }
function element<T extends HTMLElement = HTMLElement>(selector: string): T { const found = host.querySelector<T>(selector); if (!found) throw new Error("缺少节点：" + selector); return found; }
function button(text: string) { const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === text); if (!found) throw new Error("缺少按钮：" + text); return found; }
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  for (let count = 0; frames.size && count < 6; count += 1) await act(async () => { const queue = [...frames.values()]; frames.clear(); queue.forEach(callback => callback(performance.now())); });
  expect(frames.size).toBe(0);
}
async function click(node: HTMLElement) { await act(async () => node.click()); await settle(); }
async function mount() { await act(async () => root.render(<Home />)); await settle(); }
async function reload() { await act(async () => root.unmount()); root = createRoot(host); await mount(); }
async function chooseEdition(edition: string) { await click(element('.workspace-nav [data-edition-id="' + edition + '"]')); }
async function search() {
  await click(element(".workspace-book-search summary"));
  const input = element<HTMLInputElement>("#workspace-book-query");
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "承认"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => element(".workspace-book-search form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
}
async function selectSource(edition: string, start = 0, end = 10) {
  void start; void end;
  await act(async () => {
    const paragraph = element('[data-paragraph-id="' + paragraphId(edition) + '"]');
    const node = paragraph;
    if (!node) throw new Error("test selection node too short");
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event("selectionchange"));
  }); await settle();
}
function requestUrls(pathname: string) { return fetcher.mock.calls.map(([input]) => endpoint(input)).filter(url => url.pathname === pathname); }
function searchResponse(edition: string) {
  const start = 0; return Response.json({ results: [{ paragraphId: paragraphId(edition), chapterId: "chapter-" + edition, chapterTitle: edition, matchedText: texts[edition], startOffset: start, excerpt: texts[edition] }] });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("ResizeObserver", undefined); vi.stubGlobal("CSS", { escape: (value: string) => value });
  frames = new Map(); frameId = 0; requests = []; failFirst = false; delayedSearch = undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  localStorage.clear(); localStorage.setItem("judu:active-book", "book-main"); localStorage.setItem("judu:edition:book-main", "edition-old");
  for (const book of books) for (const edition of book.editions) localStorage.setItem("judu:thread:" + book.id + ":" + edition.id, threadId(edition.id));
  fetcher.mockImplementation(async (input, init) => {
    const url = endpoint(input); const edition = url.searchParams.get("editionId") ?? "";
    if (url.pathname === "/api/settings/ai") return Response.json({ model: "test-model" });
    if (url.pathname === "/api/library") return Response.json(books);
    if (url.pathname.startsWith("/api/books/")) {
      const book = books.find(item => item.id === url.pathname.split("/").at(-1));
      const selected = book?.editions.find(item => item.id === edition) ?? (edition ? undefined : book?.editions[0]);
      if (!book || !selected) return Response.json({ error: "版本不属于本书" }, { status: 404 });
      return Response.json({ ...book, editionId: selected.id, edition: selected, chapters: [{ id: "chapter-" + selected.id, title: selected.id + "章", paragraphs: [{ id: paragraphId(selected.id), text: texts[selected.id] }] }] });
    }
    if (url.pathname === "/api/annotations") return Response.json({ annotations: [] });
    if (url.pathname === "/api/reading-marks") return Response.json({ marks: [] });
    if (url.pathname === "/api/knowledge") return Response.json(knowledge(edition));
    if (url.pathname === "/api/search/status") return Response.json({ backend: "sqlite", editionId: edition, paragraphCount: 1, indexedCount: 0, vectorIndexed: false, note: "测试" });
    if (url.pathname === "/api/search") return delayedSearch?.promise ?? searchResponse(edition);
    if (url.pathname === "/api/threads") return Response.json({ threads: [thread(edition)] });
    if (url.pathname.startsWith("/api/threads/")) {
      if (url.pathname.split("/").at(-1) !== threadId(edition)) return Response.json({ error: "禁止跨版会话" }, { status: 404 });
      return Response.json({ threadId: threadId(edition), thread: thread(edition), messages: [
        { id: "user-" + edition, role: "user", content: edition + "的旧问题", status: "completed" },
        { id: "assistant-" + edition, role: "assistant", content: edition + "的旧回答", status: "completed" },
      ] });
    }
    if (url.pathname === "/api/analyze/stream") {
      const body: Record<string, unknown> = JSON.parse(String(init?.body)); requests.push(body);
      const event = (name: string, data: unknown) => "event: " + name + "\ndata: " + JSON.stringify(data) + "\n\n";
      const result = failFirst && requests.length === 1 ? event("error", { message: "预算不足，请调整后重试" }) : event("raw_delta", { text: "正常回答" }) + event("done", { content: "正常回答" });
      return new Response(event("meta", { threadId: body.threadId, messageId: body.clientAssistantMessageId, outputFormat: "text" }) + result, { headers: { "Content-Type": "text/event-stream" } });
    }
    throw new Error("不应发送的请求：" + url.pathname);
  });
  vi.stubGlobal("fetch", fetcher); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.getSelection()?.removeAllRanges(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("全部书籍和版本的页面入口", () => {
  it("同名不同BookID均可达，旧版刷新恢复且不会默认跳最新版", async () => {
    await mount();
    expect(element(".reader-sheet").textContent).toContain(texts["edition-old"]);
    expect(requestUrls("/api/books/book-main")[0].searchParams.get("editionId")).toBe("edition-old");
    expect(element('[data-message-id="assistant-edition-old"]').textContent).toContain("旧回答");
    await click(button("书架"));
    expect(host.querySelectorAll(".bookshelf-card")).toHaveLength(2);
    expect(host.querySelectorAll(".bookshelf-card [data-edition-id]")).toHaveLength(3);
    await click(element('.bookshelf-card[data-book-id="book-other"] [data-edition-id="edition-other"]'));
    expect(element(".reader-sheet").textContent).toContain(texts["edition-other"]);
    expect(localStorage.getItem("judu:active-book")).toBe("book-other");
    await reload();
    expect(element(".reader-sheet").textContent).toContain(texts["edition-other"]);
    expect(element('[data-message-id="assistant-edition-other"]').textContent).toContain("旧回答");
  });
  it("同Book切换版本实际换正文，知识、搜索、会话均绑定所选版且能回到旧历史", async () => {
    await mount(); await chooseEdition("edition-new");
    expect(element(".reader-sheet").textContent).toContain(texts["edition-new"]);
    expect(host.querySelector('[data-message-id="assistant-edition-old"]')).toBeNull();
    expect(element('[data-message-id="assistant-edition-new"]').textContent).toContain("旧回答");
    expect(element('.workspace-nav [data-edition-id="edition-new"]').getAttribute("aria-current")).toBe("true");
    await click(button("知识库"));
    expect(element('[data-concept-name="承认"]').textContent).toContain("edition-new的定义");
    await click([...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(item => item.textContent?.startsWith("句读记录"))!);
    await click(button("打开对话"));
    expect(element('[data-message-id="assistant-edition-new"]').getAttribute("data-history-target")).toBe("true");
    expect(requestUrls("/api/threads/" + threadId("edition-new")).at(-1)?.searchParams.get("editionId")).toBe("edition-new");
    await click(button("打开原文"));
    expect(element(".selection-actions").textContent).toContain(String.fromCodePoint(0x5df2, 0x9009, 0x62e9) + " 2 " + String.fromCodePoint(0x4e2a, 0x5b57));
    await search(); await click(element(".search-results button")); expect(element(".selection-actions").textContent).toContain(String.fromCodePoint(0x5df2, 0x9009, 0x62e9));
    expect(requests).toHaveLength(0);
    expect(requestUrls("/api/search").at(-1)?.searchParams.get("editionId")).toBe("edition-new");
    await reload(); expect(element(".reader-sheet").textContent).toContain(texts["edition-new"]);
    await chooseEdition("edition-old");
    expect(element(".reader-sheet").textContent).toContain(texts["edition-old"]);
    expect(element('[data-message-id="assistant-edition-old"]').textContent).toContain("旧回答");
    expect(localStorage.getItem("judu:thread:book-main:edition-new")).toBe(threadId("edition-new"));
  });
  it("多版本书不把未绑定版本的旧会话缓存套到新版本，旧会话仍可从列表选", async () => {
    localStorage.removeItem("judu:thread:book-main:edition-old");
    localStorage.setItem("judu:thread:book-main", threadId("edition-new")); await mount();
    expect(requestUrls("/api/threads/" + threadId("edition-new"))).toHaveLength(0);
    await click(element('[aria-label="切换会话"]')); await click(element('[aria-label="当前书籍会话"] li button'));
    expect(element('[data-message-id="assistant-edition-old"]').textContent).toContain("旧回答");
  });
  it("旧版搜索慢回包不能污染切换后的新版搜索或选区", async () => {
    delayedSearch = Promise.withResolvers<Response>(); await mount(); await search(); await chooseEdition("edition-new");
    await act(async () => delayedSearch?.resolve(searchResponse("edition-old"))); await settle();
    expect(host.querySelector(".search-results button")).toBeNull();
    expect(element(".selection-actions").textContent).toContain("选择一句或一段");
    expect(element(".reader-sheet").textContent).toContain(texts["edition-new"]);
  });
});

describe("修改预算后原位重试页面接线", () => {
  it("读取新预算但原问题、选文、消息ID、首次设置和历史全部保持不变", async () => {
    failFirst = true; await mount(); await selectSource("edition-old"); await click(button("句读一下"));
    expect(requests).toHaveLength(1);
    const first = structuredClone(requests[0]);
    expect(first.contextSettings).toMatchObject({ maxInputTokens: 200000, maxOutputTokens: 4096 });
    const userIds = [...host.querySelectorAll(".chat-message.user")].map(item => item.getAttribute("data-message-id"));
    // WHY：重试前故意换选区并调大预算，验证只改执行预算，不从当前UI重建请求。
    await selectSource("edition-old", 1, 11);
    localStorage.setItem("judu:maxInputTokens", "400000"); localStorage.setItem("judu:maxOutputTokens", "8192");
    await click(button("重新句读"));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual({ ...first, retryContextSettings: { maxInputTokens: 400000, maxOutputTokens: 8192 } });
    expect([...host.querySelectorAll(".chat-message.user")].map(item => item.getAttribute("data-message-id"))).toEqual(userIds);
    expect(host.querySelectorAll('[data-message-id="' + first.clientAssistantMessageId + '"]')).toHaveLength(1);
    expect(element('[data-message-id="' + first.clientAssistantMessageId + '"]').textContent).toContain("正常回答");
  });
  it("非法预算保留失败消息并显示设置错误，不额外发请求或插用户消息", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    failFirst = true; await mount(); await selectSource("edition-old"); await click(button("句读一下"));
    localStorage.setItem("judu:maxInputTokens", "not-a-number"); await click(button("重新句读"));
    expect(requests).toHaveLength(1); expect(host.querySelectorAll(".chat-message.user")).toHaveLength(2);
    expect(element('[role="alert"]').textContent).toContain("预算"); expect(log).toHaveBeenCalled();
  });
});
