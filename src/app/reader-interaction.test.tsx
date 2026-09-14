// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaginatedParagraph } from "@/lib/pagination";
import { isRecord, type Analysis } from "@/lib/chat-stream";
import type { StoredChatMessage } from "@/lib/chat-history";
import type { BookKnowledge, KnowledgeDefinition } from "@/lib/knowledge";
import type { ReadingRequestPayload } from "@/lib/reading-request";

const navigation = vi.hoisted(() => ({ setAnchor: vi.fn(), setPageIndex: vi.fn() }));
// WHY：jsdom 没有排版引擎，只替换分页几何；真实页面、知识面板、消息状态机与概念组件全部参与交互。
vi.mock("@/hooks/use-reader-pages", () => ({
  useReaderPages: (source: readonly PaginatedParagraph[]) => {
    const page = { pageNumber: 1, chapterId: source[0]?.chapterId ?? "", chapterTitle: source[0]?.chapterTitle ?? "",
      paragraphs: [...source], isChapterStart: true };
    return { pages: [page], pageIndex: 0, currentPage: page, ...navigation, busy: false, error: "", renderedScale: 1 };
  },
}));
import Home from "./page";

type BookId = "A" | "B";
const bodyText = "自我意识通过承认认识自己。承认并不是单方决定。";
const book = (id: BookId) => ({ id, editionId: "edition-" + id, title: "测试书" + id, author: "测试作者",
  chapters: [{ id: "chapter-" + id, title: "章节" + id,
    paragraphs: [{ id: "paragraph-" + id, text: id === "A" ? bodyText : "乙书只讨论劳动与交换。" }] }] });
const anchor = { editionId: "edition-A", chapterId: "chapter-A", paragraphId: "paragraph-A",
  startOffset: 0, endOffset: 4, selectedText: "自我意识" };
const originalAnalysis: Analysis = { summary: "A书既存回复", breakdown: [], concepts: [], context: "原有上下文", uncertainty: "" };
const originalInput = { mode: "analyze", question: "请句读这一段", selectedText: anchor.selectedText,
  editionId: "edition-A", bookId: "A", chapterId: anchor.chapterId, paragraphId: anchor.paragraphId,
  selectionStart: anchor.startOffset, selectionEnd: anchor.endOffset };
const savedMessages: StoredChatMessage[] = [
  { id: "user-A", role: "user", content: "请句读这一段", status: "completed" },
  { id: "assistant-A", role: "assistant", content: JSON.stringify(originalAnalysis), status: "completed",
    structuredOutput: JSON.stringify({ ...originalAnalysis, anchor, _request: { version: 1,
      clientUserMessageId: "user-A", clientAssistantMessageId: "assistant-A", input: originalInput } }) },
];

function knowledge(definition?: KnowledgeDefinition): BookKnowledge {
  const recordId = "message:assistant-A";
  return { editionId: "edition-A", records: [{ id: recordId, editionId: "edition-A", annotationId: null,
    messageId: "assistant-A", threadId: "thread-A", createdAt: "2026-01-01T12:00:00Z",
    summary: originalAnalysis.summary, excerpt: anchor.selectedText, chapterTitle: "章节A", anchor,
    locationReason: null, concepts: definition ? [definition] : [] }],
  concepts: definition ? [{ id: "concept:" + definition.name, name: definition.name, updatedAt: "2026-01-01T12:00:00Z",
    recordIds: [recordId], definitions: definition.text ? [{ text: definition.text, recordIds: [recordId] }] : [] }] : [] };
}

type PendingStream = { payload: ReadingRequestPayload; controller: ReadableStreamDefaultController<Uint8Array>; closed: boolean };
let host: HTMLDivElement;
let root: Root;
let bookKnowledge: BookKnowledge;
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
let pendingStreams: PendingStream[];
let delayedBook: Promise<Response> | null;
const fetcher = vi.fn<typeof fetch>();

function endpoint(input: Parameters<typeof fetch>[0]): URL {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
}
function callCount(path: string, editionId?: string): number {
  return fetcher.mock.calls.filter(([input]) => {
    const url = endpoint(input);
    return url.pathname === path && (!editionId || url.searchParams.get("editionId") === editionId);
  }).length;
}
function event(stream: PendingStream, name: string, data: unknown) {
  stream.controller.enqueue(new TextEncoder().encode("event: " + name + "\ndata: " + JSON.stringify(data) + "\n\n"));
}
function openStream(body: unknown): Response {
  if (typeof body !== "string") throw new Error("阅读请求必须是 JSON 字符串");
  const value: unknown = JSON.parse(body);
  if (!isRecord(value) || typeof value.threadId !== "string" || typeof value.clientUserMessageId !== "string"
    || typeof value.clientAssistantMessageId !== "string" || typeof value.question !== "string"
    || typeof value.selectedText !== "string" || (value.mode !== "chat" && value.mode !== "analyze")) {
    throw new Error("页面未发送完整的阅读请求身份");
  }
  // WHY：此测试捕获真实页面生成的请求；仅模拟 HTTP/SSE，不访问用户数据库、模型或任何监听端口。
  const payload = value as ReadingRequestPayload;
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    const stream = { payload, controller, closed: false }; pendingStreams.push(stream);
    event(stream, "meta", { threadId: payload.threadId, messageId: payload.clientAssistantMessageId });
  } }), { headers: { "Content-Type": "text/event-stream" } });
}
async function complete(stream: PendingStream) {
  const analysis: Analysis = { summary: "仅属于A的新回复", breakdown: [],
    concepts: [{ name: "承认", text: "只属于A的定义" }], context: "", uncertainty: "" };
  await act(async () => {
    event(stream, "raw_delta", { text: JSON.stringify(analysis) });
    event(stream, "structured", { result: analysis, messageId: stream.payload.clientAssistantMessageId });
    event(stream, "done", { content: JSON.stringify(analysis) });
    stream.closed = true; stream.controller.close();
  });
  await settle();
}
async function settle() {
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
  for (let round = 0; frames.size && round < 4; round += 1) {
    await act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(performance.now())); });
  }
  expect(frames.size).toBe(0);
}
function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const result = host.querySelector<T>(selector);
  if (!result) throw new Error("缺少界面元素：" + selector);
  return result;
}
function button(label: string, within: ParentNode = host): HTMLButtonElement {
  const result = [...within.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === label);
  if (!result) throw new Error("缺少按钮：" + label);
  return result;
}
async function click(target: HTMLElement) { await act(async () => target.click()); await settle(); }
async function mount() { await act(async () => root.render(<Home />)); await settle(); }
async function loadA() { await mount(); await click(element<HTMLButtonElement>(".shelf-book")); }
async function selectOriginal() {
  await act(async () => {
    const paragraph = element('[data-paragraph-id="paragraph-A"]');
    const range = document.createRange(); range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    if (!selection) throw new Error("测试环境没有 DOM Selection");
    selection.removeAllRanges(); selection.addRange(range);
    paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await settle();
}
async function openKnowledge() {
  await click(button("本书知识卡片"));
  expect(element('aside[aria-label="本书知识卡片"]').getAttribute("aria-busy")).toBe("false");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", undefined);
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  frames = new Map(); frameId = 0; pendingStreams = []; delayedBook = null; bookKnowledge = knowledge();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  localStorage.clear(); localStorage.setItem("judu:thread:A", "thread-A");
  fetcher.mockImplementation(async (input, init) => {
    const url = endpoint(input);
    if (url.pathname === "/api/library") return Response.json([book("A"), book("B")]);
    if (url.pathname === "/api/books/A") return Response.json(book("A"));
    if (url.pathname === "/api/books/B") return delayedBook ?? Response.json(book("B"));
    if (url.pathname === "/api/threads/thread-A") return Response.json({ thread: { editionId: "edition-A" }, messages: savedMessages });
    if (url.pathname === "/api/annotations") return Response.json(init?.method === "POST" ? { saved: true } : { annotations: [] });
    if (url.pathname === "/api/knowledge") {
      const editionId = url.searchParams.get("editionId");
      return Response.json(editionId === "edition-A" ? bookKnowledge : { editionId, records: [], concepts: [] });
    }
    if (url.pathname === "/api/search/status") return Response.json({ backend: "sqlite", editionId: url.searchParams.get("editionId"),
      paragraphCount: 1, indexedCount: 0, vectorIndexed: false, note: "测试仅模拟关键词状态" });
    if (url.pathname === "/api/analyze/stream" && init?.method === "POST") return openStream(init.body);
    throw new Error("出现未模拟的网络请求：" + url.pathname);
  });
  vi.stubGlobal("fetch", fetcher);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    for (const stream of pendingStreams.filter((item) => !item.closed)) {
      event(stream, "error", { message: "测试清理未结束的请求" }); stream.closed = true; stream.controller.close();
    }
  });
  await act(async () => root.unmount());
  host.remove(); window.getSelection()?.removeAllRanges(); localStorage.clear();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("阅读器主页面交互回归", () => {
  it("同书重选后重新加载历史，知识记录仍能打开同线程回复及每条 user 的原文", async () => {
    await loadA();
    expect(element('[data-message-id="assistant-A"]').textContent).toContain("A书既存回复");
    expect(callCount("/api/threads/thread-A")).toBe(1);
    await click(element<HTMLButtonElement>(".shelf-book"));
    expect(callCount("/api/threads/thread-A")).toBe(2);
    expect(element('[data-message-id="assistant-A"]').textContent).toContain("A书既存回复");
    await openKnowledge();
    const recordsTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) => item.textContent?.startsWith("句读记录"));
    if (!recordsTab) throw new Error("没有句读记录标签");
    await click(recordsTab);
    await click(button("打开对话", element('[data-record-id="message:assistant-A"]')));
    expect(callCount("/api/threads/thread-A")).toBe(3);
    expect(host.querySelectorAll(".chat-message")).toHaveLength(2);
    expect(element('[data-message-id="assistant-A"]').textContent).toContain("A书既存回复");
    expect(element('[data-message-id="user-A"] [data-testid="message-source"]').textContent).toContain("自我意识");
    await click(element('[data-message-id="user-A"] button[aria-label="定位本次选文"]'));
    expect(navigation.setAnchor).toHaveBeenLastCalledWith({ paragraphId: "paragraph-A", offset: 0 });
  });

  it("生成中最近阅读不能绕过切书保护，完成后切书不会把旧回复或概念带入 B", async () => {
    await loadA(); await selectOriginal();
    await click(button("句读一下"));
    expect(pendingStreams).toHaveLength(1);
    expect(pendingStreams[0].payload.selectedText).toBe(bodyText);
    const userId = pendingStreams[0].payload.clientUserMessageId;
    expect(element('[data-message-id="' + userId + '"] blockquote').textContent).toBe(bodyText);
    await click(button("测试书B", element(".recent-list")));
    expect(callCount("/api/books/B")).toBe(0);
    expect(element(".shelf-book.active").textContent).toContain("测试书A");
    expect(element(".upload-toast").textContent).toContain("等待当前回答完成");
    await complete(pendingStreams[0]);
    expect(element('.reading-content [data-concept-word="承认"]')).toBeTruthy();
    await click(button("测试书B", element(".recent-list")));
    expect(callCount("/api/books/B")).toBe(1);
    expect(element('[data-paragraph-id="paragraph-B"]').textContent).toContain("乙书");
    expect(host.querySelector(".chat-messages")?.textContent).not.toContain("仅属于A的新回复");
    expect(host.querySelector('.reading-content [data-concept-word="承认"]')).toBeNull();
  });

  it("手动刷新知识卡片同时更新正文词典，且不会触发无限请求", async () => {
    await loadA(); await openKnowledge();
    expect(host.querySelector('.reading-content [data-concept-word="承认"]')).toBeNull();
    bookKnowledge = knowledge({ name: "承认", text: "新补充的互相确认定义" });
    const before = callCount("/api/knowledge", "edition-A");
    await click(element('button[aria-label="刷新本书知识"]'));
    expect(callCount("/api/knowledge", "edition-A")).toBe(before + 2);
    expect(host.querySelectorAll('.reading-content [data-concept-word="承认"]')).toHaveLength(2);
    expect(element('aside[aria-label="本书知识卡片"]').textContent).toContain("新补充的互相确认定义");
    await settle(); await settle();
    expect(callCount("/api/knowledge", "edition-A")).toBe(before + 2);
  });

  it("旧概念无定义仍进入全书词典，未句读段落也能标记名称", async () => {
    bookKnowledge = knowledge({ name: "承认", text: "" });
    await loadA();
    expect(host.querySelectorAll('.reading-content [data-concept-word="承认"]')).toHaveLength(2);
    expect(host.querySelector(".judu-history-marker")).toBeNull();
    await click(element(".concept-toggle"));
    expect(host.querySelector('.reading-content [data-concept-word="承认"]')).toBeNull();
    await click(element(".concept-toggle"));
    expect(host.querySelectorAll('.reading-content [data-concept-word="承认"]')).toHaveLength(2);
  });

  it("过时的切书结果不覆盖最后选择，书籍加载期间禁止发起句读", async () => {
    await loadA(); await selectOriginal();
    let resolveBook: ((response: Response) => void) | undefined;
    delayedBook = new Promise<Response>((resolve) => { resolveBook = resolve; });
    await click(button("测试书B", element(".recent-list")));
    expect(element(".reading-pane").getAttribute("aria-busy")).toBe("true");
    await click(button("句读一下"));
    expect(pendingStreams).toHaveLength(0);
    await click(button("测试书A", element(".recent-list")));
    expect(element(".reading-pane").getAttribute("aria-busy")).toBe("false");
    await act(async () => { resolveBook?.(Response.json(book("B"))); });
    await settle();
    expect(element(".shelf-book.active").textContent).toContain("测试书A");
    expect(host.querySelector('[data-paragraph-id="paragraph-B"]')).toBeNull();
    expect(element('[data-message-id="assistant-A"]').textContent).toContain("A书既存回复");
  });
});
