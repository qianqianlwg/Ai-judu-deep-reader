// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import type { PdfRuntime } from "@/lib/pdf-loader";
import type { PdfTextPage } from "@/lib/pdf-source-map";
import type { LibraryBookContent } from "@/lib/library";
import { DEFAULT_READING_APPEARANCE } from "@/lib/reading-appearance";
import type { EpubReaderProps } from "./epub-reader";
import { PdfReader } from "./pdf-reader";

type PageProps = ComponentProps<typeof import("./pdf-page").PdfPage>;
const loader = vi.hoisted(() => ({ loadPdfRuntime: vi.fn(), openPdf: vi.fn(), indexPdfPages: vi.fn() }));
const pageProbe = vi.hoisted(() => ({ latest: new Map<number, PageProps>(), removed: vi.fn() }));
vi.mock("@/lib/pdf-loader", () => loader);
vi.mock("./pdf-page", async () => {
  const { useEffect, useRef } = await import("react");
  const { bindPdfTextLayer } = await import("@/lib/pdf-source-map");
  return { PdfPage: function MockPdfPage(props: PageProps) {
    const ref = useRef<HTMLDivElement>(null); pageProbe.latest.set(props.page.pageNumber, props);
    const { page, document: sourceDocument, scale, rotation, onReady, onRemove } = props;
    useEffect(() => {
      const node = ref.current!;
      onReady(bindPdfTextLayer(page, node, [...node.querySelectorAll("span")], page.items.map(item => item.str)));
      return () => { onRemove(page.pageNumber); pageProbe.removed(page.pageNumber); };
    }, [page, sourceDocument, scale, rotation, onReady, onRemove]);
    return <div ref={ref} className="textLayer" data-pdf-page={props.page.pageNumber} data-scale={props.scale} data-rotation={props.rotation}>
      {props.page.items.map((item, index) => <span key={index}>{item.str}</span>)}
    </div>;
  } };
});
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
function fixture(count = 4, textAt: (page: number) => string = page => `第${page}页可供句读的正文内容。`) {
  const texts = Array.from({ length: count }, (_, index) => textAt(index + 1));
  const book: LibraryBookContent = { id: "book", title: "本地受控PDF", author: "测试", editionId: "edition",
    edition: { id: "edition", fileName: "fixture.pdf", fileType: "pdf", hasOriginalFile: true, originalHash: "a".repeat(64), createdAt: "2026-09-18" },
    chapters: texts.map((text, index) => ({ id: `c${index + 1}`, title: `第${index + 1}页`, sourceHref: `pdf:page:${index + 1}`, paragraphs: text ? [{ id: `p${index + 1}`, text }] : [] })) };
  const pages: PdfTextPage[] = texts.map((str, index) => ({ pageNumber: index + 1, width: 600, height: 800, rotation: 0, mapped: false, runs: [],
    items: str ? [{ str, transform: [1, 0, 0, 1, 0, 0], width: 300, height: 12 }] : [] }));
  const documentProxy = { numPages: count, getOutline: vi.fn(async (): Promise<unknown> => []),
    getDestination: vi.fn(async (): Promise<unknown> => [1, { name: "Fit" }]), getPageIndex: vi.fn(async () => 1) };
  const proxy = documentProxy as unknown as PDFDocumentProxy;
  const task = { promise: Promise.resolve(proxy), destroy: vi.fn(async () => {}) };
  return { book, pages, documentProxy, proxy, task };
}
class TestHighlight { constructor(...ranges: Range[]) { this.ranges = ranges; } ranges: Range[]; }
const highlights = new Map<string, TestHighlight>();
const rect = { left: 20, top: 120, right: 220, bottom: 140, width: 200, height: 20, x: 20, y: 120, toJSON: () => ({}) };
let h: ReturnType<typeof fixture>, root: Root, host: HTMLDivElement, props: EpubReaderProps, mounted: boolean;
const runtime = {} as PdfRuntime;
const stored = () => JSON.parse(localStorage.getItem(`judu:pdf-position:${props.book.editionId}`) ?? "null") as { hash: string; page: number; zoom: number; rotation: number } | null;
const currentPage = () => Number(host.querySelector<HTMLInputElement>('[aria-label="PDF页码"]')!.value);
const viewport = () => host.querySelector<HTMLDivElement>(".pdf-viewport")!;
const textNode = (page = 1) => host.querySelector(`[data-pdf-page="${page}"] span`)!.firstChild!;
const button = (label: string) => [...host.querySelectorAll("button")].find(node => node.textContent === label)!;
async function render(next: Partial<EpubReaderProps> = {}) { props = { ...props, ...next }; await act(async () => root.render(<PdfReader {...props} />)); }
async function unmount() { if (mounted) { await act(async () => root.unmount()); mounted = false; } }
async function change(selector: string, value: string) {
  const element = host.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
  await act(async () => {
    const prototype = element.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element.tagName === "INPUT" ? "input" : "change", { bubbles: true }));
  });
}
async function select(start: Node, startOffset: number, end: Node, endOffset: number, reverse = false) {
  await act(async () => {
    const selection = document.getSelection()!;
    selection.setBaseAndExtent(reverse ? end : start, reverse ? endOffset : startOffset, reverse ? start : end, reverse ? startOffset : endOffset);
    document.dispatchEvent(new Event("selectionchange"));
  });
}
function clampViewport(height: number) {
  const element = viewport(); let top = element.scrollTop;
  const contentHeight = () => parseFloat(element.querySelector<HTMLElement>(".pdf-scroll-space")!.style.height);
  // WHY：jsdom没有布局或滚动钳制；只补浏览器scrollTop范围，不mock导航、目录解析及onScroll业务。
  const max = () => Math.max(0, contentHeight() - height);
  Object.defineProperties(element, {
    clientHeight: { configurable: true, get: () => height }, scrollHeight: { configurable: true, get: contentHeight },
    scrollTop: { configurable: true, get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, max())); } },
  });
  element.scrollTop = top; return max;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("CSS", { highlights }); vi.stubGlobal("Highlight", TestHighlight);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("组件验收禁止联网或调用真实AI"); }));
  vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => rect });
  // WHY：PDF接入真实共享交互层后会读取Range矩形；jsdom无排版，提供与已有页几何一致的受控矩形，不mock浮层业务。
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => Object.assign([rect], { item: (i: number) => i === 0 ? rect : null }) });
  localStorage.clear(); document.getSelection()?.removeAllRanges(); highlights.clear(); pageProbe.latest.clear(); pageProbe.removed.mockClear();
  h = fixture(); loader.loadPdfRuntime.mockReset().mockResolvedValue(runtime); loader.openPdf.mockReset().mockImplementation(() => h.task);
  loader.indexPdfPages.mockReset().mockImplementation(async (_document: PDFDocumentProxy, signal: AbortSignal, progress: (page: number) => void) => {
    signal.throwIfAborted(); progress(h.pages.length); return h.pages;
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); mounted = true;
  props = { book: h.book, anchor: null, appearance: DEFAULT_READING_APPEARANCE, annotations: [], concepts: [],
    onSelect: vi.fn(), onPosition: vi.fn(), onNotice: vi.fn(), onFallback: vi.fn(), onClearSelection: vi.fn(), onStartSelection: vi.fn() };
});
afterEach(async () => {
  await unmount(); host.remove(); document.getSelection()?.removeAllRanges(); localStorage.clear();
  Reflect.deleteProperty(Range.prototype, "getClientRects"); Reflect.deleteProperty(Range.prototype, "getBoundingClientRect"); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("PdfReader 原件版本、索引与能力提示", () => {
  it("原件URL编码book/edition，加载索引和目录且不联网", async () => {
    const book = { ...h.book, id: "书/一", editionId: "版&二" }; await render({ book });
    expect(loader.openPdf).toHaveBeenCalledWith(runtime, "/api/books/%E4%B9%A6%2F%E4%B8%80/original?editionId=%E7%89%88%26%E4%BA%8C");
    expect(loader.indexPdfPages).toHaveBeenCalledWith(h.proxy, expect.any(AbortSignal), expect.any(Function));
    expect(h.documentProxy.getOutline).toHaveBeenCalledOnce(); expect(currentPage()).toBe(1);
    expect(host.querySelector("section")?.getAttribute("aria-busy")).toBe("false"); expect(fetch).not.toHaveBeenCalled();
  });
  it("页索引进度可见，完成前不挂载可选择页面", async () => {
    const gate = deferred<PdfTextPage[]>(); loader.indexPdfPages.mockReturnValue(gate.promise); await render();
    const progress = loader.indexPdfPages.mock.calls[0][2] as (page: number) => void;
    await act(async () => progress(2)); expect(host.textContent).toContain("2 / 4"); expect(pageProbe.latest.size).toBe(0);
    await act(async () => gate.resolve(h.pages)); expect(host.textContent).not.toContain("正在建立"); expect(pageProbe.latest.size).toBeGreaterThan(0);
  });
  it("旧PDF全文不匹配仍显示原版但不给错误句读来源", async () => {
    const book = { ...h.book, chapters: [{ id: "old", title: "旧索引", paragraphs: [{ id: "old-p", text: "不同的旧文" }] }] };
    await render({ book }); expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/未猜测.*句读位置/u));
    expect(pageProbe.latest.get(1)?.page.mapped).toBe(false); expect(pageProbe.latest.get(1)?.page.runs).toEqual([]);
    await select(textNode(), 0, textNode(), 12); expect(props.onSelect).not.toHaveBeenCalled(); expect(props.onClearSelection).toHaveBeenCalled();
  });
  it("旧索引全文精确一致可以映射，不能仅凭无sourceHref拒绝", async () => {
    const book = { ...h.book, chapters: h.book.chapters.map(chapter => ({ id: chapter.id, title: chapter.title, paragraphs: chapter.paragraphs })) };
    await render({ book }); expect(pageProbe.latest.get(1)?.page.mapped).toBe(true);
    expect(props.onNotice).not.toHaveBeenCalled(); await select(textNode(), 0, textNode(), 12); expect(props.onSelect).toHaveBeenCalledOnce();
  });
  it("扫描页明确提示OCR未启用，不能把图像当文字来源", async () => {
    h = fixture(3, page => page === 1 ? "" : `正文第${page}页`); await render({ book: h.book });
    expect(host.textContent).toContain("OCR 尚未启用"); expect(host.textContent).toContain("不能直接文字句读");
    expect(pageProbe.latest.get(1)?.page.items).toEqual([]); expect(props.onSelect).not.toHaveBeenCalled();
    await act(async () => button("下一页").click()); expect(host.textContent).not.toContain("OCR 尚未启用");
  });
  it("加载错误展示重试与回退，重试销毁旧加载任务", async () => {
    h.task.promise = Promise.reject(new Error("受控原件读取失败")); await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("受控原件读取失败");
    await act(async () => button("切回精读").click()); expect(props.onFallback).toHaveBeenCalledOnce();
    const oldTask = h.task; h = fixture(); await act(async () => button("重试原版").click());
    expect(oldTask.destroy).toHaveBeenCalledOnce(); expect(loader.openPdf).toHaveBeenCalledTimes(2); expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("PdfReader 页导航、虚拟化、hash位置", () => {
  it("前后翻页边界、输入越界不破坏当前页", async () => {
    await render(); expect(button("上一页").disabled).toBe(true);
    await act(async () => button("下一页").click()); expect(currentPage()).toBe(2);
    await change('[aria-label="PDF页码"]', "4"); expect(currentPage()).toBe(4); expect(button("下一页").disabled).toBe(true);
    await change('[aria-label="PDF页码"]', "99"); expect(currentPage()).toBe(4);
    await change('[aria-label="PDF页码"]', "0"); expect(currentPage()).toBe(4);
  });
  it("100页只挂载视窗附近有限页面，远跳释放旧页面", async () => {
    h = fixture(100); await render({ book: h.book }); expect(host.querySelectorAll(".textLayer[data-pdf-page]").length).toBeLessThanOrEqual(5);
    await change('[aria-label="PDF页码"]', "50"); expect(currentPage()).toBe(50);
    expect(host.querySelector('[data-pdf-page="50"]')).not.toBeNull(); expect(host.querySelector('[data-pdf-page="1"]')).toBeNull();
    expect(pageProbe.removed).toHaveBeenCalledWith(1); expect(host.querySelectorAll(".textLayer[data-pdf-page]").length).toBeLessThanOrEqual(5);
  });
  it("同hash恢复页码缩放旋转并持久化在版本自己的key", async () => {
    localStorage.setItem("judu:pdf-position:edition", JSON.stringify({ hash: "a".repeat(64), page: 3, zoom: 150, rotation: 90 }));
    await render(); expect(currentPage()).toBe(3); expect(host.querySelector<HTMLSelectElement>('[aria-label="PDF缩放"]')?.value).toBe("150");
    expect(pageProbe.latest.get(3)?.rotation).toBe(90); expect(stored()).toMatchObject({ hash: "a".repeat(64), page: 3, zoom: 150, rotation: 90 });
    await act(async () => button("上一页").click()); expect(stored()?.page).toBe(2);
  });
  it("hash不同不沿用旧页码、缩放和旋转", async () => {
    localStorage.setItem("judu:pdf-position:edition", JSON.stringify({ hash: "b".repeat(64), page: 3, zoom: 200, rotation: 270 }));
    await render(); expect(currentPage()).toBe(1); expect(stored()).toMatchObject({ hash: "a".repeat(64), zoom: 100, rotation: 0 });
  });
  it("损坏的存储可恢复并给明确提示", async () => {
    localStorage.setItem("judu:pdf-position:edition", "{broken"); await render(); expect(currentPage()).toBe(1);
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringContaining("位置无法恢复")); expect(console.warn).toHaveBeenCalled();
  });
  it("无效存储字段不产生不存在页面或非正交旋转", async () => {
    localStorage.setItem("judu:pdf-position:edition", JSON.stringify({ hash: "a".repeat(64), page: 999, zoom: 500, rotation: 45 }));
    await render(); expect(stored()).toMatchObject({ page: 1, zoom: 100, rotation: 0 });
  });
  it("存储写入失败仍可阅读且报告错误", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); }); await render();
    expect(currentPage()).toBe(1); expect(props.onNotice).toHaveBeenCalledWith(expect.stringContaining("位置保存失败"));
  });
  it("缩放旋转传入实际页面，不重开PDF文件", async () => {
    await render(); const previous = pageProbe.latest.get(1)!.scale;
    await change('[aria-label="PDF缩放"]', "150"); await act(async () => button("旋转").click());
    expect(pageProbe.latest.get(1)?.rotation).toBe(90); expect(pageProbe.latest.get(1)!.scale).not.toBe(previous);
    expect(loader.openPdf).toHaveBeenCalledOnce(); expect(stored()).toMatchObject({ zoom: 150, rotation: 90 });
  });
  it("滚动更新页索引、来源位置和持久化", async () => {
    await render(); await act(async () => { viewport().scrollTop = 800; viewport().dispatchEvent(new Event("scroll")); });
    expect(currentPage()).toBe(2); expect(props.onPosition).toHaveBeenCalledWith({ paragraphId: "p2", offset: 0 }); expect(stored()?.page).toBe(2);
  });
  it("来源回跳到远处页面，用户翻页不会被相同anchor拉回", async () => {
    h = fixture(40); await render({ book: h.book, anchor: { paragraphId: "p30", offset: 3 } });
    expect(currentPage()).toBe(30); expect(host.querySelector('[data-pdf-page="30"]')).not.toBeNull();
    await act(async () => button("下一页").click()); expect(currentPage()).toBe(31);
    await render({ anchor: { paragraphId: "p30", offset: 3 } }); expect(currentPage()).toBe(31);
    await render({ anchor: { paragraphId: "p2", offset: 1 } }); expect(currentPage()).toBe(2);
  });
  it("无匹配来源不猜首个相似段落", async () => {
    await render(); await act(async () => button("下一页").click());
    await render({ anchor: { paragraphId: "not-in-this-edition", offset: 0 } }); expect(currentPage()).toBe(2);
  });
  it("原书目录通过受控linkService跳页，绝不自动访问外网", async () => {
    h.documentProxy.getOutline.mockResolvedValue([{ title: "第二页", dest: [1, { name: "Fit" }], items: [] }]);
    await render(); await change('[aria-label="PDF目录"]', "0"); expect(currentPage()).toBe(2); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("PdfReader 原生选文1000上限及高亮", () => {
  it.each([999, 1000, 1001])("选择%d字，原生选区和回调均不超过1000", async length => {
    h = fixture(1, () => "甲".repeat(length)); await render({ book: h.book }); await select(textNode(), 0, textNode(), length);
    const snapshot = vi.mocked(props.onSelect).mock.calls.at(-1)![0];
    expect(Array.from(snapshot.text)).toHaveLength(Math.min(length, 1000)); expect(document.getSelection()!.toString()).toBe(snapshot.text);
    expect(snapshot.endOffset).toBe(Math.min(length, 1000));
    if (length > 1000) expect(props.onNotice).toHaveBeenCalledWith(expect.stringContaining("1000"));
    else expect(props.onNotice).not.toHaveBeenCalled();
  });
  it("反向1001字从拖选起点保留1000字，UTF16不截断emoji", async () => {
    h = fixture(1, () => "首" + "😀".repeat(1000)); await render({ book: h.book }); await select(textNode(), 0, textNode(), 2001, true);
    const snapshot = vi.mocked(props.onSelect).mock.calls.at(-1)![0];
    expect(snapshot).toMatchObject({ startOffset: 1, endOffset: 2001, text: "😀".repeat(1000) });
    expect(document.getSelection()!.anchorOffset).toBe(2001); expect(document.getSelection()!.focusOffset).toBe(1);
  });
  it("跨页选区保留多片段有序来源，mouseup/keyup不重复提交", async () => {
    await render(); await select(textNode(1), 2, textNode(2), 12);
    const snapshot = vi.mocked(props.onSelect).mock.calls[0][0]; expect(snapshot.version).toBe(2);
    expect(snapshot.fragments?.map(part => part.paragraphId)).toEqual(["p1", "p2"]);
    await act(async () => { viewport().dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); viewport().dispatchEvent(new KeyboardEvent("keyup", { bubbles: true })); });
    expect(props.onSelect).toHaveBeenCalledOnce(); expect(highlights.get("judu-pdf-selection")?.ranges).toHaveLength(2);
  });
  it("正文内键盘折叠选区应清除旧快照，与精读交互一致", async () => {
    await render(); await select(textNode(), 0, textNode(), 12); vi.mocked(props.onClearSelection!).mockClear();
    await act(async () => { document.getSelection()!.collapse(textNode(), 12); document.dispatchEvent(new Event("selectionchange")); viewport().dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true })); });
    expect(props.onClearSelection).toHaveBeenCalled(); expect(highlights.get("judu-pdf-selection")?.ranges ?? []).toHaveLength(0);
  });
  it("无来源新选区清理旧快照，完全外部选区不误伤正文操作", async () => {
    await render(); await select(textNode(), 0, textNode(), 12); const foreign = document.createElement("span"); foreign.textContent = "没有索引的页眉文字"; viewport().append(foreign);
    await select(foreign.firstChild!, 0, foreign.firstChild!, 5); expect(props.onClearSelection).toHaveBeenCalled();
    vi.mocked(props.onClearSelection!).mockClear(); const outside = document.createTextNode("聊天面板中的文字"); host.append(outside);
    await select(outside, 0, outside, 4); expect(props.onClearSelection).not.toHaveBeenCalled();
  });
  it("disabled阻止选文回调，普通pointerdown清理扩选但批注不清理", async () => {
    await render({ disabled: true }); await select(textNode(), 0, textNode(), 12); expect(props.onSelect).not.toHaveBeenCalled();
    await render({ disabled: false }); await act(async () => viewport().dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(props.onStartSelection).toHaveBeenCalledOnce(); const notes = document.createElement("a"); notes.className = "annotationLayer"; viewport().append(notes);
    await act(async () => notes.dispatchEvent(new Event("pointerdown", { bubbles: true }))); expect(props.onStartSelection).toHaveBeenCalledOnce();
  });
  it("来源高亮使用真实Range且不改变原文DOM，缩放后重新绑定", async () => {
    await render({ annotations: [{ id: "a1", paragraphId: "p1", startOffset: 1, endOffset: 8, textHash: "hash", threadId: "t1", summary: "概述", concepts: [], createdAt: "now" }] });
    const layer = host.querySelector('.textLayer[data-pdf-page="1"]')!, original = layer.innerHTML;
    expect(highlights.get("judu-pdf-analysis")?.ranges[0].toString()).toBe(h.book.chapters[0].paragraphs[0].text.slice(1, 8));
    await change('[aria-label="PDF缩放"]', "125"); expect(layer.innerHTML).toBe(original);
    expect(highlights.get("judu-pdf-analysis")?.ranges[0].toString()).toBe(h.book.chapters[0].paragraphs[0].text.slice(1, 8));
  });
});

describe("PdfReader 切版本与迟到任务清理", () => {
  it("切换book销毁旧任务并以新URL读取，不把旧文件用于新版本", async () => {
    await render(); const previous = h; h = fixture(2, page => `新版第${page}页正文`); h.book = { ...h.book, id: "new-book", editionId: "new-edition" };
    await render({ book: h.book }); expect(previous.task.destroy).toHaveBeenCalledOnce();
    expect(loader.openPdf).toHaveBeenLastCalledWith(runtime, "/api/books/new-book/original?editionId=new-edition");
    expect(host.textContent).toContain("新版第1页正文"); expect(host.textContent).not.toContain("第1页可供句读");
  });
  it("切版本后不沿用上一本的缩放旋转状态", async () => {
    await render(); await change('[aria-label="PDF缩放"]', "200"); await act(async () => button("旋转").click());
    h = fixture(); h.book = { ...h.book, editionId: "new-edition", edition: { ...h.book.edition!, id: "new-edition", originalHash: "b".repeat(64) } };
    await render({ book: h.book }); expect(stored()).toMatchObject({ hash: "b".repeat(64), page: 1, zoom: 100, rotation: 0 });
  });
  it("切版本清理父级旧选区快照", async () => {
    await render(); await select(textNode(), 0, textNode(), 12); vi.mocked(props.onClearSelection!).mockClear();
    h = fixture(); h.book = { ...h.book, editionId: "another-edition" }; await render({ book: h.book });
    expect(props.onClearSelection).toHaveBeenCalled();
  });
  it("卸载中止页索引并销毁loadingTask/高亮，迟到结果不得挂载", async () => {
    const gate = deferred<PdfTextPage[]>(); loader.indexPdfPages.mockReturnValue(gate.promise); await render();
    const signal = loader.indexPdfPages.mock.calls[0][1] as AbortSignal; await unmount();
    expect(signal.aborted).toBe(true); expect(h.task.destroy).toHaveBeenCalledOnce();
    await act(async () => gate.resolve(h.pages)); expect(host.childNodes).toHaveLength(0); expect(highlights.size).toBe(0); expect(props.onSelect).not.toHaveBeenCalled();
  });
  it("未加载完runtime就卸载，不继续获取PDF", async () => {
    const gate = deferred<PdfRuntime>(); loader.loadPdfRuntime.mockReturnValue(gate.promise); await render(); await unmount();
    await act(async () => gate.resolve(runtime)); expect(loader.openPdf).not.toHaveBeenCalled();
  });
  it("旧book索引迟到不能覆盖新book或保留旧页", async () => {
    const old = h, gate = deferred<PdfTextPage[]>(); loader.indexPdfPages.mockReturnValueOnce(gate.promise); await render();
    h = fixture(2, page => `切换后的第${page}页`); h.book = { ...h.book, editionId: "new" }; await render({ book: h.book });
    await act(async () => gate.resolve(old.pages)); expect(host.textContent).toContain("切换后的第1页"); expect(host.textContent).not.toContain("第1页可供句读");
    expect(old.task.destroy).toHaveBeenCalledOnce();
  });
  it("卸载移除选文监听，不向旧回调发布变化", async () => {
    await render(); const onSelect = props.onSelect; await unmount(); const text = document.createTextNode("宿主页面其它文字"); host.append(text);
    await select(text, 0, text, 6); expect(onSelect).not.toHaveBeenCalled(); expect(highlights.size).toBe(0);
  });
  it("销毁任务失败显式记录，不能产生未处理拒绝", async () => {
    h.task.destroy.mockRejectedValue(new Error("controlled cleanup failure")); await render(); await unmount();
    expect(console.warn).toHaveBeenCalledWith("释放PDF资源失败", expect.any(Error));
  });
});


describe("PdfReader 末页导航与滚动钳制", () => {
  it("目录第2页在150%旋转90度缩短后，钳制scroll不能回第1页且刷新仍保留", async () => {
    h = fixture(2); h.documentProxy.getOutline.mockResolvedValue([{ title: "第二章", dest: [1, { name: "Fit" }], items: [] }]);
    await render({ book: h.book }); const max = clampViewport(750);
    await change('[aria-label="PDF目录"]', "0"); await act(async () => viewport().dispatchEvent(new Event("scroll"))); expect(currentPage()).toBe(2);
    await change('[aria-label="PDF缩放"]', "150"); await act(async () => viewport().dispatchEvent(new Event("scroll"))); expect(currentPage()).toBe(2);
    await act(async () => button("旋转").click()); expect(currentPage()).toBe(2); expect(viewport().scrollTop).toBe(max());
    await act(async () => viewport().dispatchEvent(new Event("scroll")));
    expect(currentPage()).toBe(2); expect(button("上一页").disabled).toBe(false); expect(stored()).toMatchObject({ page: 2, zoom: 150, rotation: 90 });
    await unmount(); root = createRoot(host); mounted = true; await render(); clampViewport(750);
    await act(async () => viewport().dispatchEvent(new Event("scroll"))); expect(currentPage()).toBe(2); expect(stored()?.page).toBe(2);
  });
  it.each([900, 1800].flatMap(height => ["下一页", "目录", "锚点"].map(via => ({ height, via }))))("窗口高$height时$via到末页，钳制scroll事件不改回第1页", async ({ height, via }) => {
    h = fixture(2); h.documentProxy.getOutline.mockResolvedValue([{ title: "第二章", dest: [{ num: 42, gen: 0 }, { name: "Fit" }], items: [] }]);
    await render({ book: h.book, anchor: { paragraphId: "p1", offset: 0 } }); const max = clampViewport(height);
    if (via === "下一页") await act(async () => button("下一页").click());
    else if (via === "目录") { await change('[aria-label="PDF目录"]', "0"); expect(h.documentProxy.getPageIndex).toHaveBeenCalledWith({ num: 42, gen: 0 }); }
    else await render({ anchor: { paragraphId: "p2", offset: 1 } });
    expect(currentPage()).toBe(2); expect(viewport().scrollTop).toBe(max());
    expect(viewport().scrollTop).toBeLessThan(parseFloat(host.querySelector<HTMLElement>('.pdf-page-slot[data-pdf-page="2"]')!.style.top));
    await act(async () => { viewport().dispatchEvent(new Event("scroll")); viewport().dispatchEvent(new Event("scroll")); });
    expect(currentPage()).toBe(2); expect(stored()?.page).toBe(2);
    expect(props.onPosition).toHaveBeenLastCalledWith({ paragraphId: "p2", offset: 0 }); expect(host.querySelector('[role="alert"]')).toBeNull();
    await act(async () => button("上一页").click()); await act(async () => viewport().dispatchEvent(new Event("scroll")));
    expect(currentPage()).toBe(1); expect(stored()?.page).toBe(1);
  });
  it("手动滚离末页后不粘住导航目标，滚到底部重新认出末页", async () => {
    h = fixture(2); await render({ book: h.book }); const max = clampViewport(900);
    await act(async () => button("下一页").click()); await act(async () => viewport().dispatchEvent(new Event("scroll")));
    await act(async () => { viewport().scrollTop = max() / 2; viewport().dispatchEvent(new Event("scroll")); }); expect(currentPage()).toBe(1);
    await act(async () => { viewport().scrollTop = max(); viewport().dispatchEvent(new Event("scroll")); }); expect(currentPage()).toBe(2);
    expect(stored()?.page).toBe(2);
  });
});

describe("PdfReader 非空精读锚点与原版页恢复", () => {
  const save = (value: Record<string, unknown>, edition = "edition") => localStorage.setItem(
    `judu:pdf-position:${edition}`, JSON.stringify({ version: 1, hash: "a".repeat(64), page: 2, zoom: 150, rotation: 90, ...value }),
  );

  it("第1页非空锚点下缩放旋转再翻至第2页，刷新仍恢复第2页", async () => {
    await render({ anchor: { paragraphId: "p1", offset: 0 } });
    await change('[aria-label="PDF缩放"]', "150");
    await act(async () => button("旋转").click());
    await act(async () => button("下一页").click());
    expect(currentPage()).toBe(2); expect(stored()).toMatchObject({ page: 2, zoom: 150, rotation: 90 });
    // WHY：重新挂载模拟刷新，保留localStorage及宿主旧锚点，不用scroll事件替产品同步位置。
    await unmount(); root = createRoot(host); mounted = true;
    await render();
    expect(currentPage()).toBe(2);
    expect(host.querySelector<HTMLSelectElement>('[aria-label="PDF缩放"]')?.value).toBe("150");
    expect(pageProbe.latest.get(2)?.rotation).toBe(90);
    expect(stored()).toMatchObject({ page: 2, zoom: 150, rotation: 90 });
    await unmount(); root = createRoot(host); mounted = true;
    await render({ anchor: { paragraphId: "p4", offset: 2 } });
    expect(currentPage()).toBe(4); expect(stored()).toMatchObject({ page: 4, zoom: 150, rotation: 90 });
  });

  it("同hash旧位置记录没有anchor字段也不会被初始非空锚点覆盖", async () => {
    save({}); await render({ anchor: { paragraphId: "p1", offset: 0 } });
    expect(currentPage()).toBe(2); expect(viewport().scrollTop).toBeGreaterThan(0);
    await render({ anchor: { paragraphId: "p1", offset: 0 } });
    await change('[aria-label="PDF缩放"]', "200");
    expect(currentPage()).toBe(2); expect(stored()).toMatchObject({ page: 2, zoom: 200, rotation: 90 });
  });

  it("恢复后主动换anchor仍导航，原版翻页后的同值重渲染不拉回", async () => {
    save({}); await render({ anchor: { paragraphId: "p1", offset: 0 } });
    expect(currentPage()).toBe(2);
    await render({ anchor: { paragraphId: "p4", offset: 3 } }); expect(currentPage()).toBe(4);
    await act(async () => button("上一页").click());
    await render({ anchor: { paragraphId: "p4", offset: 3 } }); expect(currentPage()).toBe(3);
    await render({ anchor: { paragraphId: "p1", offset: 1 } }); expect(currentPage()).toBe(1);
    expect(stored()?.page).toBe(1); expect(loader.openPdf).toHaveBeenCalledOnce();
  });

  it("加载期间主动换anchor优先于保存页，不把新请求当作初始旧锚点", async () => {
    save({}); const gate = deferred<PdfTextPage[]>(); loader.indexPdfPages.mockReturnValueOnce(gate.promise);
    await render({ anchor: { paragraphId: "p1", offset: 0 } });
    await render({ anchor: { paragraphId: "p3", offset: 2 } });
    await act(async () => gate.resolve(h.pages));
    expect(currentPage()).toBe(3); expect(stored()?.page).toBe(3); expect(loader.openPdf).toHaveBeenCalledOnce();
  });

  it("新会话显式anchor不同于保存时锚点，不能无条件使用保存页", async () => {
    save({ anchor: { paragraphId: "p1", offset: 0 } });
    await render({ anchor: { paragraphId: "p4", offset: 2 } });
    expect(currentPage()).toBe(4); expect(stored()).toMatchObject({ page: 4, zoom: 150, rotation: 90 });
  });

  it.each([
    { hash: "b".repeat(64), page: 2 },
    { hash: "a".repeat(64), page: 999 },
    { hash: "a".repeat(64), page: null },
  ])("无可恢复页时仍定位非空anchor：%j", async value => {
    save(value); await render({ anchor: { paragraphId: "p3", offset: 2 } });
    expect(currentPage()).toBe(3); expect(stored()?.hash).toBe("a".repeat(64));
    if (value.hash !== "a".repeat(64)) expect(stored()).toMatchObject({ zoom: 100, rotation: 0 });
  });

  it("A索引迟到不能覆盖B的保存页或消费B的新锚点请求", async () => {
    save({}); save({ hash: "b".repeat(64), page: 3 }, "edition-b");
    const first = h, gate = deferred<PdfTextPage[]>(); loader.indexPdfPages.mockReturnValueOnce(gate.promise);
    await render({ anchor: { paragraphId: "p1", offset: 0 } });
    h = fixture(); h.book = { ...h.book, id: "book-b", editionId: "edition-b", edition: { ...h.book.edition!, id: "edition-b", originalHash: "b".repeat(64) } };
    await render({ book: h.book, anchor: { paragraphId: "p1", offset: 0 } }); expect(currentPage()).toBe(3);
    await act(async () => gate.resolve(first.pages));
    expect(currentPage()).toBe(3); expect(stored()).toMatchObject({ hash: "b".repeat(64), page: 3 });
    await render({ anchor: { paragraphId: "p4", offset: 2 } }); expect(currentPage()).toBe(4);
    expect(first.task.destroy).toHaveBeenCalledOnce();
  });

  it("切书各自恢复有效保存页，不因相同段落ID的非空初始anchor串书", async () => {
    const first = h; save({});
    save({ hash: "b".repeat(64), page: 4, zoom: 75, rotation: 180 }, "edition-b");
    await render({ anchor: { paragraphId: "p1", offset: 0 } }); expect(currentPage()).toBe(2);
    h = fixture(); h.book = { ...h.book, id: "book-b", editionId: "edition-b", edition: { ...h.book.edition!, id: "edition-b", originalHash: "b".repeat(64) } };
    const second = h;
    await render({ book: h.book, anchor: { paragraphId: "p1", offset: 0 } });
    expect(currentPage()).toBe(4); expect(stored()).toMatchObject({ hash: "b".repeat(64), page: 4, zoom: 75, rotation: 180 });
    await render({ anchor: { paragraphId: "p2", offset: 2 } }); expect(currentPage()).toBe(2);
    h = first; await render({ book: h.book, anchor: { paragraphId: "p1", offset: 0 } });
    expect(currentPage()).toBe(2); expect(stored()).toMatchObject({ hash: "a".repeat(64), page: 2, zoom: 150, rotation: 90 });
    expect(first.task.destroy).toHaveBeenCalledOnce(); expect(second.task.destroy).toHaveBeenCalledOnce();
  });
});


describe("PdfReader 版本持久化竞态补充", () => {
  it("从A切到已有位置的B，不以A状态覆盖B的hash绑定存储", async () => {
    await render(); await act(async () => button("下一页").click()); await change('[aria-label="PDF缩放"]', "200");
    localStorage.setItem("judu:pdf-position:edition-b", JSON.stringify({ hash: "b".repeat(64), page: 4, zoom: 75, rotation: 180 }));
    h = fixture(); h.book = { ...h.book, id: "book-b", editionId: "edition-b", edition: { ...h.book.edition!, id: "edition-b", originalHash: "b".repeat(64) } };
    await render({ book: h.book });
    expect(currentPage()).toBe(4); expect(stored()).toMatchObject({ hash: "b".repeat(64), page: 4, zoom: 75, rotation: 180 });
  });
  it("同edition换hash不得把旧位置改贴新hash后再次恢复", async () => {
    await render(); await act(async () => button("下一页").click()); await change('[aria-label="PDF缩放"]', "200");
    h = fixture(); h.book = { ...h.book, edition: { ...h.book.edition!, originalHash: "c".repeat(64) } };
    await render({ book: h.book }); expect(currentPage()).toBe(1);
    expect(stored()).toMatchObject({ hash: "c".repeat(64), page: 1, zoom: 100, rotation: 0 });
  });
  it("工具栏导致的普通折叠不能误清已经确认的选文快照", async () => {
    await render(); await select(textNode(), 0, textNode(), 12); vi.mocked(props.onClearSelection!).mockClear();
    await act(async () => { document.getSelection()!.removeAllRanges(); document.dispatchEvent(new Event("selectionchange")); });
    expect(props.onClearSelection).not.toHaveBeenCalled(); expect(highlights.get("judu-pdf-selection")?.ranges).toHaveLength(1);
  });
  it.each([false, true])("跨页1003字原生选区与请求整体限1000，不自动分段（反向=%s）", async reverse => {
    h = fixture(2, page => page === 1 ? "甲".repeat(500) : "乙".repeat(501)); await render({ book: h.book });
    await select(textNode(1), 0, textNode(2), 501, reverse); expect(props.onSelect).toHaveBeenCalledOnce();
    const snapshot = vi.mocked(props.onSelect).mock.calls[0][0]; expect(Array.from(snapshot.text)).toHaveLength(1000);
    expect(snapshot.fragments).toHaveLength(2); expect(document.getSelection()!.toString().replace(/\s/gu, "")).toBe(snapshot.text.replace(/\s/gu, ""));
    expect(snapshot.fragments![0].startOffset).toBe(reverse ? 3 : 0);
    expect(snapshot.fragments![1].endOffset).toBe(reverse ? 501 : 498);
  });
});


it("五种手动颜色、AI下划线、概念和当前选区独立注册，绿色标亮不混入AI", async () => {
  const colors = ["yellow", "green", "blue", "pink", "orange"] as const;
  const text = h.book.chapters[0].paragraphs[0].text;
  const base = { paragraphId: "p1", textHash: "hash", threadId: "manual-mark", summary: "手动标亮", concepts: [], createdAt: "2026-09-18T00:00:00Z" };
  await render({ annotations: [
    ...colors.map((markColor, index) => ({ ...base, id: markColor, kind: "highlight" as const, markColor, startOffset: index * 2, endOffset: index * 2 + 2 })),
    { ...base, id: "analysis", kind: "analysis", threadId: "real-thread", messageId: "real-message", startOffset: 10, endOffset: 12 },
  ], concepts: [{ name: text.slice(0, 3), text: "独立概念定义" }] });
  for (const [index, color] of colors.entries()) expect(highlights.get("judu-pdf-" + color)?.ranges.map(range => range.toString())).toEqual([text.slice(index * 2, index * 2 + 2)]);
  expect(highlights.get("judu-pdf-analysis")?.ranges.map(range => range.toString())).toEqual([text.slice(10, 12)]);
  expect(highlights.get("judu-pdf-concept")?.ranges.map(range => range.toString())).toContain(text.slice(0, 3));
  await select(textNode(), 0, textNode(), 12);
  expect(highlights.get("judu-pdf-selection")?.ranges.map(range => range.toString())).toEqual([text.slice(0, 12)]);
  expect(highlights.get("judu-pdf-green")?.ranges.map(range => range.toString())).toEqual([text.slice(2, 4)]);
  expect(highlights.get("judu-pdf-analysis")?.ranges.map(range => range.toString())).toEqual([text.slice(10, 12)]);
  await unmount(); expect(highlights.size).toBe(0);
});

it("250%缩放时滚动内容至少为纸张宽加32px，左右留白均可达", async () => {
  await render(); await change('[aria-label="PDF缩放"]', "250");
  const scrollSpace = host.querySelector<HTMLElement>(".pdf-scroll-space")!;
  const paperWidths = [...host.querySelectorAll<HTMLElement>(".pdf-page-slot")].map(paper => parseFloat(paper.style.width));
  // WHY：只校验组件输出的滚动布局宽度契约；jsdom不验证实际水平滚动或屏幕几何。
  expect(paperWidths.length).toBeGreaterThan(0); expect(paperWidths.every(Number.isFinite)).toBe(true);
  const contentWidth = parseFloat(scrollSpace.style.width);
  expect(scrollSpace.style.width).toMatch(/px$/u); expect(contentWidth).toBeGreaterThanOrEqual(Math.max(...paperWidths) + 32);
  expect(contentWidth).toBeGreaterThanOrEqual(viewport().clientWidth || 600);
  expect(loader.openPdf).toHaveBeenCalledOnce();
});
