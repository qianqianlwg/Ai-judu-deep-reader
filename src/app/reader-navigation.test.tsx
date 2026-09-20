// @vitest-environment jsdom
import { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaginatedParagraph } from "@/lib/pagination";
import type { KnowledgeWorkspaceProps } from "@/components/knowledge-workspace";
import type { SearchSelectionTarget } from "@/components/workspace-reading-location";

const boundary = vi.hoisted(() => ({ invalidThread: "", setAnchor: vi.fn() }));
vi.mock("@/hooks/use-reader-pages", () => ({
  useReaderPages: (paragraphs: readonly PaginatedParagraph[]) => {
    const [anchor, update] = useState<{ paragraphId: string; offset: number } | null>(null);
    const setAnchor = useCallback((next: { paragraphId: string; offset: number } | null) => { boundary.setAnchor(next); update(next); }, []);
    const page = { pageNumber: 1, chapterId: "chapter-a", chapterTitle: "甲章", paragraphs: [...paragraphs], isChapterStart: true };
    return { pages: [page], currentPage: page, pageIndex: 0, anchor, setAnchor, setPageIndex: vi.fn(), busy: false, error: "", renderedScale: 1 };
  },
}));
// WHY：模拟旧卡片/扩展组件传回不可信ID，验证真正的page入口而非仅测试按钮自身的disabled。
vi.mock("@/components/knowledge-workspace", () => ({
  KnowledgeWorkspace: (props: KnowledgeWorkspaceProps) => <button type="button" onClick={() => props.onOpenConversation?.(boundary.invalidThread, "old-assistant")}>打开旧卡片来源</button>,
}));
import Home from "./page";

let host: HTMLDivElement; let root: Root;
let frames: Map<number, FrameRequestCallback>; let frameId: number;
let result: SearchSelectionTarget & { chapterId: string; chapterTitle: string };
let badCreate: boolean;
let requests: Record<string, unknown>[];
const sourceA = "甲段提供最初的认识。";
const searchTerm = String.fromCodePoint(0x627f, 0x8ba4);
const sourceB = 'prefix😀承认 used for argument and later text';
const book = { id: "book", editionId: "edition", title: "导航验收书", author: "测试作者", chapters: [
  { id: "chapter-a", title: "甲章", paragraphs: [{ id: "a", text: sourceA }] },
  { id: "chapter-b", title: "乙章", paragraphs: [{ id: "b", text: sourceB }] },
] };
const summary = (id: string) => ({ id, editionId: "edition", bookId: "book", title: "旧会话", createdAt: "2026-01-01", updatedAt: "2026-01-01", messageCount: id === "good" ? 2 : 0 });
const fetcher = vi.fn<typeof fetch>();
function endpoint(input: Parameters<typeof fetch>[0]) { return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://local"); }
function element<T extends HTMLElement = HTMLElement>(selector: string): T { const found = host.querySelector<T>(selector); if (!found) throw new Error("缺少节点：" + selector); return found; }
function button(text: string) { const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === text); if (!found) throw new Error("缺少按钮：" + text); return found; }
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  for (let count = 0; frames.size && count < 5; count += 1) await act(async () => { const queue = [...frames.values()]; frames.clear(); queue.forEach(callback => callback(performance.now())); });
  expect(frames.size).toBe(0);
}
async function click(node: HTMLElement) { await act(async () => node.click()); await settle(); }
async function mount() { await act(async () => root.render(<Home />)); await settle(); }
async function selectA() {
  await act(async () => {
    const node = element('[data-paragraph-id="a"] [data-reader-text]').firstChild!;
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 2);
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }); await settle();
  expect(element(".selection-actions").textContent).toContain("已选 2 / 1000 字");
}
async function searchB() {
  await click(element(".workspace-book-search summary"));
  const input = element<HTMLInputElement>("#workspace-book-query");
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "乙段"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => element(".workspace-book-search form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
  await click(element(".search-results button"));
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("ResizeObserver", undefined); vi.stubGlobal("CSS", { escape: (text: string) => text });
  frames = new Map(); frameId = 0; requests = []; boundary.invalidThread = ""; badCreate = false;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  localStorage.clear(); localStorage.setItem("judu:thread:book:edition", "good");
  result = { paragraphId: "b", chapterId: "chapter-b", chapterTitle: "chapter-b", matchedText: sourceB.slice(sourceB.indexOf(searchTerm), sourceB.indexOf(searchTerm) + 10), startOffset: sourceB.indexOf(searchTerm), excerpt: sourceB };
  fetcher.mockImplementation(async (input, init) => {
    const url = endpoint(input);
    if (url.pathname === "/api/settings/ai") return Response.json({ model: "test-model" });
    if (url.pathname === "/api/library") return Response.json([book]);
    if (url.pathname === "/api/books/book") return Response.json(book);
    if (url.pathname === "/api/annotations") return Response.json({ annotations: [] });
    if (url.pathname === "/api/reading-marks") return Response.json({ marks: [] });
    if (url.pathname === "/api/knowledge") return Response.json({ editionId: url.searchParams.get("editionId"), records: [], concepts: [] });
    if (url.pathname === "/api/search/status") return Response.json({ backend: "sqlite", editionId: "edition", paragraphCount: 2, indexedCount: 0, vectorIndexed: false, note: "测试" });
    if (url.pathname === "/api/search") return Response.json({ results: [result] });
    if (url.pathname === "/api/threads" && init?.method === "POST") return Response.json({ thread: summary(badCreate ? "" : "new") });
    if (url.pathname === "/api/threads") return Response.json({ threads: [summary("good")] });
    if (url.pathname === "/api/threads/good") return Response.json({ threadId: "good", thread: summary("good"), messages: [
      { id: "old-user", role: "user", content: "原问题", status: "completed" },
      { id: "old-assistant", role: "assistant", content: "原会话回答", status: "completed" },
    ] });
    if (url.pathname === "/api/threads/new") return Response.json({ threadId: "new", thread: summary("new"), messages: [] });
    if (url.pathname === "/api/analyze/stream") {
      const value: unknown = JSON.parse(String(init?.body)); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("无效阅读请求");
      const body = value as Record<string, unknown>; requests.push(body);
      const event = (name: string, data: unknown) => "event: " + name + "\ndata: " + JSON.stringify(data) + "\n\n";
      return new Response(event("meta", { threadId: body.threadId, messageId: body.clientAssistantMessageId }) + event("raw_delta", { text: "测试回答" }) + event("done", { content: "测试回答" }), { headers: { "Content-Type": "text/event-stream" } });
    }
    throw new Error("出现不应发出的请求：" + url.pathname);
  });
  vi.stubGlobal("fetch", fetcher); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.getSelection()?.removeAllRanges(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("页面锁定前ID校验", () => {
  it.each(["", "bad/id", "good\n"])("旧卡片传回非法ID %j 时不清历史、不锁输入或切书", async id => {
    boundary.invalidThread = id; await mount(); await click(button("知识库")); await click(button("打开旧卡片来源"));
    expect(element('[data-message-id="old-assistant"]').textContent).toContain("原会话回答");
    expect(element<HTMLTextAreaElement>('textarea[aria-label="继续追问"]').disabled).toBe(false);
    expect(element<HTMLButtonElement>(".shelf-book").disabled).toBe(false);
    expect(element('[role="status"]').textContent).toContain("会话定位无效");
    expect(fetcher.mock.calls.filter(([input]) => endpoint(input).pathname.startsWith("/api/threads/")).map(([input]) => endpoint(input).pathname)).toEqual(["/api/threads/good"]);
  });
  it("坏的缓存会话不会进入加载锁，仍可选择正确旧会话", async () => {
    localStorage.setItem("judu:thread:book:edition", "bad/id"); await mount();
    expect(element<HTMLButtonElement>('[aria-label="切换会话"]').disabled).toBe(false);
    await click(element('[aria-label="切换会话"]'));
    await click(element('[aria-label="当前书籍会话"] li button'));
    expect(element('[data-message-id="old-assistant"]').textContent).toContain("原会话回答");
  });
  it("创建接口错误返回空ID时保留原会话并解除操作锁", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    badCreate = true; await mount(); await click(element('[aria-label="新建会话"]'));
    expect(element('[data-message-id="old-assistant"]').textContent).toContain("原会话回答");
    expect(element<HTMLButtonElement>('[aria-label="新建会话"]').disabled).toBe(false);
    expect(element<HTMLTextAreaElement>('textarea[aria-label="继续追问"]').disabled).toBe(false); expect(log).toHaveBeenCalled();
  });
});

describe("A选区→搜索B→真实句读请求", () => {
  it("B文本、B段落、B章节和UTF16偏移在同一请求里一致", async () => {
    await mount(); await selectA(); await searchB(); await click(button("句读一下"));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ selectedText: sourceB.slice(sourceB.indexOf(searchTerm), sourceB.indexOf(searchTerm) + 10), paragraphId: "b", chapterId: "chapter-b", selectionStart: sourceB.indexOf(searchTerm), selectionEnd: sourceB.indexOf(searchTerm) + 10, context: sourceB, mode: "analyze" });
    expect(boundary.setAnchor).toHaveBeenLastCalledWith({ paragraphId: "b", offset: sourceB.indexOf(searchTerm) });
  });
  it("概括excerpt不精确时清除A旧选区且不提交请求", async () => {
    result = { paragraphId: "b", chapterId: "chapter-b", chapterTitle: "乙章", excerpt: "乙段…后文" };
    await mount(); await selectA(); await searchB();
    expect(element(".selection-actions").textContent).toContain("选择一句或一段原文");
    expect([...host.querySelectorAll("button")].some(item => item.textContent === "句读一下")).toBe(false);
    expect(element('[role="status"]').textContent).toContain("重新选择"); expect(requests).toHaveLength(0);
  });
  it("B偏移与命中不一致也不能继续沿用A锚点", async () => {
    result.startOffset = 0; await mount(); await selectA(); await searchB();
    expect(element(".selection-actions").textContent).not.toContain("已选"); expect(requests).toHaveLength(0);
  });
});

describe("多段选文真实页面装配",()=>{
 async function selectBetween(firstId:string,start:number,lastId:string,end:number,pointer=false){
  await act(async()=>{
   const first=element('[data-paragraph-id="'+firstId+'"] [data-reader-text]').firstChild!,last=element('[data-paragraph-id="'+lastId+'"] [data-reader-text]').firstChild!;
   if(pointer)first.parentElement!.dispatchEvent(new Event('pointerdown',{bubbles:true}));
   const range=document.createRange();range.setStart(first,start);range.setEnd(last,end);const selection=document.getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));
  });await settle();
 }
 it("跨段选文提交全部片段、完整预览和第一段导航位置",async()=>{
  await mount();await selectBetween('a',2,'b',12);const text=sourceA.slice(2)+'\n\n'+sourceB.slice(0,12);
  expect(element('.selection-preview blockquote').textContent).toBe(text);expect(element('.selection-preview summary').textContent).toContain('2 段');
  expect(document.getSelection()!.toString().replace(/\s/gu,'')).toBe(text.replace(/\s/gu,''));
  await click(button('句读一下'));expect(requests[0]).toMatchObject({selectedText:text,paragraphId:'a',selectionStart:2,selectionEnd:sourceA.length,selectionAnchors:[{paragraphId:'a',startOffset:2,endOffset:sourceA.length,selectedText:sourceA.slice(2)},{paragraphId:'b',startOffset:0,endOffset:12,selectedText:sourceB.slice(0,12)}]});
 });
 it("显式继续选取在拖动端点多次更新时始终保留前段，下一次新拖选清理扩展",async()=>{
  await mount();await selectBetween('a',2,'a',sourceA.length);await click(button('继续选取'));
  await selectBetween('b',0,'b',6,true);expect(element('.selection-preview blockquote').textContent).toBe(sourceA.slice(2)+'\n\n'+sourceB.slice(0,6));
  await selectBetween('b',0,'b',12);expect(element('.selection-preview blockquote').textContent).toBe(sourceA.slice(2)+'\n\n'+sourceB.slice(0,12));
  await selectBetween('b',12,'b',24,true);expect(element('.selection-preview blockquote').textContent).toBe(sourceB.slice(12,24));
 });
});
