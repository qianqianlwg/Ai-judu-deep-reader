// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { bindPdfTextLayer, mapPdfDocument, type PdfTextPage } from "@/lib/pdf-source-map";
import type { LibraryBookContent } from "@/lib/library";
import type { TextAnnotation } from "@/lib/annotations";
import { PdfInteractionLayer } from "./pdf-interaction-layer";

type Props = ComponentProps<typeof PdfInteractionLayer>;
const firstText = "理解财政体制，才能理解地方发展。", secondText = "第二页展示财政体制以及地方工作。";
const box = (x: number, y: number, w: number, h: number) => new DOMRect(x, y, w, h);
const analysis = (extra: Partial<TextAnnotation> = {}): TextAnnotation => ({ id: "a1", paragraphId: "p1", startOffset: 0, endOffset: 6, textHash: "h", threadId: "t1", messageId: "m1", kind: "analysis", summary: "第一次句读完整概述", concepts: ["财政体制"], createdAt: "2026-09-18T01:00:00Z", ...extra });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let props: Props, host: HTMLDivElement, mount: HTMLDivElement, layers: HTMLDivElement[], texts: HTMLSpanElement[], external: HTMLTextAreaElement, root: Root, mounted: boolean;
let frames: Map<number, FrameRequestCallback>, frameId: number;
let pdf: { numPages: number; getDestination: ReturnType<typeof vi.fn<(name: string) => Promise<unknown>>>; getPageIndex: ReturnType<typeof vi.fn<() => Promise<number>>> };
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
async function render(next: Partial<Props> = {}) { props = { ...props, ...next }; await act(async () => root.render(<PdfInteractionLayer {...props} />)); }
async function unmount() { if (mounted) { await act(async () => root.unmount()); mounted = false; } }
async function mouse(target: EventTarget, type: string, x = 55, y = 50) { const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }); await act(async () => target.dispatchEvent(event)); return event; }
async function click(target: HTMLElement) { await act(async () => target.click()); }
async function key(target: EventTarget, value: string, shiftKey = false) { const event = new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true }); await act(async () => target.dispatchEvent(event)); return event; }
async function flushFrames() { await act(async () => { const jobs = [...frames.values()]; frames.clear(); jobs.forEach(job => job(0)); }); }
function link(page = 1, dest: unknown = [1, { name: "Fit" }]) {
  const anchor = document.createElement("a"); anchor.href = "#judu-dest=" + encodeURIComponent(JSON.stringify(dest)); anchor.textContent = "原书引用"; anchor.dataset.testReference = String(page);
  const annotationLayer = document.createElement("div"); annotationLayer.className = "annotationLayer"; annotationLayer.append(anchor); layers[page - 1].append(annotationLayer); return anchor;
}
function makePage(number: number, value: string): PdfTextPage { return { pageNumber: number, width: 600, height: 800, rotation: 0, mapped: false, runs: [], items: [{ str: value, transform: [1, 0, 0, 1, 0, 0], width: 300, height: 14 }] }; }
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); frames = new Map(); frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (job: FrameRequestCallback) => { const id = ++frameId; frames.set(id, job); return id; }); vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("本测试禁止读取网络/AI/真实书库"); })); vi.spyOn(window, "open").mockReturnValue(null); vi.spyOn(console, "warn").mockImplementation(() => {});
  host = document.createElement("div"); host.dataset.readingPane = ""; document.body.append(host);
  layers = [1, 2].map(number => { const layer = document.createElement("div"); layer.className = "pdf-page-layers"; layer.dataset.testPage = String(number); host.append(layer); return layer; });
  texts = [firstText, secondText].map((value, index) => { const container = document.createElement("div"); container.className = "textLayer"; const span = document.createElement("span"); span.textContent = value; container.append(span); layers[index].append(container); return span; });
  external = document.createElement("textarea"); external.setAttribute("aria-label", "聊天区"); host.append(external); mount = document.createElement("div"); host.append(mount); root = createRoot(mount); mounted = true;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this === host) return box(0, 0, 700, 600);
    if (this.classList.contains("judu-annotation-popover")) return box(300, 100, 240, 200);
    if (this.dataset.testReference) return box(220, this.dataset.testReference === "1" ? 40 : 260, 25, 20);
    if (this.dataset.testPage) return box(0, this.dataset.testPage === "1" ? 20 : 240, 600, 200);
    return box(parseFloat(this.style.left) || 0, parseFloat(this.style.top) || 0, parseFloat(this.style.width) || 16, parseFloat(this.style.height) || 16);
  });
  // WHY：保留真实source-map、适配器和AnnotationPopover，仅补jsdom缺失的Range排版几何。
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: function (this: Range) {
    const element = this.startContainer instanceof Element ? this.startContainer : this.startContainer.parentElement;
    const page = element?.closest<HTMLElement>("[data-test-page]")?.dataset.testPage;
    const values = page ? [box(20 + this.startOffset * 10, page === "1" ? 40 : 260, Math.max(10, (this.endOffset - this.startOffset) * 10), 20)] : [];
    return Object.assign(values, { item: (i: number) => values[i] ?? null });
  } });
  const book: LibraryBookContent = { id: "book", title: "合成PDF", author: "本地测试", editionId: "a", chapters: [firstText, secondText].map((text, i) => ({ id: `c${i + 1}`, title: "页", sourceHref: `pdf:page:${i + 1}`, paragraphs: [{ id: `p${i + 1}`, text }] })) };
  const index = mapPdfDocument([makePage(1, firstText), makePage(2, secondText)], book);
  const pages = index.pages.map((page, i) => bindPdfTextLayer(page, texts[i].parentElement!, [texts[i]], [texts[i].textContent!]));
  pdf = { numPages: 2, getDestination: vi.fn<(name: string) => Promise<unknown>>(async () => [1, { name: "Fit" }]), getPageIndex: vi.fn(async () => 1) };
  props = { host: { current: host }, book, document: pdf as unknown as PDFDocumentProxy, index, pages, annotations: [], concepts: [{ name: "财政体制", text: "中央与地方之间财政关系的制度安排" }], onOpenAnnotation: vi.fn(), onNotice: vi.fn(), onJump: vi.fn() };
});
afterEach(async () => { await unmount(); host.remove(); document.getSelection()?.removeAllRanges(); Reflect.deleteProperty(Range.prototype, "getClientRects"); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("PDF真实适配到共享浮层", () => {
  it("文字层概念hover显示逐词定义，使用真实共用portal而非Foliate假对象", async () => {
    await render(); await mouse(texts[0], "mousemove"); expect(dialog()?.classList.contains("judu-annotation-popover")).toBe(true);
    expect(dialog()?.textContent).toContain("中央与地方之间财政关系"); expect(dialog()?.parentElement).toBe(document.body);
    expect(host.querySelectorAll('[aria-label="查看概念：财政体制"]')).toHaveLength(2);
    expect(pdf.getDestination).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("全程不向PDF正文插入节点或改写已存在Range", async () => {
    const html = layers.map(layer => layer.innerHTML), node = texts[0].firstChild!, range = document.createRange(); range.setStart(node, 2); range.setEnd(node, 6);
    await render({ annotations: [analysis()] }); await mouse(texts[0], "mousemove"); await click(button("关闭浮层"));
    await click(button("查看句读历史（1条）")); expect(layers.map(layer => layer.innerHTML)).toEqual(html); expect(texts[0].firstChild).toBe(node); expect(range.toString()).toBe("财政体制");
  });
  it("同一结束点多次句读只有一个标识，历史按新到旧且准确回调", async () => {
    const newer = analysis({ id: "a2", messageId: "m2", summary: "新句读概述", createdAt: "2026-09-18T02:00:00Z" });
    await render({ annotations: [analysis(), newer] }); expect(host.querySelectorAll(".epub-history-marker")).toHaveLength(1);
    await click(button("查看句读历史（2条）")); const items = dialog()!.querySelectorAll("li"); expect(items[0].textContent).toContain("新句读概述");
    expect(items[1].textContent).toContain("第一次句读完整概述"); await click(items[0].querySelector("button")!); expect(props.onOpenAnnotation).toHaveBeenCalledExactlyOnceWith(newer);
  });
  it("真实鼠标点击完整句读入口不能在pointerdown被关闭吞掉", async () => {
    await render({ annotations: [analysis()] }); await click(button("查看句读历史（1条）")); const open = button("查看完整句读");
    await mouse(open, "pointerdown", 350, 220); await mouse(open, "mouseup", 350, 220); await mouse(open, "click", 350, 220);
    expect(props.onOpenAnnotation).toHaveBeenCalledExactlyOnceWith(analysis());
  });
  it.each(["note", "favorite"] as const)("手动%s不进入AI会话、不产生句读历史图标", async kind => {
    await render({ concepts: [], annotations: [analysis({ kind, threadId: "manual-mark", summary: "我的手动文字" })] }); await mouse(texts[0], "mousemove");
    expect(dialog()?.textContent).toContain("我的手动文字"); expect(host.querySelector(".epub-history-marker")).toBeNull();
    expect(dialog()?.textContent).not.toContain("查看完整句读"); expect(props.onOpenAnnotation).not.toHaveBeenCalled();
  });
  it("缺定义时不使用句读摘要冒充", async () => {
    await render({ concepts: [{ name: "财政体制", text: "" }], annotations: [analysis()] }); await mouse(texts[0], "mousemove");
    expect(dialog()?.textContent).toContain("暂无定义"); expect(dialog()?.textContent).not.toContain("第一次句读完整概述");
  });
  it("同host Document的浮窗不因resize要求iframe而消失", async () => {
    await render(); await mouse(texts[0], "mousemove"); await act(async () => window.dispatchEvent(new Event("resize"))); await flushFrames(); expect(dialog()).not.toBeNull();
  });
  it("流式定义更新保留浮窗并显示新定义", async () => {
    await render(); await mouse(texts[0], "mousemove"); await render({ concepts: [{ name: "财政体制", text: "更新后的真实定义" }] });
    expect(dialog()?.textContent).toContain("更新后的真实定义");
  });
  it("历史更新仍指向新的messageId而不是过时闭包", async () => {
    await render({ annotations: [analysis()] }); await click(button("查看句读历史（1条）"));
    const updated = analysis({ messageId: "m-updated", summary: "刷新后的完整概述" }); await render({ annotations: [updated] });
    expect(dialog()?.textContent).toContain("刷新后的完整概述"); await click(button("查看完整句读")); expect(props.onOpenAnnotation).toHaveBeenCalledExactlyOnceWith(updated);
  });
});

describe("PDF引用显式跳转、scope与键盘", () => {
  it("真实索引页概览明确非精确脚注，不自动跳页或访问外部", async () => {
    const reference = link(); const nativeJump = vi.fn(); reference.addEventListener("click", nativeJump);
    await render(); await mouse(reference, "mouseover", 230, 50); expect(dialog()?.textContent).toContain("第 2 页文字概览（非精确脚注定位）");
    expect(dialog()?.textContent).toContain(secondText); expect(props.onJump).not.toHaveBeenCalled();
    const event = await mouse(reference, "click", 230, 50); expect(event.defaultPrevented).toBe(true); expect(nativeJump).not.toHaveBeenCalled();
    await click(button("跳转到原文")); expect(props.onJump).toHaveBeenCalledExactlyOnceWith(2); expect(fetch).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
  });
  it("共享卡片中真实点击引用跳转按钮可以完成", async () => {
    const reference = link(); await render(); await mouse(reference, "mouseover", 230, 50); const jump = button("跳转到原文");
    await mouse(jump, "pointerdown", 350, 240); await mouse(jump, "mouseup", 350, 240); await mouse(jump, "click", 350, 240);
    expect(props.onJump).toHaveBeenCalledExactlyOnceWith(2);
  });
  it("外部地址只作为文字显示，不产生网络访问或执行HTML", async () => {
    const reference = link(); reference.href = "#"; reference.dataset.pdfExternalUrl = 'https://invalid.example/<img src=x onerror=alert(1)>';
    await render(); await mouse(reference, "mouseover", 230, 50); expect(dialog()?.textContent).toContain("外部链接不自动访问");
    expect(dialog()?.textContent).toContain(reference.dataset.pdfExternalUrl); expect(dialog()?.querySelector("img,iframe,script")).toBeNull();
    expect(button("跳转到原文")).toBeUndefined(); expect(pdf.getDestination).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("PDF原文外的同Document链接不预览也不拦截", async () => {
    const outer = document.createElement("a"); outer.href = "#other-ui"; outer.dataset.testReference = "1"; host.append(outer);
    await render(); await mouse(outer, "mouseover", 230, 50); const event = await mouse(outer, "click", 230, 50);
    expect(dialog()).toBeNull(); expect(event.defaultPrevented).toBe(false); expect(pdf.getDestination).not.toHaveBeenCalled();
  });
  it("第二页概念只根据第二页坐标命中，不被第一页doc监听吞掉", async () => {
    await render(); await mouse(texts[1], "mousemove", 85, 270); expect(dialog()?.textContent).toContain("中央与地方之间财政关系");
    expect(host.querySelector('[data-epub-target^="pdf:2:"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('[data-epub-target^="pdf:1:"]')?.getAttribute("aria-expanded")).toBe("false");
  });
  it("外部聊天事件即使与正文坐标重叠也不触发概念", async () => {
    await render(); await mouse(external, "mousemove"); await mouse(external, "click"); expect(dialog()).toBeNull();
  });
  it("悬停引用后聊天区ArrowDown不劫持到浮窗", async () => {
    const reference = link(); await render(); await mouse(reference, "mouseover", 230, 50); await act(async () => external.focus());
    const event = await key(external, "ArrowDown"); expect(event.defaultPrevented).toBe(false); expect(document.activeElement).toBe(external);
  });
  it("概念按钮ArrowDown进入、Shift+Tab和Escape回真实触发器", async () => {
    await render(); const trigger = button("查看概念：财政体制"); await act(async () => trigger.focus()); await key(trigger, "ArrowDown");
    expect(document.activeElement).toBe(button("关闭浮层")); await key(document.activeElement!, "Tab", true); expect(document.activeElement).toBe(trigger);
    await key(trigger, "ArrowDown"); await key(document.activeElement!, "Escape"); expect(dialog()).toBeNull(); expect(document.activeElement).toBe(trigger);
  });
  it("原生正文选文不被hover/点击新浮窗扰动", async () => {
    await render(); const range = document.createRange(); range.setStart(texts[0].firstChild!, 0); range.setEnd(texts[0].firstChild!, 6);
    await act(async () => { document.getSelection()!.addRange(range); document.dispatchEvent(new Event("selectionchange")); });
    await mouse(texts[0], "mousemove"); await mouse(texts[0], "click"); expect(dialog()).toBeNull(); expect(document.getSelection()!.toString()).toBe("理解财政体制");
  });
});

describe("PDF版本、虚拟页、缩放和迟到引用", () => {
  it.each(["book", "pages", "disabled", "unmount"] as const)("%s改变后迟到引用不能复活旧窗", async action => {
    const gate = deferred<unknown>(); pdf.getDestination.mockReturnValue(gate.promise); const reference = link(1, "named-note"); await render(); await mouse(reference, "mouseover", 230, 50);
    if (action === "book") await render({ book: { edition: "new" } });
    if (action === "pages") await render({ pages: [] });
    if (action === "disabled") await render({ disabled: true });
    if (action === "unmount") await unmount();
    await act(async () => gate.resolve([1, { name: "Fit" }])); expect(dialog()).toBeNull(); expect(props.onJump).not.toHaveBeenCalled();
  });
  it("缩放后更换文字层DOM及映射，旧引用失效，旧正文不再触发", async () => {
    const gate = deferred<unknown>(); pdf.getDestination.mockReturnValue(gate.promise); const reference = link(1, "named"); await render(); await mouse(reference, "mouseover", 230, 50);
    const replacement = texts[0].parentElement!.cloneNode(true) as HTMLDivElement; layers[0].replaceChild(replacement, texts[0].parentElement!);
    const newText = replacement.querySelector("span")!; const page = bindPdfTextLayer(props.index.pages[0], replacement, [newText], [firstText]);
    await render({ pages: [page, props.pages[1]] }); await act(async () => gate.resolve([1])); expect(dialog()).toBeNull();
    await mouse(texts[0], "mousemove"); expect(dialog()).toBeNull(); await mouse(newText, "mousemove"); expect(dialog()?.textContent).toContain("财政关系");
  });
  it("同版本仅定义变化不取消进行中的真实引用解析", async () => {
    const gate = deferred<unknown>(); pdf.getDestination.mockReturnValue(gate.promise); const reference = link(1, "named"); await render(); await mouse(reference, "mouseover", 230, 50);
    await render({ concepts: [{ name: "财政体制", text: "流式补充定义" }] }); await act(async () => gate.resolve([1]));
    expect(dialog()?.textContent).toContain(secondText); expect(dialog()?.textContent).not.toContain("正在读取");
  });
  it("同书仅替换PDF document代理时，旧代理的未完成引用不能用于新原件", async () => {
    const gate = deferred<unknown>(); pdf.getDestination.mockReturnValue(gate.promise); const reference = link(1, "named"); await render(); await mouse(reference, "mouseover", 230, 50);
    const replacement = { ...pdf, getDestination: vi.fn(async () => [0]) } as unknown as PDFDocumentProxy;
    await render({ document: replacement }); await act(async () => gate.resolve([1])); expect(dialog()).toBeNull();
  });
  it("卸载已预览的虚拟页后不保留可交互的旧触发器", async () => {
    await render(); await mouse(texts[0], "mousemove"); await render({ pages: [props.pages[1]] });
    expect(dialog()).toBeNull(); expect(host.querySelector('[data-epub-target^="pdf:1:"]')).toBeNull();
  });
  it("引用页不可解析时给用户可恢复反馈并记录日志", async () => {
    const reference = link(1, "bad"); pdf.getDestination.mockRejectedValue(new Error("受控坏目标")); await render(); await mouse(reference, "mouseover", 230, 50);
    // WHY：坏PDF目标可能根本不属于当前文件，不能暗示原书目录一定能修复；只提供页码导航提示。
    expect(dialog()?.textContent).toContain("该引用目标无法在当前 PDF 中定位，原文件链接可能已失效；请使用页码导航。");
    expect(dialog()?.textContent).not.toContain("原书目录");
    expect(console.warn).toHaveBeenCalledWith("引用预览失败", expect.objectContaining({ message: "受控坏目标" }));
    expect(button("跳转到原文")).toBeUndefined(); expect(props.onJump).not.toHaveBeenCalled();
  });
  it("缺少完整句读回调时按钮禁用，不能误打开其它会话", async () => {
    await render({ annotations: [analysis()], onOpenAnnotation: undefined }); await click(button("查看句读历史（1条）"));
    expect(button("查看完整句读").disabled).toBe(true);
  });
});


