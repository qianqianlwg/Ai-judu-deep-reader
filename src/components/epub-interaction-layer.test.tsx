// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EpubInteractionLayer } from "./epub-interaction-layer";
import { EpubReader, type EpubReaderProps } from "./epub-reader";
import { DEFAULT_READING_APPEARANCE } from "@/lib/reading-appearance";
import { View } from "../../public/vendor/foliate/view.js";
import { mapEpubDocument } from "@/lib/epub-source-map";
import type { TextAnnotation } from "@/lib/annotations";
import type { FoliateBook, FoliateSection, FoliateView } from "@/lib/foliate-types";

const loader = vi.hoisted(() => ({ loadEpub: vi.fn(), createFoliateView: vi.fn() }));
vi.mock("@/lib/epub-loader", () => loader);
// WHY：jsdom不负责分页排版；只替换renderer，保留真实View的load/click/可取消事件链及EpubReader监听。
vi.mock("../../public/vendor/foliate/paginator.js", () => {
  class LayoutStub extends HTMLElement {
    open = vi.fn(); setStyles = vi.fn(); destroy = vi.fn();
    goTo = vi.fn(async () => {});
    getContents() { return []; }
  }
  customElements.define("foliate-paginator", LayoutStub);
  return {};
});
type Props = ComponentProps<typeof EpubInteractionLayer>;
const text = "理解财政体制，才能理解地方发展。";
const annotation = (overrides: Partial<TextAnnotation> = {}): TextAnnotation => ({ id: "a1", paragraphId: "p", startOffset: 0, endOffset: 6, textHash: "unused", threadId: "t1", messageId: "m1", kind: "analysis", summary: "完整概述而非概念定义", concepts: ["财政体制"], createdAt: "2026-09-18T00:00:00Z", ...overrides });
const box = (left: number, top: number, width: number, height: number) => new DOMRect(left, top, width, height);
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function section(id: string, createDocument: () => Promise<Document>): FoliateSection { return { id, createDocument, load: vi.fn(async () => null), unload: vi.fn() }; }
let root: Root, host: HTMLDivElement, mount: HTMLDivElement, frame: HTMLIFrameElement, doc: Document, view: FoliateView, props: Props;
let frameBox: DOMRect, rangeRects: (range: Range) => DOMRect[], frames: Map<number, FrameRequestCallback>, nextFrame: number;
let extraFrames: HTMLIFrameElement[];
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(item => item.getAttribute("aria-label") === label || item.textContent === label)!;
async function render(next: Partial<Props> = {}) { props = { ...props, ...next }; await act(async () => { root.render(<EpubInteractionLayer {...props} />); }); }
async function flushFrames() { await act(async () => { const jobs = [...frames.values()]; frames.clear(); for (const job of jobs) job(0); }); }
async function event(target: EventTarget, type: string, options: MouseEventInit = {}) { const dispatched = new MouseEvent(type, { bubbles: true, cancelable: true, ...options }); await act(async () => { target.dispatchEvent(dispatched); }); return dispatched; }
async function hover(x = 50, y = 50, target: EventTarget = doc.querySelector("p")!) { await event(target, "mousemove", { clientX: x, clientY: y }); }
async function key(target: EventTarget, value: string) { await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })); }); }
async function click(target: HTMLElement) { await act(async () => target.click()); }
function installRangeGeometry(document: Document) {
  Object.defineProperty(Object.getPrototypeOf(document.createRange()), "getClientRects", { configurable: true, value: function (this: Range) {
    const rectangles = rangeRects(this); return Object.assign(rectangles, { item: (index: number) => rectangles[index] ?? null });
  } });
}
function link(id: string, href: string) {
  const element = doc.createElement("a"); element.id = id; element.href = href; element.textContent = id; element.setAttribute("epub:type", "noteref");
  doc.body.append(element); Object.defineProperty(element, "getBoundingClientRect", { value: () => box(id === "ref2" ? 260 : 160, 90, 30, 20) }); return element;
}
async function hoverLink(element: HTMLElement) { const rect = element.getBoundingClientRect(); await hover(rect.left + 1, rect.top + 1, element); }
function selectBookText() { const range = doc.createRange(); range.selectNodeContents(doc.querySelector("p")!); const selection = doc.defaultView!.getSelection()!; selection.removeAllRanges(); selection.addRange(range); return range; }

beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map(); nextFrame = 0; extraFrames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("验收禁止外部请求"); })); vi.spyOn(window, "open").mockReturnValue(null);
  host = document.createElement("div"); host.dataset.readingPane = ""; document.body.append(host);
  frame = document.createElement("iframe"); host.append(frame); doc = frame.contentDocument!;
  doc.body.innerHTML = `<p>${text}</p><aside id="note">本地脚注正文</aside>`;
  frameBox = box(120, 70, 720, 520);
  Object.defineProperties(frame, { clientWidth: { value: 720 }, clientHeight: { value: 520 }, getBoundingClientRect: { value: () => frameBox } });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this === host) return box(100, 50, 800, 600);
    if (this.classList.contains("judu-annotation-popover")) return box(350, 150, 240, 180);
    return box(100 + (parseFloat(this.style.left) || 0), 50 + (parseFloat(this.style.top) || 0), parseFloat(this.style.width) || 16, parseFloat(this.style.height) || 16);
  });
  rangeRects = range => [range.toString() === "财政体制" ? box(40, 40, 80, 20) : range.toString() === "地方" ? box(220, 40, 40, 20) : range.toString().length === 1 ? box(100, 40, 20, 20) : box(0, 40, 120, 20)];
  installRangeGeometry(doc);
  const raw = document.createElement("div"), renderer = document.createElement("div");
  Object.assign(renderer, { getContents: () => [{ doc, index: 0 }], setStyles: vi.fn(), goTo: vi.fn() });
  Object.assign(raw, { renderer, getCFI: vi.fn(() => "epubcfi(/6/2!/4/2)") }); view = raw as unknown as FoliateView;
  const book: FoliateBook = { sections: [section("OEBPS/ch.xhtml", vi.fn(async () => doc))] };
  props = { host: { current: host }, documents: [{ doc, index: 0, maps: mapEpubDocument(doc, { id: "c", title: "章", paragraphs: [{ id: "p", text }] }) }], view, book, annotations: [], concepts: [{ name: "财政体制", text: "中央与地方之间财政关系的制度安排" }, { name: "地方", text: "地方层级" }], onOpenAnnotation: vi.fn(), onJump: vi.fn(async () => {}), onNotice: vi.fn() };
  mount = document.createElement("div"); host.append(mount); root = createRoot(mount);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); for (const item of extraFrames) item.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("原版概念/历史共用浮窗", () => {
  it("原书悬停使用共用 AnnotationPopover 的 portal 和内容，不修改 DOM 或 CFI", async () => {
    const before = doc.documentElement.outerHTML, paragraph = doc.querySelector("p")!, node = paragraph.firstChild;
    await render(); await hover();
    expect(dialog()?.classList.contains("judu-annotation-popover")).toBe(true);
    expect(dialog()?.parentElement).toBe(document.body);
    expect(dialog()?.textContent).toContain("中央与地方之间财政关系的制度安排");
    expect(dialog()?.querySelector(".judu-concept-definition")).not.toBeNull();
    expect(doc.documentElement.outerHTML).toBe(before); expect(paragraph.firstChild).toBe(node);
    expect(view.getCFI).not.toHaveBeenCalled();
  });
  it("缺少逐词定义显示暂无定义而非句读摘要", async () => {
    await render({ annotations: [annotation()], concepts: [{ name: "财政体制", text: "" }] }); await hover();
    expect(dialog()?.textContent).toContain("暂无定义"); expect(dialog()?.textContent).not.toContain(annotation().summary);
  });
  it("点击原文固定概念，其他概念悬停不能替换，点外部可以关闭", async () => {
    await render(); await hover(); await event(doc.querySelector("p")!, "click", { clientX: 50, clientY: 50 });
    await hover(230, 50); expect(dialog()?.textContent).toContain("中央与地方");
    await event(doc.body, "pointerdown", { clientX: 500, clientY: 300 }); expect(dialog()).toBeNull();
  });
  it("未固定的浮窗离开源位置后关闭，可在关闭前进入卡片", async () => {
    await render(); await hover(); await hover(600, 400);
    await event(dialog()!, "mouseover"); await act(async () => { vi.advanceTimersByTime(200); }); expect(dialog()).not.toBeNull();
    await event(dialog()!, "mouseout", { relatedTarget: document.body }); await act(async () => { vi.advanceTimersByTime(200); }); expect(dialog()).toBeNull();
  });
  it("键盘聚焦概念触发器可以查看定义", async () => {
    await render(); const trigger = button("查看概念：财政体制"); await act(async () => trigger.focus());
    expect(dialog()?.textContent).toContain("中央与地方"); expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
  it("键盘从实际概念触发器 ArrowDown 进入浮窗，Escape 回到实际触发器", async () => {
    await render(); const trigger = button("查看概念：财政体制"); await act(async () => trigger.focus()); await key(trigger, "ArrowDown");
    expect(document.activeElement).toBe(button("关闭浮层"));
    await key(document.activeElement!, "Escape"); expect(dialog()).toBeNull(); expect(document.activeElement).toBe(trigger);
  });
  it("关闭按钮将焦点恢复至概念触发器，不能丢到隐藏代理节点", async () => {
    await render(); const trigger = button("查看概念：财政体制"); await act(async () => trigger.focus());
    await act(async () => button("关闭浮层").focus()); await click(button("关闭浮层"));
    expect(dialog()).toBeNull(); expect(document.activeElement).toBe(trigger);
  });
  it("句尾同一末端只有一个历史图标，概述和完整入口按消息准确回调", async () => {
    const newer = annotation({ id: "a2", messageId: "m2", summary: "最新完整概述", createdAt: "2026-09-18T01:00:00Z" });
    await render({ annotations: [annotation(), newer] }); const trigger = button("查看句读历史（2条）"); expect(trigger).toBeDefined();
    expect(mount.querySelectorAll(".epub-history-marker")).toHaveLength(1); await click(trigger);
    expect(dialog()?.querySelector(".judu-annotation-history")?.children).toHaveLength(2);
    expect(dialog()?.textContent).toContain("最新完整概述"); expect(dialog()?.textContent).toContain(annotation().summary);
    await click(button("查看完整句读")); expect(props.onOpenAnnotation).toHaveBeenCalledExactlyOnceWith(newer); expect(dialog()).toBeNull();
  });
  it.each(["note", "favorite"] as const)("手动 %s 只打开手动标注，不展示 AI 历史或打开会话", async kind => {
    await render({ annotations: [annotation({ kind, concepts: [], summary: "手工保存的文字" })], concepts: [] });
    await hover(20, 50); expect(dialog()?.textContent).toContain("手工保存的文字");
    expect(mount.querySelector(".epub-history-marker")).toBeNull(); expect(button("查看完整句读")).toBeUndefined();
    await event(doc.querySelector("p")!, "click", { clientX: 20, clientY: 50 }); expect(props.onOpenAnnotation).not.toHaveBeenCalled();
  });
  it("只显示当前页真实末端，不能把被裁剪的跨页范围当作末端", async () => {
    rangeRects = () => [box(40, 40, 80, 20), box(900, 40, 20, 20)];
    await render({ annotations: [annotation()] }); expect(mount.querySelector(".epub-history-marker")).toBeNull();
    expect(button("查看概念：财政体制")).toBeDefined();
  });
  it("缩放、换页重算坐标，完全离屏的概念不生成交互目标", async () => {
    frameBox = box(120, 70, 1440, 1040); await render();
    expect(button("查看概念：财政体制").style.left).toBe("100px"); expect(button("查看概念：财政体制").style.width).toBe("160px");
    frameBox = box(120, 70, 720, 520); await event(window, "resize"); await flushFrames();
    expect(button("查看概念：财政体制").style.left).toBe("60px"); expect(button("查看概念：财政体制").style.width).toBe("80px");
    rangeRects = () => [box(1000, 40, 80, 20)]; await act(async () => view.dispatchEvent(new CustomEvent("relocate"))); await flushFrames();
    expect(mount.querySelectorAll("[data-epub-target]")).toHaveLength(0);
  });
  it("跨行概念任一可见文本矩形都能悬停，行间留白不算命中", async () => {
    rangeRects = range => range.toString() === "财政体制" ? [box(40, 40, 40, 20), box(0, 80, 40, 20)] : [];
    await render(); await hover(10, 90); expect(dialog()?.textContent).toContain("中央与地方");
    await event(doc.body, "pointerdown", { clientX: 100, clientY: 70 }); expect(dialog()).toBeNull();
    await hover(10, 70); expect(dialog()).toBeNull();
  });
});

describe("引用预览与异步生命周期", () => {
  it("包内脚注复用相同浮窗，固定后仅显式点击才跳转", async () => {
    const reference = link("ref", "#note"); await render(); await hoverLink(reference);
    expect(dialog()?.classList.contains("judu-annotation-popover")).toBe(true); expect(dialog()?.textContent).toContain("本地脚注正文");
    expect(props.onJump).not.toHaveBeenCalled(); await click(reference); await click(button("跳转到原文"));
    expect(props.onJump).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ index: 0, fragment: "note", text: "本地脚注正文" })); expect(dialog()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("外链仅展示纯文本地址，不请求网络、不打开新窗口，也不提供包内跳转", async () => {
    const reference = link("external", "https://example.invalid/private"); await render(); await hoverLink(reference);
    expect(dialog()?.querySelector("header strong")?.textContent).toBe("外部链接");
    expect(dialog()?.textContent).toContain("外部链接不自动访问。"); expect(dialog()?.textContent).toContain("https://example.invalid/private");
    expect(dialog()?.querySelector("a")).toBeNull(); expect(button("跳转到原文")).toBeUndefined(); expect(fetch).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
  });
  it.each(["resolve", "reject"] as const)("旧包内preview %s不能覆盖当前外链真实标题", async outcome => {
    const pending = deferred<Document>(), failure = new Error("旧包内预览失败"), warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    props.book.sections.push(section("OEBPS/old.xhtml", () => pending.promise));
    const old = link("ref", "old.xhtml#n"), external = link("ref2", "https://example.invalid/current");
    await render(); await hoverLink(old);
    expect(dialog()?.querySelector("header strong")?.textContent).toBe("引用预览");
    expect(dialog()?.querySelector('[role="status"]')?.textContent).toContain("正在读取引用");
    await hoverLink(external); expect(dialog()?.querySelector("header strong")?.textContent).toBe("外部链接");
    await act(async () => { if (outcome === "resolve") pending.resolve(parse('<aside id="n">旧正文</aside>')); else pending.reject(failure); });
    expect(dialog()?.querySelector("header strong")?.textContent).toBe("外部链接");
    expect(dialog()?.textContent).toContain("https://example.invalid/current"); expect(dialog()?.textContent).not.toContain("旧正文");
    expect(dialog()?.textContent).not.toContain("引用正文不可用"); expect(props.onNotice).not.toHaveBeenCalled();
    if (outcome === "reject") expect(warn).toHaveBeenCalledWith("引用预览失败", failure);
    expect(fetch).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
  });
  it("后发引用先返回时，先发响应不能覆盖当前引用", async () => {
    const first = deferred<Document>(), second = deferred<Document>();
    props.book.sections.push(section("OEBPS/one.xhtml", () => first.promise), section("OEBPS/two.xhtml", () => second.promise));
    const one = link("ref1", "one.xhtml#n"), two = link("ref2", "two.xhtml#n"); await render();
    await hoverLink(one); expect(dialog()?.textContent).toContain("正在读取引用"); await hoverLink(two);
    await act(async () => second.resolve(parse('<aside id="n">第二条引用</aside>'))); expect(dialog()?.textContent).toContain("第二条引用");
    await act(async () => first.resolve(parse('<aside id="n">过时的第一条引用</aside>'))); expect(dialog()?.textContent).not.toContain("过时"); expect(dialog()?.textContent).toContain("第二条引用");
  });
  it.each(["close", "relocate", "disabled", "selection", "unmount"] as const)("异步引用在 %s 后返回不能复活浮窗", async action => {
    const pending = deferred<Document>(); props.book.sections.push(section("OEBPS/other.xhtml", () => pending.promise));
    const reference = link("ref", "other.xhtml#n"); await render(); await hoverLink(reference); expect(dialog()).not.toBeNull();
    if (action === "close") await click(button("关闭浮层"));
    if (action === "relocate") await act(async () => view.dispatchEvent(new CustomEvent("relocate")));
    if (action === "disabled") await render({ disabled: true });
    if (action === "selection") await act(async () => { selectBookText(); doc.dispatchEvent(new Event("selectionchange")); });
    if (action === "unmount") await act(async () => root.render(null));
    expect(dialog()).toBeNull(); await act(async () => pending.resolve(parse('<aside id="n">不应恢复</aside>')));
    expect(dialog()).toBeNull();
  });
  it("切版本/替换文档时清除旧引用，即使旧 iframe 仍连接在宿主中", async () => {
    const reference = link("ref", "#note"); await render(); await hoverLink(reference); expect(dialog()).not.toBeNull();
    const next = document.createElement("iframe"); document.body.append(next); extraFrames.push(next); const nextDoc = next.contentDocument!;
    nextDoc.body.innerHTML = `<p>${text}</p>`; installRangeGeometry(nextDoc);
    await render({ book: { sections: [section("NEW/ch.xhtml", async () => nextDoc)] }, documents: [{ doc: nextDoc, index: 0, maps: mapEpubDocument(nextDoc, { id: "new", title: "新版本", paragraphs: [{ id: "new-p", text }] }) }] });
    expect(frame.isConnected).toBe(true); expect(dialog()).toBeNull();
  });
  it("异步引用失败显示可恢复反馈，不静默消失或报未处理拒绝", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {}), pending = deferred<Document>();
    props.book.sections.push(section("OEBPS/missing.xhtml", () => pending.promise)); const reference = link("ref", "missing.xhtml#n");
    await render(); await hoverLink(reference); await act(async () => pending.reject(new Error("controlled failure")));
    expect(dialog()?.textContent).toContain("引用正文不可用"); expect(warn).toHaveBeenCalled(); expect(button("跳转到原文")).toBeUndefined();
  });
  it("旧跳转完成不能关闭之后新打开的概念浮窗", async () => {
    const pending = deferred<void>(); const reference = link("ref", "#note"); await render({ onJump: vi.fn(() => pending.promise) }); await hoverLink(reference);
    await click(button("跳转到原文")); await event(doc.body, "pointerdown", { clientX: 500, clientY: 300 }); await hover();
    expect(dialog()?.textContent).toContain("中央与地方"); await act(async () => pending.resolve()); expect(dialog()?.textContent).toContain("中央与地方");
  });
  it("卸载后移除旧文档监听，不再创建预览请求", async () => {
    const create = vi.fn(async () => parse('<aside id="n">内容</aside>')); props.book.sections.push(section("OEBPS/other.xhtml", create));
    const reference = link("ref", "other.xhtml#n"); await render(); await act(async () => root.render(null)); await hoverLink(reference);
    expect(create).not.toHaveBeenCalled(); expect(dialog()).toBeNull();
  });
});

describe("浮窗不干扰原生选文", () => {
  it("拖选中的鼠标不打开浮窗，保留 Range 与选中内容", async () => {
    await render(); const range = selectBookText(), selected = range.toString();
    await hover(); await event(doc.querySelector("p")!, "click", { clientX: 50, clientY: 50 });
    expect(dialog()).toBeNull(); expect(doc.defaultView!.getSelection()?.toString()).toBe(selected); expect(range.toString()).toBe(selected);
    doc.defaultView!.getSelection()?.removeAllRanges(); await event(doc.querySelector("p")!, "mousemove", { clientX: 50, clientY: 50, buttons: 1 }); expect(dialog()).toBeNull();
  });
  it("新选区关闭已打开浮窗，但不清除用户选文", async () => {
    await render(); await hover(); const range = selectBookText(); await act(async () => doc.dispatchEvent(new Event("selectionchange")));
    expect(dialog()).toBeNull(); expect(doc.defaultView!.getSelection()?.toString()).toBe(text); expect(range.toString()).toBe(text);
  });
  it("选文存在时操作宿主概念触发器也不重新打开遮挡浮窗", async () => {
    await render(); await act(async () => { selectBookText(); doc.dispatchEvent(new Event("selectionchange")); });
    await act(async () => button("查看概念：财政体制").focus()); expect(dialog()).toBeNull();
  });
  it("portal 内文字选择事件不冒泡回阅读器选文处理器", async () => {
    const handler = vi.fn(); await act(async () => root.render(<div onMouseUp={handler}><EpubInteractionLayer {...props} /></div>)); await hover();
    await event(dialog()!.querySelector(".judu-concept-definition")!, "mouseup"); expect(handler).not.toHaveBeenCalled(); expect(doc.defaultView!.getSelection()?.isCollapsed).toBe(true);
  });
});

describe("补充：键盘回路、版本异步与实时内容", () => {
  it("概念浮窗第一个控件 Shift+Tab 返回真正的概念触发器", async () => {
    await render(); const trigger = button("查看概念：财政体制"); await act(async () => trigger.focus()); await key(trigger, "ArrowDown");
    const first = button("关闭浮层"); expect(document.activeElement).toBe(first);
    await act(async () => { first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(trigger);
  });
  it("引用可以从 iframe 键盘进入卡片并 Escape 返回原链接", async () => {
    const reference = link("ref", "#note"); await render(); await act(async () => reference.focus());
    expect(dialog()?.textContent).toContain("本地脚注正文"); await key(reference, "ArrowDown"); expect(document.activeElement).toBe(button("关闭浮层"));
    await key(document.activeElement!, "Escape"); expect(dialog()).toBeNull(); expect(doc.activeElement).toBe(reference);
  });
  it("同一文档暂留但书籍版本改变时，不接受旧版本引用的异步响应", async () => {
    const pending = deferred<Document>(); props.book.sections.push(section("OEBPS/old.xhtml", () => pending.promise));
    const reference = link("ref", "old.xhtml#n"); await render(); await hoverLink(reference);
    await render({ book: { sections: [section("NEW/ch.xhtml", async () => doc)] } }); expect(dialog()).toBeNull();
    await act(async () => pending.resolve(parse('<aside id="n">旧版本内容</aside>'))); expect(dialog()).toBeNull();
  });
  it("流式补充或修改概念定义刷新已打开内容，不改变书内 DOM", async () => {
    const before = doc.body.innerHTML; await render(); await hover();
    await render({ concepts: [{ name: "财政体制", text: "补充后的真实定义" }] });
    expect(dialog()?.textContent).toContain("补充后的真实定义"); expect(dialog()?.textContent).not.toContain("中央与地方"); expect(doc.body.innerHTML).toBe(before);
  });
  it("删除当前概念/关闭概念显示后，旧浮窗和原文触发器一并清理", async () => {
    await render(); await hover(); await render({ concepts: [] }); expect(dialog()).toBeNull(); expect(button("查看概念：财政体制")).toBeUndefined();
  });
  it("新历史更新后完整句读入口使用最新记录而不是闭包里的旧记录", async () => {
    await render({ annotations: [annotation()] }); await click(button("查看句读历史（1条）"));
    const newer = annotation({ id: "a2", messageId: "m2", summary: "新增历史", createdAt: "2026-09-18T05:00:00Z" });
    await render({ annotations: [annotation(), newer] }); expect(dialog()?.textContent).toContain("新增历史");
    await click(button("查看完整句读")); expect(props.onOpenAnnotation).toHaveBeenCalledExactlyOnceWith(newer);
  });
  it("没有完整句读回调时不提供会误触发的可用入口", async () => {
    await render({ annotations: [annotation()], onOpenAnnotation: undefined }); await click(button("查看句读历史（1条）")); expect(button("查看完整句读").disabled).toBe(true);
  });
  it.each(["renderer", "scroll"] as const)("%s 翻页信号关闭固定浮窗并作废旧请求", async source => {
    const reference = link("ref", "#note"); await render(); await hoverLink(reference); await click(reference); expect(dialog()).not.toBeNull();
    await act(async () => { if (source === "renderer") view.renderer.dispatchEvent(new CustomEvent("relocate")); else doc.dispatchEvent(new Event("scroll")); });
    expect(dialog()).toBeNull();
  });
  it("当前引用跳转失败记录错误并提示用户，不误调用 AI 会话", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {}), pending = deferred<void>();
    const reference = link("ref", "#note"); await render({ onJump: vi.fn(() => pending.promise) }); await hoverLink(reference); await click(button("跳转到原文"));
    await act(async () => pending.reject(new Error("controlled jump failure")));
    expect(warn).toHaveBeenCalled(); expect(props.onNotice).toHaveBeenCalledWith("引用跳转失败，请从原书目录重试。"); expect(props.onOpenAnnotation).not.toHaveBeenCalled();
  });
  it("禁用态不从原文鼠标或引用键盘打开新浮窗", async () => {
    const reference = link("ref", "#note"); await render({ disabled: true }); await hover(); await act(async () => reference.focus());
    expect(dialog()).toBeNull(); expect(button("查看概念：财政体制").disabled).toBe(true);
  });
});

describe("EPUB适配器P1回归：禁用与identity往返", () => {
  function target(kind: "concept" | "history" | "link") {
    if (kind === "history") props.annotations = [annotation()];
    const reference = kind === "link" ? link("ref", "#note") : null;
    return {
      expected: kind === "concept" ? "中央与地方" : kind === "history" ? "完整概述而非概念定义" : "本地脚注正文",
      open: async () => { if (reference) await hoverLink(reference); else if (kind === "history") await click(button("查看句读历史（1条）")); else await hover(); },
    };
  }
  it.each(["concept", "history", "link"] as const)("%s 禁用再恢复不能复活，保留同源DOM后新交互仍有效", async kind => {
    const current = target(kind), before = doc.body.innerHTML; await render(); await current.open(); expect(dialog()?.textContent).toContain(current.expected);
    await render({ disabled: true }); expect(dialog()).toBeNull(); await current.open(); expect(dialog()).toBeNull();
    await render({ disabled: false }); await flushFrames(); await render(); expect(dialog()).toBeNull();
    await current.open(); expect(dialog()?.textContent).toContain(current.expected); expect(doc.body.innerHTML).toBe(before);
    expect(props.onJump).not.toHaveBeenCalled(); expect(props.onOpenAnnotation).not.toHaveBeenCalled();
  });
  const cases = (["concept", "history", "link"] as const).flatMap(kind => (["book", "documents"] as const).map(boundary => ({ kind, boundary })));
  it.each(cases)("$kind 的 $boundary A→B→原A对象不复活，即使同一iframe仍连接", async ({ kind, boundary }) => {
    const current = target(kind), bookA = props.book, documentsA = props.documents;
    await render(); await current.open(); expect(dialog()?.textContent).toContain(current.expected);
    await render(boundary === "book" ? { book: { ...bookA } } : { documents: [...documentsA] }); expect(dialog()).toBeNull();
    await render({ book: bookA, documents: documentsA }); await flushFrames();
    expect(props.book).toBe(bookA); expect(props.documents).toBe(documentsA); expect(frame.isConnected).toBe(true); expect(dialog()).toBeNull();
    await current.open(); expect(dialog()?.textContent).toContain(current.expected);
  });
  const lateCases = (["disabled", "book", "documents"] as const).flatMap(boundary => (["resolve", "reject"] as const).map(outcome => ({ boundary, outcome })));
  it.each(lateCases)("$boundary 恢复后旧preview $outcome 不复活任何浮窗", async ({ boundary, outcome }) => {
    const pending = deferred<Document>(), warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    props.book.sections.push(section("OEBPS/other.xhtml", () => pending.promise));
    const reference = link("ref", "other.xhtml#n"), bookA = props.book, documentsA = props.documents;
    await render(); await hoverLink(reference); expect(dialog()?.textContent).toContain("正在读取引用");
    await render(boundary === "disabled" ? { disabled: true } : boundary === "book" ? { book: { ...bookA } } : { documents: [...documentsA] });
    await render({ disabled: false, book: bookA, documents: documentsA }); expect(dialog()).toBeNull();
    const failure = new Error("已过期的包内引用");
    await act(async () => { if (outcome === "resolve") pending.resolve(parse('<aside id="n">过期正文</aside>')); else pending.reject(failure); });
    await flushFrames(); expect(dialog()).toBeNull(); expect(props.onNotice).not.toHaveBeenCalled(); expect(props.onJump).not.toHaveBeenCalled();
    if (outcome === "reject") expect(warn).toHaveBeenCalledWith("引用预览失败", failure);
  });
  it("禁用恢复后同一个href的新preview先完成，旧preview不能覆盖它", async () => {
    const old = deferred<Document>(), fresh = deferred<Document>(), create = vi.fn<() => Promise<Document>>().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    props.book.sections.push(section("OEBPS/other.xhtml", create)); const reference = link("ref", "other.xhtml#n");
    await render(); await hoverLink(reference); await render({ disabled: true }); await render({ disabled: false }); expect(dialog()).toBeNull();
    await hoverLink(reference); expect(create).toHaveBeenCalledTimes(2);
    await act(async () => fresh.resolve(parse('<aside id="n">新请求正文</aside>')));
    await act(async () => old.resolve(parse('<aside id="n">旧请求正文</aside>')));
    expect(dialog()?.textContent).toContain("新请求正文"); expect(dialog()?.textContent).not.toContain("旧请求正文");
  });
});

describe("真实view.js与EpubReader链接策略（仅替换加载/排版/导航端点）", () => {
  async function mountReader(disabled = false) {
    await import("../../public/vendor/foliate/paginator.js");
    const realView = new View() as unknown as FoliateView;
    vi.spyOn(realView, "init").mockResolvedValue(); const navigate = vi.spyOn(realView, "goTo").mockResolvedValue(undefined);
    props.book.isExternal = href => /^[a-z][\w+.-]*:/iu.test(href) || href.startsWith("//");
    loader.loadEpub.mockResolvedValue(props.book); loader.createFoliateView.mockResolvedValue(realView);
    vi.mocked(fetch).mockResolvedValue({ ok: true, blob: async () => new Blob(["test-only EPUB"]) } as Response);
    const readerProps: EpubReaderProps = {
      book: { id: "test-book", title: "测试书", author: "测试", editionId: "test-edition", chapters: [{ id: "c", title: "章", sourceHref: "OEBPS/ch.xhtml", paragraphs: [{ id: "p", text }] }] },
      anchor: null, appearance: DEFAULT_READING_APPEARANCE, annotations: props.annotations, concepts: props.concepts, disabled,
      onSelect: vi.fn(), onPosition: vi.fn(), onNotice: props.onNotice, onFallback: vi.fn(),
    };
    await act(async () => root.render(<EpubReader {...readerProps} />));
    expect(mount.querySelector('[aria-label="EPUB 原版阅读器"]')?.getAttribute("aria-busy")).toBe("false");
    const readerHost = mount.querySelector<HTMLElement>(".epub-host")!;
    vi.spyOn(readerHost, "getBoundingClientRect").mockReturnValue(box(100, 50, 800, 600));
    await act(async () => realView.renderer.dispatchEvent(new CustomEvent("load", { detail: { doc, index: 0 } })));
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/books/test-book/original?editionId=test-edition", expect.any(Object));
    vi.mocked(fetch).mockClear(); vi.mocked(props.onNotice).mockClear();
    return { realView, navigate };
  }
  const externalCases = (["normal", "noteref", "doc-noteref"] as const).flatMap(kind => [false, true].map(disabled => ({ kind, disabled })));
  it.each(externalCases)("$kind 外链 disabled=$disabled：真实捕获层或reader兜底均阻止打开窗口", async ({ kind, disabled }) => {
    const reference = link("external", "https://example.invalid/private");
    if (kind !== "noteref") reference.removeAttribute("epub:type"); if (kind === "doc-noteref") reference.setAttribute("role", "doc-noteref");
    const nested = doc.createElement("span"); nested.textContent = "链接文字"; reference.append(nested);
    const { realView, navigate } = await mountReader(disabled), external = vi.fn<(event: Event) => void>(); realView.addEventListener("external-link", external);
    await hoverLink(reference);
    if (disabled) expect(dialog()).toBeNull(); else {
      expect(dialog()?.textContent).toContain("外部链接不自动访问。");
      expect(dialog()?.querySelector("header strong")?.textContent).toBe("外部链接");
    }
    const clicked = await event(nested, "click", { clientX: 161, clientY: 91 }); expect(clicked.defaultPrevented).toBe(true);
    if (kind !== "normal" && !disabled) {
      expect(external).not.toHaveBeenCalled(); expect(props.onNotice).not.toHaveBeenCalled();
    } else {
      expect(external).toHaveBeenCalledOnce(); expect(external.mock.calls[0][0].cancelable).toBe(true); expect(external.mock.calls[0][0].defaultPrevented).toBe(true);
      expect(props.onNotice).toHaveBeenCalledExactlyOnceWith("为保护本地书库，已阻止书籍打开外部链接。");
    }
    expect(window.open).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled(); expect(button("跳转到原文")).toBeUndefined();
  });
  it("对照：真实View未装配reader兜底时会调用open，确保窗口断言不是无效桩", async () => {
    await import("../../public/vendor/foliate/paginator.js"); const raw = new View() as unknown as FoliateView; host.append(raw);
    try {
      await raw.open({ ...props.book, isExternal: () => true }); raw.renderer.dispatchEvent(new CustomEvent("load", { detail: { doc, index: 0 } }));
      const reference = link("external", "https://example.invalid/control"); reference.removeAttribute("epub:type");
      const clicked = await event(reference, "click"); expect(clicked.defaultPrevented).toBe(true);
      expect(window.open).toHaveBeenCalledExactlyOnceWith("https://example.invalid/control", "_blank"); expect(fetch).not.toHaveBeenCalled();
    } finally { raw.close(); raw.remove(); }
  });
  it.each(["normal", "noteref"] as const)("现状证据：%s 内链hover可预览，click是否固定由noteref决定", async kind => {
    const reference = link("ref", "#note"); if (kind === "normal") reference.removeAttribute("epub:type");
    const { realView, navigate } = await mountReader(), internal = vi.fn<(event: Event) => void>(); realView.addEventListener("link", internal);
    await hoverLink(reference); expect(dialog()?.textContent).toContain("本地脚注正文"); expect(navigate).not.toHaveBeenCalled();
    const clicked = await event(reference, "click", { clientX: 161, clientY: 91 }); expect(clicked.defaultPrevented).toBe(true);
    expect(realView.renderer.goTo).not.toHaveBeenCalled();
    if (kind === "normal") {
      expect(internal).toHaveBeenCalledOnce(); expect(internal.mock.calls[0][0].defaultPrevented).toBe(false); expect(navigate).toHaveBeenCalledExactlyOnceWith("#note");
    } else { expect(internal).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled(); }
    await hover(600, 400); await act(async () => vi.advanceTimersByTime(200));
    if (kind === "normal") expect(dialog()).toBeNull(); else {
      expect(dialog()?.textContent).toContain("本地脚注正文"); await click(button("跳转到原文"));
      expect(realView.renderer.goTo).toHaveBeenCalledExactlyOnceWith({ index: 0, anchor: expect.any(Function) }); expect(dialog()).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
  });
});
