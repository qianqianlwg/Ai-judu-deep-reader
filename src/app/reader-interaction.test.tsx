// @vitest-environment jsdom
import { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaginatedParagraph } from "@/lib/pagination";
import { isRecord, type Analysis } from "@/lib/chat-stream";
import type { StoredChatMessage } from "@/lib/chat-history";
import type { BookKnowledge, KnowledgeDefinition } from "@/lib/knowledge";
import type { ReadingRequestPayload } from "@/lib/reading-request";
import type { ConversationSummary } from "@/lib/conversations";

const navigation = vi.hoisted(() => ({ setAnchor: vi.fn(), setPageIndex: vi.fn() }));
// WHY：jsdom 没有排版引擎，只替换分页几何；真实页面、知识面板、消息状态机与概念组件全部参与交互。
vi.mock("@/hooks/use-reader-pages", () => ({
  useReaderPages: (source: readonly PaginatedParagraph[]) => {
    const [anchor, setAnchor] = useState<{ paragraphId: string; offset: number } | null>(null);
    const updateAnchor = useCallback((next: { paragraphId: string; offset: number } | null) => { navigation.setAnchor(next); setAnchor(next); }, []);
    const page = { pageNumber: 1, chapterId: source[0]?.chapterId ?? "", chapterTitle: source[0]?.chapterTitle ?? "",
      paragraphs: [...source], isChapterStart: true };
    return { pages: [page], pageIndex: 0, currentPage: page, ...navigation, anchor, setAnchor: updateAnchor, busy: false, error: "", renderedScale: 1 };
  },
}));
import Home from "./page";

type BookId = "A" | "B" | "C";
const conversation = (id: string, editionId = "edition-A", title = "旧会话"): ConversationSummary => ({ id, editionId, bookId: editionId.slice(-1), title, createdAt: "2026-01-01T12:00:00Z", updatedAt: "2026-01-01T12:00:00Z", messageCount: id === "thread-A" ? 2 : 0 });
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
let conversationList: ConversationSummary[];
let delayedHistory: Promise<Response> | null;
let importedFile: FormDataEntryValue | null;
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
  let captured: PendingStream | undefined;
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    const stream = { payload, controller, closed: false }; captured = stream; pendingStreams.push(stream);
    event(stream, "meta", { threadId: payload.threadId, messageId: payload.clientAssistantMessageId });
  }, cancel() { if (captured) captured.closed = true; } }), { headers: { "Content-Type": "text/event-stream" } });
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
async function openShelfBook(id: BookId) { await click(button("书架")); await click(element<HTMLButtonElement>('button[aria-label="阅读《测试书' + id + '》"]')); }
async function loadA() { await mount(); await openShelfBook("A"); }
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
  await click(button("知识库"));
  expect(element('aside[aria-label="本书知识卡片"]').getAttribute("aria-busy")).toBe("false");
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {configurable: true, value: function(this: HTMLDialogElement) {this.open = true;}});
  Object.defineProperty(HTMLDialogElement.prototype, "close", {configurable: true, value: function(this: HTMLDialogElement) {this.open = false;}});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", undefined);
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  frames = new Map(); frameId = 0; pendingStreams = []; delayedBook = null; bookKnowledge = knowledge(); conversationList = [conversation("thread-A")]; delayedHistory = null; importedFile = null;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  localStorage.clear(); localStorage.setItem("judu:thread:A", "thread-A");
  fetcher.mockImplementation(async (input, init) => {
    const url = endpoint(input);
    if (url.pathname === "/api/settings/ai") return Response.json({ model: "workspace-test-model", hasApiKey: true });
    if (url.pathname === "/api/library") return Response.json([book("A"), book("B")]);
    if (url.pathname === "/api/books/A") return Response.json(book("A"));
    if (url.pathname === "/api/books/B") return delayedBook ?? Response.json(book("B"));
    if (url.pathname === "/api/books/C") return Response.json(book("C"));
    if (url.pathname === "/api/import") { importedFile = init?.body instanceof FormData ? init.body.get("file") : null; return Response.json(book("C")); }
    if (url.pathname === "/api/threads" && init?.method === "POST") { const created = conversation("thread-new", "edition-A", "新会话"); conversationList = [created, ...conversationList]; return Response.json({ thread: created }); }
    if (url.pathname === "/api/threads") return Response.json({ threads: conversationList.filter(item => item.editionId === url.searchParams.get("editionId")) });
    if (url.pathname.startsWith("/api/threads/")) {
      const id = url.pathname.split("/").at(-1)!; const thread = conversationList.find(item => item.id === id);
      if (!thread || thread.editionId !== url.searchParams.get("editionId") && init?.method !== "PATCH") return Response.json({ error: "本版没有此会话" }, { status: 404 });
      if (init?.method === "PATCH") { const body: unknown = JSON.parse(String(init.body)); if (!isRecord(body) || typeof body.title !== "string") throw new Error("重命名请求不合法"); thread.title = body.title; return Response.json({ thread }); }
      if (id === "thread-A" && delayedHistory) return delayedHistory;
      return Response.json({ threadId: id, thread, messages: id === "thread-A" ? savedMessages : [] });
    }
    if (url.pathname === "/api/annotations") return Response.json(init?.method === "POST" ? { saved: true } : { annotations: [] });
    if (url.pathname === "/api/reading-marks") return Response.json({ marks: [] });
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
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal"); Reflect.deleteProperty(HTMLDialogElement.prototype, "close"); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("阅读器主页面交互回归", () => {
  it("同书继续阅读保留历史，知识记录仍能打开同线程回复及每条 user 的原文", async () => {
    await loadA();
    expect(element('[data-message-id="assistant-A"]').textContent).toContain("A书既存回复");
    expect(callCount("/api/threads/thread-A")).toBe(1);
    await openShelfBook("A");
    expect(callCount("/api/threads/thread-A")).toBe(1);
    expect(element('[data-message-id="assistant-A"]').textContent).toContain("A书既存回复");
    await openKnowledge();
    const recordsTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) => item.textContent?.startsWith("句读记录"));
    if (!recordsTab) throw new Error("没有句读记录标签");
    await click(recordsTab);
    await click(button("打开对话", element('[data-record-id="message:assistant-A"]')));
    expect(callCount("/api/threads/thread-A")).toBe(2);
    expect(host.querySelectorAll(".chat-message")).toHaveLength(2);
    expect(element(".workspace-main").dataset.workspaceView).toBe("knowledge");
    expect(element('[data-message-id="assistant-A"]').textContent).toContain("A书既存回复");
    expect(element('[data-message-id="user-A"] [data-testid="message-source"]').textContent).toContain("自我意识");
    await click(element('[data-message-id="user-A"] button[aria-label="定位本次选文"]'));
    expect(navigation.setAnchor).toHaveBeenLastCalledWith({ paragraphId: "paragraph-A", offset: 0 });
    expect(element(".workspace-main").dataset.workspaceView).toBe("reader");
  });

  it("生成中书架入口不能绕过切书保护，完成后切书不会把旧回复或概念带入 B", async () => {
    await loadA(); await selectOriginal();
    await click(button("句读一下"));
    expect(pendingStreams).toHaveLength(1);
    expect(pendingStreams[0].payload.selectedText).toBe(bodyText);
    const userId = pendingStreams[0].payload.clientUserMessageId;
    expect(element('[data-message-id="' + userId + '"] blockquote').textContent).toBe(bodyText);
    await openShelfBook("B");
    expect(callCount("/api/books/B")).toBe(0);
    expect(localStorage.getItem("judu:active-book")).toBe("A"); expect(element(".chapter-context").textContent).toContain("章节A");
    await click(button("书架")); expect(element<HTMLButtonElement>('button[aria-label="阅读《测试书B》"]').disabled).toBe(true);
    expect(element(".workspace-nav-hint").textContent).toContain("完成后可切换");
    await complete(pendingStreams[0]);
    expect(element('.reading-content [data-concept-word="承认"]')).toBeTruthy();
    await openShelfBook("B");
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
    await openShelfBook("B");
    expect(element(".reading-pane").getAttribute("aria-busy")).toBe("true");
    await click(button("句读一下"));
    expect(pendingStreams).toHaveLength(0);
    await openShelfBook("A");
    expect(element(".reading-pane").getAttribute("aria-busy")).toBe("false");
    await act(async () => { resolveBook?.(Response.json(book("B"))); });
    await settle();
    expect(localStorage.getItem("judu:active-book")).toBe("A"); expect(element(".chapter-context").textContent).toContain("章节A");
    expect(host.querySelector('[data-paragraph-id="paragraph-B"]')).toBeNull();
    expect(element('[data-message-id="assistant-A"]').textContent).toContain("A书既存回复");
  });
});


describe("第四阶段工作台页面集成", () => {
  it("导航切主区不清消息或重新挂载右侧聊天，阅读 DOM 尺寸容器保留", async () => {
    await loadA(); const chat = element(".chat-messages"); const reading = element(".reading-content");
    await click(button("书架"));
    expect(element(".workspace-main").dataset.workspaceView).toBe("bookshelf");
    expect(element('[aria-label="我的书架"]')).toBeTruthy(); expect(element(".chat-messages")).toBe(chat);
    expect(element(".reading-content")).toBe(reading); expect(element(".reading-pane").getAttribute("aria-hidden")).toBe("true");
    expect(element(".reading-pane").hasAttribute("inert")).toBe(true);
    await openKnowledge();
    expect(element(".workspace-main").contains(element('[aria-label="本书知识卡片"]'))).toBe(true);
    expect(element(".chat-messages")).toBe(chat); expect(chat.textContent).toContain("A书既存回复");
    expect(host.querySelectorAll(".reader-layout > .analysis-panel")).toHaveLength(1);
    await click(button("返回阅读")); expect(element(".reading-pane").getAttribute("aria-hidden")).toBe("false");
    expect(element(".chat-messages")).toBe(chat); expect(element(".reading-content")).toBe(reading);
  });

  it("顶部没有导入搜索设置，左侧书架可进入并打开书卡", async () => {
    await loadA();
    expect(host.querySelector('.workspace-mobilebar a[href="/settings"], .workspace-mobilebar input, .top-actions')).toBeNull();
    expect(host.querySelectorAll('.workspace-nav-footer a[href="/settings"]')).toHaveLength(1);
    expect(element('.workspace-nav-footer a[href="/settings"]').closest(".workspace-nav-footer")).not.toBeNull();
    await click(button("书架"));
    await click(element('button[aria-label="阅读《测试书B》"]'));
    expect(element(".workspace-main").dataset.workspaceView).toBe("reader");
    expect(element('[data-paragraph-id="paragraph-B"]').textContent).toContain("乙书");
  });
});


describe("书架导入操作", () => {
  it("左侧导入按钮使用真实文件输入，导入完成进入新书正文", async () => {
    await loadA(); const input = element<HTMLInputElement>("#book-file"); const picker = vi.spyOn(input, "click");
    await click(button("导入书籍")); expect(picker).toHaveBeenCalledOnce(); expect(element(".workspace-main").dataset.workspaceView).toBe("bookshelf");
    const file = new File(["测试正文"], "测试书.epub", { type: "application/epub+zip" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true }))); await settle();
    expect(importedFile).toBeInstanceOf(File); expect((importedFile as File).name).toBe("测试书.epub");
    expect(callCount("/api/import")).toBe(1); expect(callCount("/api/books/C")).toBe(0); expect(element(".workspace-main").dataset.workspaceView).toBe("reader");
    expect(localStorage.getItem("judu:active-book")).toBe("C"); expect(element(".chapter-context").textContent).toContain("章节C");
  });
});


describe("工作区切换的浮层边界", () => {
  it("进入书架会卸载原文词义浮层，但保留阅读测量容器", async () => {
    bookKnowledge = knowledge({ name: "承认", text: "这是一条定义" });
    await loadA(); const reading = element(".reading-content");
    await click(element('[data-concept-word="承认"]'));
    expect(document.querySelector('[data-concept-definition="承认"]')?.textContent).toContain("这是一条定义");
    await click(button("书架")); expect(document.querySelector(".judu-annotation-popover")).toBeNull();
    expect(element(".reading-content")).toBe(reading);
    await click(button("阅读")); expect(element(".reading-content")).toBe(reading);
    expect(document.querySelector(".judu-annotation-popover")).toBeNull();
  });
});


describe("多会话页面隔离", () => {
  it("新建会话不带旧历史和旧选文，旧会话仍可重新打开", async () => {
    await loadA(); await selectOriginal();
    expect(element('[data-message-id="assistant-A"]').textContent).toContain("A书既存回复");
    await click(element('[aria-label="新建会话"]'));
    expect(host.querySelectorAll(".chat-message")).toHaveLength(0); expect(host.querySelector(".book-context")).toBeNull();
    expect(localStorage.getItem("judu:thread:A:edition-A")).toBe("thread-new");
    expect(element<HTMLTextAreaElement>('textarea[aria-label="继续追问"]').value).toBe("");
    await click(element('[aria-label="切换会话"]'));
    const previous = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="当前书籍会话"] li button')].find(item => item.textContent?.includes("旧会话"));
    if (!previous) throw new Error("新建会话后丢失旧会话入口");
    await click(previous); expect(element('[data-message-id="assistant-A"]').textContent).toContain("A书既存回复");
    expect(callCount("/api/threads/thread-A", "edition-A")).toBe(2);
  });

  it("新会话问题提交的thread和history不混入旧消息", async () => {
    await loadA(); await click(element('[aria-label="新建会话"]'));
    const input = element<HTMLTextAreaElement>('textarea[aria-label="继续追问"]');
    await act(async () => { input.value = "新对话只讨论本书术语"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(element('[aria-label="发送追问"]'));
    expect(pendingStreams).toHaveLength(1); expect(pendingStreams[0].payload.threadId).toBe("thread-new");
    expect(pendingStreams[0].payload.chatHistory).toEqual([]); expect(pendingStreams[0].payload.selectedText).toBe("");
    expect(host.querySelector('[data-message-id="assistant-A"]')).toBeNull();
    expect(element<HTMLButtonElement>('[aria-label="新建会话"]').disabled).toBe(true);
    expect(element<HTMLButtonElement>('[aria-label="切换会话"]').disabled).toBe(true);
    const count = fetcher.mock.calls.filter(([, init]) => init?.method === "POST").length;
    await click(element('[aria-label="新建会话"]'));
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST").length).toBe(count);
    await complete(pendingStreams[0]);
  });

  it("历史未加载完成时先清旧消息并禁止发送、切书", async () => {
    await loadA(); await click(element('[aria-label="新建会话"]'));
    let resolve: ((response: Response) => void) | undefined;
    delayedHistory = new Promise<Response>(done => { resolve = done; });
    await click(element('[aria-label="切换会话"]'));
    const prior = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="当前书籍会话"] li button')].find(item => item.textContent?.includes("旧会话"))!;
    await click(prior);
    expect(host.querySelectorAll(".chat-message")).toHaveLength(0);
    expect(element<HTMLTextAreaElement>('textarea[aria-label="继续追问"]').disabled).toBe(true);
    await click(button("书架")); expect(element<HTMLButtonElement>('button[aria-label="阅读《测试书B》"]').disabled).toBe(true);
    await act(async () => resolve?.(Response.json({ threadId: "thread-A", thread: conversation("thread-A"), messages: savedMessages })));
    await settle(); expect(element('[data-message-id="assistant-A"]').textContent).toContain("A书既存回复");
    expect(element<HTMLTextAreaElement>('textarea[aria-label="继续追问"]').disabled).toBe(false);
  });

  it("用量事件只更新本轮状态，切会话清掉旧用量", async () => {
    await loadA(); await selectOriginal(); await click(button("句读一下"));
    await act(async () => event(pendingStreams[0], "usage", { usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150, cachedInputTokens: 20, contextTokens: 150, contextWindow: 32768, source: "provider" } }));
    await settle(); expect(element('[data-testid="usage-footer"]').textContent).toContain("服务端统计");
    expect(element('[data-testid="usage-footer"]').textContent).toContain("150");
    await complete(pendingStreams[0]); await click(element('[aria-label="新建会话"]'));
    expect(element('[data-testid="usage-footer"]').textContent).toContain("用量待返回");
  });
});


describe("工作台切换后请求身份回归", () => {
  it("失败后重试复用原用户/助手身份与原文，不因为切视图重复发问", async () => {
    await loadA(); await selectOriginal(); await click(button("句读一下"));
    const first = pendingStreams[0];
    await act(async () => { event(first, "raw_delta", { text: "尚未完成" }); event(first, "error", { message: "测试失败，请重试" }); first.closed = true; first.controller.close(); });
    await settle(); expect(element('[role="alert"]').textContent).toContain("测试失败");
    await click(button("书架")); await click(button("阅读"));
    await act(async () => {
      const text = element('[data-paragraph-id="paragraph-A"] [data-reader-text]').firstChild;
      if (!text) throw new Error("没有可选择的原文节点");
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 10);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      element('[data-paragraph-id="paragraph-A"]').dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }); await settle();
    await click(button("重新句读")); expect(pendingStreams).toHaveLength(2);
    const retry = pendingStreams[1];
    expect(retry.payload.clientUserMessageId).toBe(first.payload.clientUserMessageId);
    expect(retry.payload.clientAssistantMessageId).toBe(first.payload.clientAssistantMessageId);
    expect(retry.payload.selectedText).toBe(bodyText);
    expect(host.querySelectorAll('[data-message-id="' + first.payload.clientUserMessageId + '"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-message-id="' + first.payload.clientAssistantMessageId + '"]')).toHaveLength(1);
    await complete(retry);
  });

  it("工具结构化结果只补充卡片，不替换普通流式回答", async () => {
    await loadA(); await selectOriginal(); await click(button("句读一下")); const stream = pendingStreams[0];
    const toolAnalysis: Analysis = { summary: "结构化解释", breakdown: [], concepts: [{ name: "承认", text: "相互确认" }], context: "", uncertainty: "" };
    await act(async () => {
      event(stream, "raw_delta", { text: "## 先看原文\n\n这是正常文本回答。" });
      event(stream, "structured", { result: toolAnalysis, messageId: stream.payload.clientAssistantMessageId });
      event(stream, "tool", { tool: { id: "tool-1", name: "lookup_passage", status: "completed", result: { matches: 1 } } });
      event(stream, "usage", { usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30, contextTokens: 30, contextWindow: 8192, source: "provider" } });
      event(stream, "warning", { message: "这是一条可恢复提示" });
    }); await settle();
    const assistant = element('[data-message-id="' + stream.payload.clientAssistantMessageId + '"]');
    expect(assistant.querySelector('[data-streaming-format="markdown"]')?.textContent).toContain("这是正常文本回答。");
    expect(assistant.querySelector('[data-streaming-format="markdown"]')?.textContent).not.toContain("结构化解释");
    expect(assistant.querySelector("details")).not.toBeNull(); expect(element(".upload-toast").textContent).toContain("可恢复提示");
    await act(async () => { event(stream, "done", { content: "## 先看原文\n\n这是正常文本回答。" }); stream.closed = true; stream.controller.close(); });
    await settle();
    expect(element('[data-message-id="' + stream.payload.clientAssistantMessageId + '"] [data-streaming-format="markdown"]').textContent).toContain("这是正常文本回答。");
  });
});


describe("刷新恢复与跨会话知识定位", () => {
  it("启动恢复上次书籍和版本内锚点，不加载demo或错书", async () => {
    localStorage.setItem("judu:active-book", "B");
    localStorage.setItem("judu:position:B:edition-B", JSON.stringify({ paragraphId: "paragraph-B", offset: 3 }));
    await mount();
    expect(localStorage.getItem("judu:active-book")).toBe("B"); expect(element(".chapter-context").textContent).toContain("章节B");
    expect(callCount("/api/books/A")).toBe(0); expect(callCount("/api/books/B")).toBe(1);
    expect(navigation.setAnchor).toHaveBeenCalledWith({ paragraphId: "paragraph-B", offset: 3 });
    expect(host.textContent).not.toContain("亚当·斯密");
  });
  it("重挂载恢复书籍、新会话、知识视图和保存位置，知识记录可定位旧会话消息", async () => {
    await loadA(); await selectOriginal(); await click(element('[aria-label="新建会话"]')); await openKnowledge();
    expect(localStorage.getItem("judu:active-book")).toBe("A");
    expect(localStorage.getItem("judu:position:A:edition-A")).toBe(JSON.stringify({ paragraphId: "paragraph-A", offset: 0 }));
    expect(localStorage.getItem("judu:workspace-view")).toBe("knowledge");
    await act(async () => root.unmount()); root = createRoot(host); await mount();
    expect(element(".workspace-main").dataset.workspaceView).toBe("knowledge");
    expect(element('[aria-label="切换会话"]').textContent).toContain("新会话"); expect(host.querySelectorAll(".chat-message")).toHaveLength(0);
    const tab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(item => item.textContent?.startsWith("句读记录"))!;
    await click(tab); await click(button("打开对话", element('[data-record-id="message:assistant-A"]')));
    const target = element('[data-message-id="assistant-A"]'); expect(target.dataset.historyTarget).toBe("true");
    expect(document.activeElement).toBe(target); expect(localStorage.getItem("judu:thread:A:edition-A")).toBe("thread-A");
    expect(element(".workspace-main").dataset.workspaceView).toBe("knowledge");
    await click(button("打开原文", element('[data-record-id="message:assistant-A"]')));
    expect(element(".workspace-main").dataset.workspaceView).toBe("reader");
    expect(navigation.setAnchor).toHaveBeenLastCalledWith({ paragraphId: "paragraph-A", offset: 0 });
  });
});


describe("可访问选文与输出设置", () => {
  it("程序/键盘选区显示操作栏，折叠后仍发出选文并使用保存的输出上限", async () => {
    localStorage.setItem("judu:maxOutputTokens", "8192"); await loadA();
    await act(async () => {
      const node = element('[data-paragraph-id="paragraph-A"] [data-reader-text]').firstChild!;
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 10);
      const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    }); await settle();
    expect(element(".selection-actions").textContent).toContain("已选 10 / 1000 字");
    await act(async () => { document.getSelection()?.removeAllRanges(); document.dispatchEvent(new Event("selectionchange")); }); await settle();
    await click(button("句读一下"));
    expect(pendingStreams[0].payload.selectedText).toBe(bodyText.slice(0, 10));
    expect(pendingStreams[0].payload.contextSettings?.maxOutputTokens).toBe(8192);
    await complete(pendingStreams[0]);
  });
});


describe("停止生成装配", () => {
  it("停止取消实际请求并保留原消息身份供重试", async () => {
    await loadA(); await selectOriginal(); await click(button("句读一下")); const first = pendingStreams[0];
    await act(async () => event(first, "raw_delta", { text: "已经收到的内容" })); await settle();
    await click(element('[aria-label="停止生成"]')); expect(first.closed).toBe(true);
    expect(element('[data-message-id="' + first.payload.clientAssistantMessageId + '"]').textContent).toContain("已经收到的内容");
    await click(button("重新句读")); expect(pendingStreams[1].payload.clientAssistantMessageId).toBe(first.payload.clientAssistantMessageId);
    expect(pendingStreams[1].payload.clientUserMessageId).toBe(first.payload.clientUserMessageId); await complete(pendingStreams[1]);
  });
});

it("下架当前最后一本书后侧栏不复活，正文和对话保留，恢复可重新上架",async()=>{const original=fetcher.getMockImplementation()!;let archived=false;fetcher.mockImplementation(async(input,init)=>{const url=endpoint(input);if(url.pathname==='/api/library')return Response.json(url.searchParams.get('shelf')==='archived'?(archived?[book('A')]:[]):(archived?[]:[book('A')]));if(url.pathname==='/api/books/A/shelf'){archived=JSON.parse(String(init?.body)).archived;return Response.json({bookId:'A',archived});}return original(input,init);});await loadA();const chat=element('.chat-messages'),reading=element('.reading-content');await click(button('书架'));await click(element('[data-book-id="A"] .bookshelf-menu-content button:nth-child(3)'));await click(element('button[aria-label="下架《测试书A》"]'));expect(archived).toBe(false);await click(button('确认下架'));expect(archived).toBe(true);expect(host.querySelector('.shelf-book')).toBeNull();expect(host.querySelector('.bookshelf-card')).toBeNull();expect(element('.chat-messages')).toBe(chat);expect(element('.reading-content')).toBe(reading);expect(chat.textContent).toContain('A书既存回复');await act(async()=>{const detail=element<HTMLDetailsElement>('.archived-books');detail.open=true;detail.dispatchEvent(new Event('toggle'));});await settle();await click(button('恢复上架'));expect(archived).toBe(false);expect(host.querySelector('.shelf-book')).toBeNull();expect(element('.bookshelf-card').textContent).toContain('测试书A');await click(button('阅读'));expect(host.querySelector('.shelf-book')).toBeNull();expect(element('.chapter-context').textContent).toContain('章节A');expect(element('.chat-messages')).toBe(chat);});

it('主阅读器导入超300MB文件即时提示，不请求上传接口',async()=>{await loadA();const input=element<HTMLInputElement>('#book-file'),file=new File(['x'],'large.pdf');Object.defineProperty(file,'size',{value:300*1024*1024+1});Object.defineProperty(input,'files',{configurable:true,value:[file]});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));expect(callCount('/api/import')).toBe(0);expect(host.textContent).toContain('300 MB');expect(element('[data-paragraph-id="paragraph-A"]').textContent).toContain('自我意识');});

it("书架默认隐藏助手不卸载聊天，手动展开和返回阅读不清会话",async()=>{
 await loadA();const chat=element(".chat-messages");await click(button("书架"));expect(element(".reader-layout").getAttribute("data-bookshelf-assistant-hidden")).toBe("true");expect(element(".chat-messages")).toBe(chat);await click(button("展开助手"));expect(element(".reader-layout").getAttribute("data-bookshelf-assistant-hidden")).toBe("false");await click(button("收起助手"));await click(button("阅读"));expect(element(".reader-layout").getAttribute("data-bookshelf-assistant-hidden")).toBe("false");expect(element(".chat-messages")).toBe(chat);
});
