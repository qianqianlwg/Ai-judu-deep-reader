// @vitest-environment jsdom
import { act, createElement, useCallback, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaginatedParagraph } from "./pagination";
import type { LibraryChapter } from "./library";
import { capReadingSelection, readReadingSelection, selectionFromParts, selectionAnchors, selectionMatchesParagraphs } from "./reader-selection";
import { mapEpubDocument, readLimitedEpubSelection, selectionFromEpubRange } from "./epub-source-map";
import { countReadingCharacters } from "./reading-detail";
import { anchorsMatchParagraphs, makeReadingAnchor, anchorParts } from "./reading-anchors";
import { createReadingRequest, restoreReadingRequest, applyReadingRequest, type ReadingRequestPayload } from "./reading-request";
import { hydrateChatHistory } from "./chat-history";
import { createAnnotation, type TextAnnotation } from "./annotations";
import { hashText } from "./hash";
import { buildBookKnowledge } from "./knowledge-records";

const navigation = vi.hoisted(() => ({ setAnchor: vi.fn() }));
// WHY：独立验收只模拟分页几何和 HTTP；页面选区、来源、请求装配仍使用当前产品代码。
vi.mock("@/hooks/use-reader-pages", () => ({
  useReaderPages: (paragraphs: readonly PaginatedParagraph[]) => {
    const [anchor, setAnchor] = useState<{ paragraphId: string; offset: number } | null>(null);
    const update = useCallback((next: { paragraphId: string; offset: number } | null) => { navigation.setAnchor(next); setAnchor(next); }, []);
    const page = { pageNumber: 1, chapterId: paragraphs[0]?.chapterId ?? "", chapterTitle: "验收章节", paragraphs: [...paragraphs], isChapterStart: true };
    return { pages: [page], currentPage: page, pageIndex: 0, setPageIndex: () => {}, anchor, setAnchor: update, busy: false, error: "", renderedScale: 1 };
  },
}));
import Home from "@/app/page";
import { useTextSourceHighlights } from "@/hooks/use-text-source-highlights";
import { AnnotatedParagraph } from "@/components/annotated-paragraph";

const texts = ["第一段正文用于验证多段来源及跨页连续选取。", "第二段正文需要和第一段一起保存并恢复来源。"];
const book = (id = "A") => ({ id, title: "验收书" + id, author: "本地合成样本", editionId: "edition-" + id,
  chapters: [{ id: "chapter-" + id, title: "验收章节", paragraphs: texts.map((text, i) => ({ id: id + "-p" + i, text })) }] });
const paragraphs = book().chapters[0].paragraphs;
const fullSelection = () => selectionFromParts(paragraphs.map(p => ({ paragraphId: p.id, startOffset: 0, endOffset: p.text.length, text: p.text })));
const analysis = { summary: "合成样本的句读", breakdown: [], concepts: [], context: "", uncertainty: "" };
let host: HTMLDivElement, root: Root | undefined, frames: Map<number, FrameRequestCallback>, sequence: number;
let requests: ReadingRequestPayload[], savedAnnotations: TextAnnotation[];
let storedMessageOverride: Record<string, unknown> | undefined;
const fetcher = vi.fn<typeof fetch>();
function url(input: Parameters<typeof fetch>[0]): URL { return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost"); }
function button(text: string, within: ParentNode = host): HTMLButtonElement {
  const found = [...within.querySelectorAll("button")].find(element => element.textContent?.trim() === text);
  if (!(found instanceof HTMLButtonElement)) throw new Error("缺少按钮：" + text);
  return found;
}
async function settle() {
  await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
  for (let i = 0; frames.size && i < 8; i++) await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(performance.now())); });
}
async function click(element: HTMLElement) { await act(async () => element.click()); await settle(); }
async function mount() { root = createRoot(host); await act(async () => root!.render(createElement(Home))); await settle(); }
function paragraph(index: number): HTMLElement {
  const element = host.querySelector<HTMLElement>('p[data-paragraph-id="A-p' + index + '"]');
  if (!element) throw new Error("正文段落未加载"); return element;
}
async function selectParagraph(index: number) {
  await act(async () => {
    const element = paragraph(index), range = document.createRange(); element.dispatchEvent(new Event("pointerdown", { bubbles: true })); range.selectNodeContents(element);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }); await settle();
}
const chapter = (values: string[]): LibraryChapter => ({ id: "c", title: "章", paragraphs: values.map((text, i) => ({ id: "p" + i, text })) });
function domSelection(values: string[], reverse: boolean, textMode: boolean): Selection {
  host.replaceChildren(...values.map((text, i) => {
    const p = document.createElement("p"); p.textContent = text;
    if (textMode) p.dataset.paragraphId = "p" + i;
    return p;
  }));
  const first = host.firstChild!.firstChild!, last = host.lastChild!.firstChild!;
  const selection = window.getSelection()!;
  selection.setBaseAndExtent(reverse ? last : first, reverse ? last.textContent!.length : 0, reverse ? first : last, reverse ? 0 : last.textContent!.length);
  return selection;
}

beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("ResizeObserver", undefined);
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  frames = new Map(); sequence = 0; requests = []; savedAnnotations = []; root = undefined; storedMessageOverride = undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  localStorage.clear(); localStorage.setItem("judu:active-book", "A");
  fetcher.mockImplementation(async (input, init) => {
    const endpoint = url(input);
    if (endpoint.pathname === "/api/settings/ai") return Response.json({ model: "mock-only", hasApiKey: true });
    if (endpoint.pathname === "/api/library") return Response.json([book(), book("B")]);
    if (endpoint.pathname === "/api/books/A") return Response.json(book());
    if (endpoint.pathname === "/api/books/B") return Response.json(book("B"));
    if (endpoint.pathname === "/api/threads") return Response.json({ threads: [] });
    if (endpoint.pathname === "/api/threads/thread-review") {
      const selection = fullSelection(), input = { mode: "analyze", question: "请句读", selectedText: selection.text, selectionAnchors: selectionAnchors(selection), bookId: "A", editionId: "edition-A" };
      return Response.json({ threadId: "thread-review", thread: { id: "thread-review", bookId: "A", editionId: "edition-A", title: "验收会话", createdAt: "2026-09-18", updatedAt: "2026-09-18", messageCount: 2 }, messages: [
        { id: "user-review", role: "user", content: "请句读", status: "completed" },
        { id: "message-review", role: "assistant", content: "模拟回答", status: "completed", structuredOutput: JSON.stringify(storedMessageOverride ?? { ...analysis, anchor: makeReadingAnchor(input.selectionAnchors), _request: { version: 1, clientUserMessageId: "user-review", clientAssistantMessageId: "message-review", input } }) },
      ] });
    }
    if (endpoint.pathname === "/api/annotations") return Response.json({ annotations: savedAnnotations });
    if (endpoint.pathname === "/api/reading-marks") return Response.json({ marks: [] });
    if (endpoint.pathname === "/api/knowledge") return Response.json({ editionId: endpoint.searchParams.get("editionId"), records: [], concepts: [] });
    if (endpoint.pathname === "/api/search/status") return Response.json({ backend: "sqlite", editionId: endpoint.searchParams.get("editionId"), paragraphCount: 2, indexedCount: 0, vectorIndexed: false, note: "模拟" });
    if (endpoint.pathname === "/api/analyze/stream" && init?.method === "POST") {
      if (typeof init.body !== "string") throw new Error("请求不是 JSON");
      requests.push(JSON.parse(init.body) as ReadingRequestPayload);
      return new Response('event: done\ndata: {"content":"本地模拟回答，未使用 AI。"}\n\n', { headers: { "Content-Type": "text/event-stream" } });
    }
    throw new Error("验收禁止外部网络，未模拟接口：" + endpoint.pathname);
  });
  vi.stubGlobal("fetch", fetcher); host = document.createElement("div"); document.body.append(host);
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); host.remove(); window.getSelection()?.removeAllRanges(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("P0 独立验收：字符上限与 DOM", () => {
  it.each([false, true])("精读反向=%s，Unicode 限制后的可见 DOM 与快照一致", reverse => {
    const values = ["甲".repeat(600), "😀".repeat(600)], selection = domSelection(values, reverse, true);
    const snapshot = readReadingSelection(selection, host)!;
    expect(countReadingCharacters(snapshot.text)).toBe(1000);
    expect(selection.toString()).toBe(snapshot.fragments!.map(part => part.text).join(""));
    expect(readReadingSelection(selection, host)).toEqual(snapshot);
    expect(selectionMatchesParagraphs(snapshot, chapter(values).paragraphs)).toBe(true);
    expect(snapshot.fragments!.map(p => p.text).join("")).not.toMatch(/[\uD800-\uDBFF]$/u);
  });
  it.each([false, true])("原版反向=%s，Unicode 限制后的可见 DOM 与来源一致", reverse => {
    const values = ["甲".repeat(600), "😀".repeat(600)], selection = domSelection(values, reverse, false);
    const maps = mapEpubDocument(document, chapter(values)), snapshot = readLimitedEpubSelection(selection, maps)!;
    expect(countReadingCharacters(snapshot.text)).toBe(1000);
    expect(selection.toString()).toBe(snapshot.fragments!.map(part => part.text).join(""));
    expect(selectionFromEpubRange(selection.getRangeAt(0), maps)).toEqual(snapshot);
    expect(selectionMatchesParagraphs(snapshot, chapter(values).paragraphs)).toBe(true);
  });
  it("1000 字边界只留下完整 UTF16 字符，不能越界或凭空拼段", () => {
    const source = [{ id: "p", text: "😀".repeat(1001) }];
    const capped = capReadingSelection({ paragraphId: "p", startOffset: 0, endOffset: 2002, text: source[0].text });
    expect(capped).toEqual({ paragraphId: "p", startOffset: 0, endOffset: 2000, text: "😀".repeat(1000) });
    expect(selectionMatchesParagraphs(capped, source)).toBe(true);
    expect(anchorsMatchParagraphs([{ paragraphId: "p", startOffset: 1, endOffset: 3, selectedText: source[0].text.slice(1, 3) }], source)).toBe(false);
  });
  it("正文选区夹入未索引脚注不得默默略过", () => {
    host.innerHTML = '<p>第一段</p><aside>未索引脚注</aside><p>第二段</p>';
    const range = document.createRange(); range.selectNodeContents(host);
    expect(selectionFromEpubRange(range, mapEpubDocument(document, chapter(["第一段", "第二段"])))).toBeNull();
  });
});

describe("P0 独立验收：快照、历史、兼容", () => {
  it("请求持有多段完整快照，切换可变输入不污染重试和来源", () => {
    const selection = fullSelection(), parts = selectionAnchors(selection);
    const request = createReadingRequest({ mode: "analyze", question: "请句读", selectedText: selection.text, selectionAnchors: parts, bookId: "A", editionId: "edition-A" });
    parts[0].selectedText = "改动后的错误输入";
    const messages = applyReadingRequest([], request);
    expect(anchorParts(messages[0].anchor!)).toEqual(selectionAnchors(selection));
    const stored = { id: request.payload.clientAssistantMessageId, role: "assistant" as const, content: "", status: "error" as const,
      structuredOutput: JSON.stringify({ _request: { version: 1, clientUserMessageId: request.payload.clientUserMessageId, clientAssistantMessageId: request.payload.clientAssistantMessageId, input: request.payload } }) };
    expect(restoreReadingRequest(request.payload.threadId, stored)?.payload.selectionAnchors).toEqual(selectionAnchors(selection));
    expect(anchorParts(hydrateChatHistory([stored])[0].anchor!)).toEqual(selectionAnchors(selection));
  });
  it("旧单段来源保持相同偏移和文本，不强制重导入", () => {
    const part = selectionAnchors(fullSelection())[0];
    const anchor = makeReadingAnchor([part]);
    const [message] = hydrateChatHistory([{ id: "old", role: "assistant", content: "旧消息", structuredOutput: JSON.stringify({ anchor }) }]);
    expect(message.anchor).toEqual(part); expect(message.anchor?.fragments).toBeUndefined();
  });
  it("不同版本的段落 ID 不可通过相同文字伪造来源", () => {
    expect(selectionMatchesParagraphs(fullSelection(), book("B").chapters[0].paragraphs)).toBe(false);
  });
});

describe("P0 独立验收：页面事件与发送", () => {
  it("[阻断] 继续选取后 selectionchange 重发同一新选区不能覆盖已经合并的来源", async () => {
    await mount(); await selectParagraph(0); await click(button("继续选取")); await selectParagraph(1);
    // WHY：mouseup 与随后 selectionchange 都会交付同一 Selection，这是实际页面的两个监听入口。
    await act(async () => document.dispatchEvent(new Event("selectionchange"))); await settle();
    await click(button("句读一下"));
    expect(requests).toHaveLength(1);
    expect(requests[0].selectedText).toBe(fullSelection().text);
    expect(requests[0].selectionAnchors).toEqual(selectionAnchors(fullSelection()));
  });
  it("新拖选从正文跨到容器外时不能保留和发送上一次选文", async () => {
    await mount(); await selectParagraph(0);
    const outside = document.createElement("span"); outside.textContent = "正文外内容"; host.append(outside);
    await act(async () => {
      paragraph(1).dispatchEvent(new Event("pointerdown", { bubbles: true }));
      const range = document.createRange(); range.setStart(paragraph(1).firstChild!, 0); range.setEnd(outside.firstChild!, outside.textContent!.length);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    }); await settle();
    const action = [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "句读一下");
    if (action) await click(action);
    expect(requests, "无效新选区后仍发送了之前的选文").toHaveLength(0);
    expect(host.querySelector('[aria-label="选中文本操作"]')).toBeNull();
  });
  it("[阻断] 点击多段句读第二段标注后应恢复整个选区并导航首段", async () => {
    savedAnnotations = paragraphs.map(p => createAnnotation({ paragraphId: p.id, startOffset: 0, endOffset: p.text.length, threadId: "thread-review", messageId: "message-review", summary: "合成样本句读", concepts: [], createdAt: "2026-09-18T00:00:00Z" }, p.text));
    await mount();
    const mark = paragraph(1).querySelector<HTMLElement>('.judu-history-marker');
    if (!mark) throw new Error("未渲染测试标注");
    await click(mark); await click(button("查看完整句读", document));
    const selectionText = host.querySelector(".selection-bar")?.textContent;
    expect(selectionText).toContain("已选 " + countReadingCharacters(fullSelection().text) + " / 1000 字");
    expect(navigation.setAnchor).toHaveBeenLastCalledWith({ paragraphId: "A-p0", offset: 0 });
  });
});



describe("P0 独立验收：选择边界与多段保存", () => {
  it("[阻断] 从正文外反向拖入正文的无效选区也不能继续发送旧选文", async () => {
    await mount(); await selectParagraph(0);
    const outside = document.createElement("span"); outside.textContent = "正文外内容"; host.append(outside);
    await act(async () => {
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      window.getSelection()!.setBaseAndExtent(outside.firstChild!, outside.textContent!.length, paragraph(1).firstChild!, 0);
      paragraph(1).dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      document.dispatchEvent(new Event("selectionchange"));
    }); await settle();
    const action = [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "句读一下");
    if (action) await click(action);
    expect(requests, "反向跨容器选区未清除之前的选文").toHaveLength(0);
  });
  it("多段手动标注请求保存所有锚点及各自的文本哈希", async () => {
    await mount();
    await act(async () => {
      paragraph(0).dispatchEvent(new Event("pointerdown", { bubbles: true }));
      const range = document.createRange(); range.setStart(paragraph(0), 0); range.setEnd(paragraph(1), paragraph(1).childNodes.length);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      paragraph(1).dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }); await settle();
    const highlight = host.querySelector<HTMLButtonElement>('[aria-label="黄色标亮"]');
    expect(highlight).not.toBeNull(); await click(highlight!);
    const post = fetcher.mock.calls.find(([input, init]) => url(input).pathname === "/api/reading-marks" && init?.method === "POST");
    const body: unknown = JSON.parse(String(post?.[1]?.body));
    expect(body).toMatchObject({ editionId: "edition-A", anchors: selectionAnchors(fullSelection()).map(part => ({ ...part, textHash: hashText(part.selectedText) })) });
  });
  it("切书后清空来源、菜单和可发送选文", async () => {
    await mount(); await selectParagraph(0);
    const shelfNav = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "书架")!;
    await click(shelfNav);
    const shelfButtons = host.querySelectorAll<HTMLButtonElement>(".bookshelf-open");
    expect(shelfButtons).toHaveLength(2); await click(shelfButtons[1]);
    expect(host.querySelector(".selection-bar")?.textContent).not.toContain("已选");
    expect(host.querySelector('[aria-label="选中文本操作"]')).toBeNull();
    expect(requests).toHaveLength(0);
  });
  it("知识卡片保留完整多段；任一片段失配时不能退化为首段已验证", () => {
    const parts = selectionAnchors(fullSelection()), anchor = makeReadingAnchor(parts);
    const row = { id: "m", edition_id: "edition-A", source_edition_id: "edition-A", paragraph_id: parts[0].paragraphId, paragraph_text: parts[0].selectedText,
      chapter_id: "chapter-A", chapter_title: "验收章", thread_id: "t", role: "assistant", status: "completed", created_at: "2026-09-18T00:00:00Z", structured_output: JSON.stringify({ ...analysis, anchor }) };
    const valid = buildBookKnowledge("edition-A", [], [row], candidate => anchorsMatchParagraphs(anchorParts(candidate), paragraphs));
    expect(valid.records[0].anchor).toMatchObject(anchor); expect(valid.records[0].excerpt).toBe(fullSelection().text);
    const annotation = { ...row, id: "a", start_offset: 0, end_offset: parts[0].endOffset, text_hash: hashText(parts[0].selectedText), summary: "首段标注", concepts: "[]", concept_details: "[]", stored_message_id: "m", message_id: "m" };
    const changed = [paragraphs[0], { ...paragraphs[1], text: "版本中的正文已改变" }];
    const invalid = buildBookKnowledge("edition-A", [annotation], [row], candidate => anchorsMatchParagraphs(anchorParts(candidate), changed));
    expect(invalid.records[0].anchor).toBeNull(); expect(invalid.records[0].excerpt).toBe(fullSelection().text);
  });
});



describe("P0 独立验收：非侵入精读来源高亮", () => {
  function highlights() {
    class StoredHighlight { constructor(...ranges: Range[]) { this.ranges = ranges; } ranges: Range[]; }
    const registry = new Map<string, StoredHighlight>();
    vi.stubGlobal("CSS", { escape: (value: string) => value, highlights: registry });
    vi.stubGlobal("Highlight", StoredHighlight);
    return { registry, text: () => registry.get("judu-source-selection")?.ranges.map(range => range.toString()).join("") };
  }
  const fixedSelection = selectionFromParts([{ paragraphId: "p", startOffset: 2, endOffset: 8, text: "丙丁戊己庚辛" }]);
  function View({ annotations = [], enabled = true, layout = 0, concepts = false }: { annotations?: TextAnnotation[]; enabled?: boolean; layout?: number; concepts?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useTextSourceHighlights(ref, fixedSelection, enabled, layout);
    return createElement("div", { ref }, createElement(AnnotatedParagraph, { paragraphId: "p", text: "甲乙丙丁戊己庚辛壬癸", sourceText: "甲乙丙丁戊己庚辛壬癸", sourceStartOffset: 0, sourceEndOffset: 10,
      annotations, showConcepts: concepts, bookConcepts: [{ name: "丙丁", text: "模拟概念" }], onOpenAnnotation: () => {} }));
  }
  it("绘制、禁用和卸载均不拆装正文，也不改变用户原生 Range", async () => {
    const layer = highlights(); root = createRoot(host);
    await act(async () => root!.render(createElement(View, { enabled: false })));
    const node = host.querySelector('[data-reader-text]')!.firstChild!, native = window.getSelection()!;
    native.setBaseAndExtent(node, 2, node, 8);
    const range = native.getRangeAt(0), html = host.innerHTML;
    await act(async () => root!.render(createElement(View, { enabled: true })));
    expect(layer.text()).toBe("丙丁戊己庚辛"); expect(host.innerHTML).toBe(html);
    expect(native.getRangeAt(0)).toBe(range); expect(native.anchorNode).toBe(node); expect(native.toString()).toBe("丙丁戊己庚辛");
    await act(async () => root!.render(createElement(View, { enabled: false })));
    expect(layer.registry.has("judu-source-selection")).toBe(false); expect(native.toString()).toBe("丙丁戊己庚辛");
  });
  it("[回归] 同页标注刷新导致 DOM 分片改变后，来源高亮须重新绑定完整范围", async () => {
    const layer = highlights(); root = createRoot(host);
    await act(async () => root!.render(createElement(View)));
    expect(layer.text()).toBe("丙丁戊己庚辛");
    const annotation = createAnnotation({ paragraphId: "p", startOffset: 3, endOffset: 5, threadId: "t", summary: "新保存的标注", concepts: [], createdAt: "2026-09-18T00:00:00Z" }, "甲乙丙丁戊己庚辛壬癸");
    await act(async () => root!.render(createElement(View, { annotations: [annotation] })));
    // WHY：真实页面的 currentPage、selection 在保存标注后都未变，但 AnnotatedParagraph 会重分段。
    expect(layer.text()).toBe("丙丁戊己庚辛");
  });
  it("[回归] 同页切换概念标注不能使来源高亮塌缩或漏掉后半段", async () => {
    const layer = highlights(); root = createRoot(host);
    await act(async () => root!.render(createElement(View)));
    expect(layer.text()).toBe("丙丁戊己庚辛");
    await act(async () => root!.render(createElement(View, { concepts: true })));
    expect(layer.text()).toBe("丙丁戊己庚辛");
  });
  it("分页片段用 UTF16 偏移并忽略历史按钮，清理仅删除自己注册的高亮", async () => {
    const layer = highlights(); root = createRoot(host);
    const other = document.createRange(); other.selectNodeContents(host);
    layer.registry.set("other-feature", { ranges: [other] });
    const selection = { paragraphId: "p", startOffset: 51, endOffset: 55, text: "😀乙丙" };
    function Slice({ layout, enabled = true }: { layout: number; enabled?: boolean }) {
      const ref = useRef<HTMLDivElement>(null); useTextSourceHighlights(ref, selection, enabled, layout);
      return createElement("div", { ref }, createElement("p", { "data-paragraph-id": "p", "data-source-start": layout ? "53" : "50", "data-source-end": "56" },
        createElement("span", { "data-reader-text": "" }, layout ? "乙" : "甲😀乙"),
        createElement("button", { "data-reader-decoration": "" }, "查看历史"),
        createElement("span", { "data-reader-text": "" }, "丙丁")));
    }
    await act(async () => root!.render(createElement(Slice, { layout: 0 })));
    expect(layer.text()).toBe("😀乙查看历史丙");
    // Range 包围中间装饰 DOM，但起止只按正文 UTF16 计算；装饰不消耗正文锚点长度。
    const first = layer.registry.get("judu-source-selection")!.ranges[0];
    expect(first.startOffset).toBe(1); expect(first.endOffset).toBe(1);
    await act(async () => root!.render(createElement(Slice, { layout: 1 })));
    expect(layer.text()).toBe("乙查看历史丙");
    await act(async () => root!.render(createElement(Slice, { layout: 1, enabled: false })));
    expect(layer.registry.has("judu-source-selection")).toBe(false); expect(layer.registry.has("other-feature")).toBe(true);
  });
});

describe("P0 独立验收：扩选 base 生命周期", () => {
  async function dragSecondParagraph(length: number, start = false, finish = false) {
    await act(async () => {
      const target = paragraph(1);
      if (start) target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      const node = target.querySelector('[data-reader-text]')!.firstChild!;
      window.getSelection()!.setBaseAndExtent(node, 0, node, length);
      document.dispatchEvent(new Event("selectionchange"));
      if (finish) target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }); await settle();
  }
  it("同次拖选端点多次改变始终保留前段 base，而非只在首次快照合并", async () => {
    await mount(); await selectParagraph(0); await click(button("继续选取"));
    await dragSecondParagraph(3, true); await dragSecondParagraph(8); await dragSecondParagraph(12, false, true);
    await click(button("句读一下"));
    expect(requests).toHaveLength(1); expect(requests[0].selectedText).toBe(texts[0] + "\n\n" + texts[1].slice(0, 12));
    expect(requests[0].selectionAnchors).toHaveLength(2); expect(requests[0].selectionAnchors?.[1].endOffset).toBe(12);
  });
  it("扩选完成后下一次普通 pointerdown 不继续带入旧 base", async () => {
    await mount(); await selectParagraph(0); await click(button("继续选取"));
    await dragSecondParagraph(12, true, true);
    await selectParagraph(1); await click(button("句读一下"));
    expect(requests).toHaveLength(1); expect(requests[0].selectedText).toBe(texts[1]);
    expect(requests[0].selectionAnchors).toHaveLength(1); expect(requests[0].selectionAnchors?.[0].paragraphId).toBe("A-p1");
  });
});

describe("P0 独立验收：消息来源完整性优先于残缺标注", () => {
  it.each([0, 1])("只有第 %i 段标注保存成功，仍须按消息里的完整来源恢复两段", async index => {
    // WHY：模拟逐段保存中途失败或历史标注丢失；消息 _request/anchor 已成功保存两段。
    const p = paragraphs[index];
    savedAnnotations = [createAnnotation({ paragraphId: p.id, startOffset: 0, endOffset: p.text.length, threadId: "thread-review", messageId: "message-review", summary: "只保存成功的单段标注", concepts: [], createdAt: "2026-09-18T00:00:00Z" }, p.text)];
    await mount();
    const marker = paragraph(index).querySelector<HTMLElement>(".judu-history-marker");
    expect(marker).not.toBeNull(); await click(marker!); await click(button("查看完整句读", document));
    // 请求成功加载该消息，来源卡片已有全部片段，不能把 annotations 的子集冒充完整选区。
    const source = host.querySelector('[data-message-id="message-review"] [data-testid="message-source"] blockquote');
    expect(source?.textContent).toBe(fullSelection().text);
    expect(host.querySelector(".selection-bar")?.textContent).toContain("已选 " + countReadingCharacters(fullSelection().text) + " / 1000 字");
    expect(navigation.setAnchor).toHaveBeenLastCalledWith({ paragraphId: "A-p0", offset: 0 });
  });
});


describe("P0 独立验收：旧消息缺来源与损坏来源的区别", () => {
  async function openPartialAnnotation(message: Record<string, unknown>) {
    storedMessageOverride = message;
    const p = paragraphs[1]; savedAnnotations = [createAnnotation({ paragraphId: p.id, startOffset: 0, endOffset: p.text.length, threadId: "thread-review", messageId: "message-review", summary: "仍可核验的第二段标注", concepts: [], createdAt: "2026-09-18T00:00:00Z" }, p.text)];
    await mount(); const marker = paragraph(1).querySelector<HTMLElement>(".judu-history-marker");
    expect(marker).not.toBeNull(); await click(marker!); await click(button("查看完整句读", document));
  }
  it("真正没有保存 anchor 的旧消息保留已核验的单段标注来源", async () => {
    await openPartialAnnotation({ ...analysis });
    expect(host.querySelector(".selection-bar")?.textContent).toContain("已选 " + texts[1].length + " / 1000 字");
    expect(navigation.setAnchor).toHaveBeenLastCalledWith({ paragraphId: "A-p1", offset: 0 });
  });
  it("完整 anchor 中后一段与当前版文字不符时，清除临时局部选文", async () => {
    const anchor = makeReadingAnchor(selectionAnchors(fullSelection())); anchor.fragments![1].selectedText = "错".repeat(texts[1].length);
    await openPartialAnnotation({ ...analysis, anchor });
    expect(host.querySelector(".selection-bar")?.textContent).not.toContain("已选");
    expect(host.textContent).toContain("未保留局部选文");
  });
  it("[回归] 明确保存了 version2 但 fragments 结构损坏，不能降级成旧消息缺 anchor", async () => {
    const anchor = makeReadingAnchor(selectionAnchors(fullSelection())); anchor.fragments![1].endOffset += 1;
    await openPartialAnnotation({ ...analysis, anchor });
    expect(host.querySelector(".selection-bar")?.textContent).not.toContain("已选");
    expect(host.textContent).toContain("未保留局部选文");
  });
});

it("[回归] 中间段 annotation 缺失时，不能在请求权威消息来源前提前返回", async () => {
  const three = [...paragraphs, { id: "A-p2", text: "第三段正文用于检验残缺标注不会阻断消息来源恢复。" }];
  const selection = selectionFromParts(three.map(p => ({ paragraphId: p.id, startOffset: 0, endOffset: p.text.length, text: p.text })));
  storedMessageOverride = { ...analysis, anchor: makeReadingAnchor(selectionAnchors(selection)) };
  savedAnnotations = [three[0], three[2]].map(p => createAnnotation({ paragraphId: p.id, startOffset: 0, endOffset: p.text.length, threadId: "thread-review", messageId: "message-review", summary: "消息完整，标注仅存第一和第三段", concepts: [], createdAt: "2026-09-18T00:00:00Z" }, p.text));
  const originalFetch = fetcher.getMockImplementation(); if (!originalFetch) throw new Error("缺少模拟请求实现");
  const threeParagraphBook = { ...book(), chapters: [{ ...book().chapters[0], paragraphs: three }] };
  fetcher.mockImplementation(async (input, init) => {
    const path = url(input).pathname;
    if (path === "/api/library") return Response.json([threeParagraphBook]);
    if (path === "/api/books/A") return Response.json(threeParagraphBook);
    return originalFetch(input, init);
  });
  await mount(); const marker = paragraph(2).querySelector<HTMLElement>(".judu-history-marker");
  expect(marker).not.toBeNull(); await click(marker!); await click(button("查看完整句读", document));
  expect(fetcher.mock.calls.filter(([input]) => url(input).pathname === "/api/threads/thread-review"), "不能因残缺标注不连续而放弃读取更完整的消息来源").toHaveLength(1);
  expect(host.querySelector(".selection-bar")?.textContent).toContain("已选 " + countReadingCharacters(selection.text) + " / 1000 字");
  expect(navigation.setAnchor).toHaveBeenLastCalledWith({ paragraphId: "A-p0", offset: 0 });
});
