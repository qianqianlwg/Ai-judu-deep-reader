// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OriginalInteractionLayer, type OriginalInteractionProps, type ReferencePreview } from "./original-interaction-layer";
import type { ReaderInteraction } from "@/lib/reader-interactions";
import type { TextAnnotation } from "@/lib/annotations";

const box = (x: number, y: number, w: number, h: number) => new DOMRect(x, y, w, h);
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const mark = (extra: Partial<TextAnnotation> = {}): TextAnnotation => ({ id: "a1", paragraphId: "p1", startOffset: 0, endOffset: 6, textHash: "hash", threadId: "t1", messageId: "m1", kind: "analysis", summary: "第一条句读概述", concepts: ["财政体制"], createdAt: "2026-09-18T01:00:00Z", ...extra });
let host: HTMLDivElement, mount: HTMLDivElement, scope: HTMLDivElement, paragraph: HTMLParagraphElement, outside: HTMLTextAreaElement, root: Root, props: OriginalInteractionProps, mounted: boolean;
let frames: Map<number, FrameRequestCallback>, nextFrame: number, geometries: WeakMap<Range, DOMRect[]>;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.getAttribute("aria-label") === label || node.textContent === label)!;
async function render(next: Partial<OriginalInteractionProps> = {}) { props = { ...props, ...next }; await act(async () => root.render(<OriginalInteractionLayer {...props} />)); }
async function unmount() { if (mounted) { await act(async () => root.unmount()); mounted = false; } }
async function flushFrames() { await act(async () => { const jobs = [...frames.values()]; frames.clear(); jobs.forEach(job => job(0)); }); }
async function mouse(target: EventTarget, type: string, x = 55, y = 55, options: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...options });
  await act(async () => target.dispatchEvent(event)); return event;
}
async function key(target: EventTarget, value: string, shiftKey = false) { const event = new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true }); await act(async () => target.dispatchEvent(event)); return event; }
async function click(target: HTMLElement) { await act(async () => target.click()); }
function sourceRange(start: number, end: number, rect = box(40, 40, 80, 20)) {
  const range = document.createRange(); range.setStart(paragraph.firstChild!, start); range.setEnd(paragraph.firstChild!, end); geometries.set(range, [rect]); return range;
}
function concept(name = "财政体制", definition = "中央与地方财政关系的制度安排", range = sourceRange(2, 6)): ReaderInteraction {
  return { kind: "concept", key: "concept:" + name, range, concept: { name, definitions: definition ? [{ name, text: definition }] : [] } };
}
function link(href = "#note", parent: HTMLElement = scope) { const node = document.createElement("a"); node.href = href; node.textContent = "引用"; node.dataset.testLink = ""; parent.append(node); return node; }
async function select(node: Node, start = 0, end = 2) { await act(async () => { const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end); document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range); document.dispatchEvent(new Event("selectionchange")); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); frames = new Map(); nextFrame = 0; geometries = new WeakMap();
  vi.stubGlobal("requestAnimationFrame", (job: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, job); return id; }); vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("禁止外部请求"); })); vi.spyOn(window, "open").mockReturnValue(null); vi.spyOn(console, "warn").mockImplementation(() => {});
  // WHY：jsdom没有排版引擎；矩形只描述受控正文、浮窗和宿主区域，不mock业务命中或共享浮层。
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: function (this: Range) { const rects = geometries.get(this) ?? []; return Object.assign(rects, { item: (i: number) => rects[i] ?? null }); } });
  host = document.createElement("div"); host.dataset.readingPane = ""; document.body.append(host);
  scope = document.createElement("div"); scope.className = "page-scope"; paragraph = document.createElement("p"); paragraph.textContent = "理解财政体制与地方发展。"; scope.append(paragraph); host.append(scope);
  outside = document.createElement("textarea"); outside.setAttribute("aria-label", "外部聊天输入"); host.append(outside);
  mount = document.createElement("div"); host.append(mount); root = createRoot(mount); mounted = true;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this === host || this === scope) return box(0, 0, 700, 600);
    if (this.classList.contains("judu-annotation-popover")) return box(250, 150, 260, 200);
    if (this.hasAttribute("data-test-link")) return box(160, 40, 30, 20);
    return box(parseFloat(this.style.left) || 0, parseFloat(this.style.top) || 0, parseFloat(this.style.width) || 16, parseFloat(this.style.height) || 16);
  });
  props = { host: { current: host }, book: { edition: "a" }, documents: [{ doc: document, index: 1, scope, targets: [concept()] }], onOpenAnnotation: vi.fn(),
    previewLink: vi.fn(async (): Promise<ReferencePreview> => ({ title: "引用", text: "本地引用内容", index: 1 })), interceptLink: () => true,
    onJump: vi.fn(async () => {}), onNotice: vi.fn() };
});
afterEach(async () => { await unmount(); host.remove(); document.getSelection()?.removeAllRanges(); Reflect.deleteProperty(Range.prototype, "getClientRects"); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("共享原版浮层：真实内容和host Document", () => {
  it("同Document不需要iframe，hover展示真实定义且不插入正文", async () => {
    const html = scope.innerHTML, node = paragraph.firstChild, range = props.documents[0].targets[0].range, text = range.toString();
    await render(); await mouse(paragraph, "mousemove");
    expect(dialog()?.textContent).toContain("中央与地方财政关系"); expect(dialog()?.classList.contains("judu-annotation-popover")).toBe(true);
    expect(dialog()?.parentElement).toBe(document.body); expect(scope.innerHTML).toBe(html); expect(paragraph.firstChild).toBe(node); expect(range.toString()).toBe(text);
    await act(async () => window.dispatchEvent(new Event("resize"))); await flushFrames(); expect(dialog()).not.toBeNull();
  });
  it("禁用后重新启用不会恢复旧浮窗，需重新触发", async () => {
    await render(); await mouse(paragraph, "mousemove"); expect(dialog()).not.toBeNull();
    await render({ disabled: true }); expect(dialog()).toBeNull();
    await render({ disabled: false }); expect(dialog()).toBeNull();
    await mouse(paragraph, "mousemove"); expect(dialog()?.textContent).toContain("中央与地方财政关系");
  });  it("缺失概念定义明确显示暂无定义", async () => {
    await render({ documents: [{ ...props.documents[0], targets: [concept("财政体制", "")] }] }); await mouse(paragraph, "mousemove");
    expect(dialog()?.textContent).toContain("暂无定义"); expect(dialog()?.textContent).not.toContain("句读概述");
  });
  it("历史多条展示对应来源，完整句读回调不串消息", async () => {
    const records = [mark({ id: "a2", messageId: "m2", summary: "第二条概述" }), mark()];
    await render({ documents: [{ ...props.documents[0], targets: [{ kind: "history", key: "history", range: sourceRange(5, 6, box(120, 40, 10, 20)), annotations: records }] }] });
    await click(button("查看句读历史（2条）")); expect(dialog()?.querySelectorAll("li")).toHaveLength(2);
    await click(dialog()!.querySelectorAll("li button")[1] as HTMLButtonElement); expect(props.onOpenAnnotation).toHaveBeenCalledExactlyOnceWith(records[1]);
  });
  it.each(["note", "favorite"] as const)("手动%s只显示本地内容不伪装AI", async kind => {
    const annotation = mark({ kind, summary: "我的手动笔记", threadId: "manual-mark" });
    await render({ documents: [{ ...props.documents[0], targets: [{ kind: "mark", key: "mark", range: sourceRange(0, 6), annotation }] }] }); await mouse(paragraph, "mousemove");
    expect(dialog()?.textContent).toContain("我的手动笔记"); expect(dialog()?.textContent).not.toContain("查看完整句读"); expect(props.onOpenAnnotation).not.toHaveBeenCalled();
  });
  it("在同Document浮窗正文pointerdown不会被当作原文外部点击关闭", async () => {
    await render(); await mouse(paragraph, "mousemove"); const content = dialog()!.querySelector(".judu-concept-definition")!;
    await mouse(content, "pointerdown", 300, 180); expect(dialog()).not.toBeNull();
  });
  it("同Document移入浮窗后经过关闭延时仍保持可读", async () => {
    await render(); await mouse(paragraph, "mousemove"); await mouse(dialog()!, "mouseover", 300, 180); await mouse(dialog()!, "mousemove", 300, 180);
    await act(async () => vi.advanceTimersByTime(200)); expect(dialog()).not.toBeNull();
  });
  it("同Document可复制浮窗定义文本而不把它当正文选文关闭", async () => {
    await render(); await mouse(paragraph, "mousemove"); const node = dialog()!.querySelector(".judu-concept-definition div")!.firstChild!;
    await select(node); expect(dialog()).not.toBeNull(); expect(document.getSelection()!.toString()).toBe("中央");
  });
  it("真实点击历史入口包含pointerdown后仍能打开正确完整句读", async () => {
    await render({ documents: [{ ...props.documents[0], targets: [{ kind: "history", key: "history", range: sourceRange(5, 6), annotations: [mark()] }] }] });
    await click(button("查看句读历史（1条）")); const open = button("查看完整句读");
    await mouse(open, "pointerdown", 300, 240); await mouse(open, "mouseup", 300, 240); await mouse(open, "click", 300, 240);
    expect(props.onOpenAnnotation).toHaveBeenCalledExactlyOnceWith(mark());
  });
});

describe("共享原版浮层：scope、焦点、选文", () => {
  it("相同几何坐标的外部UI事件不能命中正文概念", async () => {
    await render(); await mouse(outside, "mousemove"); await mouse(outside, "click"); expect(dialog()).toBeNull();
  });
  it("scope外链接不触发引用请求，不拦截默认行为", async () => {
    const externalUI = link("#settings", host); await render(); const event = await mouse(externalUI, "click", 170, 50);
    expect(event.defaultPrevented).toBe(false); expect(props.previewLink).not.toHaveBeenCalled(); expect(dialog()).toBeNull();
  });
  it("两个scope相邻/重叠矩形时事件只命中所属页", async () => {
    const second = document.createElement("div"), p = document.createElement("p"); p.textContent = "第二页"; second.append(p); host.append(second);
    const range = document.createRange(); range.selectNodeContents(p); geometries.set(range, [box(40, 40, 80, 20)]);
    const target: ReaderInteraction = { kind: "concept", key: "second", range, concept: { name: "第二页", definitions: [{ name: "第二页", text: "第二页独有定义" }] } };
    await render({ documents: [...props.documents, { doc: document, index: 2, scope: second, targets: [target] }] });
    await mouse(p, "mousemove"); expect(dialog()?.textContent).toContain("第二页独有定义"); expect(dialog()?.textContent).not.toContain("中央与地方");
  });
  it("引用打开后外部输入ArrowDown/Tab不能被阅读层劫持", async () => {
    const reference = link(); await render(); await mouse(reference, "mouseover", 170, 50); await act(async () => outside.focus());
    const arrow = await key(outside, "ArrowDown"); expect(arrow.defaultPrevented).toBe(false); expect(document.activeElement).toBe(outside);
    const tab = await key(outside, "Tab"); expect(tab.defaultPrevented).toBe(false);
  });
  it("概念实际触发器进入卡片并Shift+Tab返回，不落隐藏代理", async () => {
    await render(); const trigger = button("查看概念：财政体制"); await act(async () => trigger.focus()); await key(trigger, "ArrowDown");
    expect(document.activeElement).toBe(button("关闭浮层")); await key(document.activeElement!, "Tab", true); expect(document.activeElement).toBe(trigger);
  });
  it("引用真实链接键盘进入后Escape恢复链接焦点", async () => {
    const reference = link(); await render(); await act(async () => reference.focus()); await key(reference, "ArrowDown");
    expect(document.activeElement).toBe(button("关闭浮层")); await key(document.activeElement!, "Escape"); expect(dialog()).toBeNull(); expect(document.activeElement).toBe(reference);
  });
  it("正文非折叠选区屏蔽鼠标与宿主触发器，不破坏Range", async () => {
    await render(); await select(paragraph.firstChild!, 0, 6); const selected = document.getSelection()!.toString();
    // WHY：纯jsdom无产品代码时button.focus也折叠Selection；此处只发真实focusin验证处理器，焦点移动由独立键盘用例覆盖。
    await mouse(paragraph, "mousemove"); await act(async () => button("查看概念：财政体制").dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    expect(dialog()).toBeNull(); expect(document.getSelection()!.toString()).toBe(selected);
  });
  it("新正文选文关闭现有浮窗但保留选文", async () => {
    await render(); await mouse(paragraph, "mousemove"); await select(paragraph.firstChild!, 0, 6); expect(dialog()).toBeNull(); expect(document.getSelection()!.toString()).toBe("理解财政体制");
  });
  it("拖选按钮按住时不悬停开窗", async () => { await render(); await mouse(paragraph, "mousemove", 55, 55, { buttons: 1 }); expect(dialog()).toBeNull(); });
});

describe("共享原版浮层：引用隔离和生命周期", () => {
  it("引用只预览，明确点击才跳转，绝不请求网络", async () => {
    const reference = link(); await render(); await mouse(reference, "mouseover", 170, 50);
    expect(dialog()?.textContent).toContain("本地引用内容"); expect(props.onJump).not.toHaveBeenCalled();
    await click(button("跳转到原文")); expect(props.onJump).toHaveBeenCalledExactlyOnceWith({ title: "引用", text: "本地引用内容", index: 1 });
    expect(fetch).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
  });
  it("外部引用只展示地址，没有跳转按钮", async () => {
    vi.mocked(props.previewLink!).mockResolvedValue({ title: "外部地址", text: "不自动访问", address: "https://invalid.example/resource" });
    const reference = link(); await render(); await mouse(reference, "mouseover", 170, 50);
    expect(dialog()?.textContent).toContain("https://invalid.example/resource"); expect(button("跳转到原文")).toBeUndefined(); expect(props.onJump).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["close", "book", "documents", "disabled", "relocate", "unmount"] as const)("迟到引用在%s后不能复活", async action => {
    const gate = deferred<ReferencePreview>(), source = new EventTarget(), reference = link(); vi.mocked(props.previewLink!).mockReturnValue(gate.promise);
    await render({ relocationSources: [source] }); await mouse(reference, "mouseover", 170, 50); expect(dialog()?.textContent).toContain("正在读取");
    if (action === "close") await click(button("关闭浮层"));
    if (action === "book") await render({ book: { edition: "b" } });
    if (action === "documents") await render({ documents: [] });
    if (action === "disabled") await render({ disabled: true });
    if (action === "relocate") await act(async () => source.dispatchEvent(new Event("relocate")));
    if (action === "unmount") await unmount();
    await act(async () => gate.resolve({ title: "旧版引用", text: "不得复活", index: 1 })); expect(dialog()).toBeNull();
  });
  it("后发引用先返回时旧响应不覆盖新内容", async () => {
    const first = deferred<ReferencePreview>(), second = deferred<ReferencePreview>(), a = link("#a"), b = link("#b");
    vi.mocked(props.previewLink!).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise); await render();
    await mouse(a, "mouseover", 170, 50); await mouse(b, "mouseover", 170, 50);
    await act(async () => second.resolve({ title: "b", text: "新引用" })); await act(async () => first.resolve({ title: "a", text: "过期引用" }));
    expect(dialog()?.textContent).toContain("新引用"); expect(dialog()?.textContent).not.toContain("过期引用");
  });
  it("旧跳转完成不能关闭之后打开的概念", async () => {
    const gate = deferred<void>(), reference = link(); vi.mocked(props.onJump).mockReturnValue(gate.promise); await render();
    await mouse(reference, "mouseover", 170, 50); await click(button("跳转到原文")); await click(button("关闭浮层")); await mouse(paragraph, "mousemove");
    await act(async () => gate.resolve()); expect(dialog()?.textContent).toContain("中央与地方财政关系");
  });
  it("同documentsIdentity的定义更新不关闭浮窗并使用最新内容", async () => {
    await render({ documentsIdentity: scope }); await mouse(paragraph, "mousemove");
    await render({ documents: [{ ...props.documents[0], targets: [concept("财政体制", "新定义")] }] }); expect(dialog()?.textContent).toContain("新定义");
  });
  it("引用读取中仅targets更新不永久停在正在读取", async () => {
    const gate = deferred<ReferencePreview>(), reference = link(); vi.mocked(props.previewLink!).mockReturnValue(gate.promise);
    await render({ documentsIdentity: scope }); await mouse(reference, "mouseover", 170, 50);
    await render({ documents: [{ ...props.documents[0], targets: [concept("财政体制", "补充定义")] }] });
    await act(async () => gate.resolve({ title: "引用", text: "应完成的引用正文" })); expect(dialog()?.textContent).toContain("应完成的引用正文");
  });
  it("移出可见阅读区域关闭旧概念，重新布局不改正文", async () => {
    await render(); await mouse(paragraph, "mousemove"); const html = scope.innerHTML;
    geometries.set(props.documents[0].targets[0].range, [box(40, 900, 80, 20)]);
    await act(async () => window.dispatchEvent(new Event("resize"))); await flushFrames(); expect(dialog()).toBeNull(); expect(scope.innerHTML).toBe(html);
  });
  it("当前引用失败有明确反馈和日志，卸载移除监听", async () => {
    vi.mocked(props.previewLink!).mockRejectedValue(new Error("受控读取失败")); const reference = link(); await render(); await mouse(reference, "mouseover", 170, 50);
    expect(dialog()?.textContent).toContain("引用正文不可用"); expect(console.warn).toHaveBeenCalled(); await unmount(); vi.mocked(props.previewLink!).mockClear();
    await mouse(reference, "mouseover", 170, 50); expect(props.previewLink).not.toHaveBeenCalled();
  });
});


describe("P1回归：清除状态而非暂时隐藏", () => {
  function target(kind: "concept" | "history" | "link") {
    if (kind === "history") props.documents = [{ ...props.documents[0], targets: [{ kind: "history", key: "history", range: sourceRange(5, 6), annotations: [mark()] }] }];
    const reference = kind === "link" ? link() : null;
    const expected = kind === "concept" ? "中央与地方财政关系" : kind === "history" ? "第一条句读概述" : "本地引用内容";
    const open = async () => {
      if (reference) await mouse(reference, "mouseover", 170, 50);
      else if (kind === "history") await click(button("查看句读历史（1条）"));
      else await mouse(paragraph, "mousemove");
    };
    return { expected, open };
  }
  it.each(["concept", "history", "link"] as const)("%s 禁用再恢复、布局刷新均不复活，但新交互可重新打开", async kind => {
    const current = target(kind); await render(); await current.open(); expect(dialog()?.textContent).toContain(current.expected);
    await render({ disabled: true }); expect(dialog()).toBeNull(); await current.open(); expect(dialog()).toBeNull();
    await render({ disabled: false }); await flushFrames(); await render(); expect(dialog()).toBeNull();
    for (const trigger of mount.querySelectorAll("[data-epub-target]")) expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await current.open(); expect(dialog()?.textContent).toContain(current.expected);
    if (kind === "link") expect(props.previewLink).toHaveBeenCalledTimes(2);
    expect(props.onOpenAnnotation).not.toHaveBeenCalled(); expect(props.onJump).not.toHaveBeenCalled();
  });
  const identityCases = (["concept", "history", "link"] as const).flatMap(kind =>
    (["book", "documentsIdentity", "documents"] as const).map(boundary => ({ kind, boundary })));
  it.each(identityCases)("$kind 在 $boundary A→B→原A对象后不复活", async ({ kind, boundary }) => {
    const current = target(kind), identityA = {}, identityB = {};
    await render(boundary === "documentsIdentity" ? { documentsIdentity: identityA } : {});
    const bookA = props.book, documentsA = props.documents;
    await current.open(); expect(dialog()?.textContent).toContain(current.expected);
    await render(boundary === "book" ? { book: {} } : boundary === "documentsIdentity" ? { documentsIdentity: identityB } : { documents: [...documentsA] });
    expect(dialog()).toBeNull();
    // WHY：必须返回原A引用，而非创建等值对象；只按owner过滤渲染的旧实现会在这里复活。
    await render(boundary === "book" ? { book: bookA } : boundary === "documentsIdentity" ? { documentsIdentity: identityA } : { documents: documentsA });
    await flushFrames(); expect(dialog()).toBeNull(); expect(props.book).toBe(bookA); expect(props.documents).toBe(documentsA);
    if (boundary === "documentsIdentity") expect(props.documentsIdentity).toBe(identityA);
    await current.open(); expect(dialog()?.textContent).toContain(current.expected);
  });
  const previewCases = (["disabled", "book", "documentsIdentity"] as const).flatMap(boundary => [false, true].map(oldFirst => ({ boundary, oldFirst })));
  it.each(previewCases)("$boundary 边界恢复后同链接旧preview不覆盖新标题，oldFirst=$oldFirst", async ({ boundary, oldFirst }) => {
    const old = deferred<ReferencePreview>(), fresh = deferred<ReferencePreview>(), reference = link(), identityA = {}, bookA = props.book;
    vi.mocked(props.previewLink!).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    await render({ documentsIdentity: identityA }); await mouse(reference, "mouseover", 170, 50);
    expect(dialog()?.textContent).toContain("正在读取引用");
    await render(boundary === "disabled" ? { disabled: true } : boundary === "book" ? { book: {} } : { documentsIdentity: {} });
    await render({ disabled: false, book: bookA, documentsIdentity: identityA }); expect(dialog()).toBeNull();
    await mouse(reference, "mouseover", 170, 50); expect(props.previewLink).toHaveBeenCalledTimes(2);
    expect(dialog()?.querySelector("header strong")?.textContent).toBe("引用预览");
    if (oldFirst) {
      await act(async () => old.resolve({ title: "旧引用", text: "上轮过期结果" }));
      expect(dialog()?.querySelector("header strong")?.textContent).toBe("引用预览");
      expect(dialog()?.querySelector('[role="status"]')?.textContent).toContain("正在读取引用");
    }
    await act(async () => fresh.resolve({ title: "新引用", text: "本轮引用结果" }));
    expect(dialog()?.querySelector("header strong")?.textContent).toBe("新引用");
    if (!oldFirst) await act(async () => old.resolve({ title: "旧引用", text: "上轮过期结果" }));
    expect(dialog()?.querySelector("header strong")?.textContent).toBe("新引用");
    expect(dialog()?.textContent).toContain("本轮引用结果"); expect(dialog()?.textContent).not.toContain("上轮过期结果");
    expect(props.onJump).not.toHaveBeenCalled();
  });
  it.each(["disabled", "enabled"] as const)("旧preview在%s阶段完成，恢复后也不复活", async phase => {
    const pending = deferred<ReferencePreview>(), reference = link(); vi.mocked(props.previewLink!).mockReturnValue(pending.promise);
    await render(); await mouse(reference, "mouseover", 170, 50); expect(dialog()).not.toBeNull(); await render({ disabled: true });
    if (phase === "enabled") await render({ disabled: false });
    await act(async () => pending.resolve({ title: "旧引用", text: "旧结果" }));
    if (phase === "disabled") await render({ disabled: false });
    await flushFrames(); expect(dialog()).toBeNull(); expect(props.previewLink).toHaveBeenCalledOnce();
  });
  it("返回原identity后迟到preview失败只记日志，不恢复错误浮窗或覆盖新概念", async () => {
    const pending = deferred<ReferencePreview>(), reference = link(), bookA = props.book; vi.mocked(props.previewLink!).mockReturnValue(pending.promise);
    await render(); await mouse(reference, "mouseover", 170, 50); await render({ book: {} }); await render({ book: bookA });
    expect(dialog()).toBeNull(); await mouse(paragraph, "mousemove");
    const failure = new Error("旧书籍预览失败"); await act(async () => pending.reject(failure));
    expect(console.warn).toHaveBeenCalledWith("引用预览失败", failure); expect(dialog()?.textContent).toContain("中央与地方财政关系");
    expect(dialog()?.querySelector("header strong")?.textContent).toBe("财政体制");
    expect(dialog()?.textContent).not.toContain("引用正文不可用"); expect(props.onNotice).not.toHaveBeenCalled();
  });
  it.each(["concept", "history"] as const)("%s 标题有实际header文字，并作为dialog的无障碍名称", async kind => {
    const current = target(kind); await render(); await current.open(); const card = dialog()!, heading = card.querySelector("header strong")!;
    expect(heading.textContent).toBe(kind === "concept" ? "财政体制" : "句读历史");
    expect(heading.id).toBe(card.getAttribute("aria-labelledby")); expect(heading.hasAttribute("hidden")).toBe(false);
  });
});

describe("引用标题：真实文本、回退和不可信字符串", () => {
  it("真实引用标题去除首尾空白后显示，并成为dialog的无障碍名称", async () => {
    vi.mocked(props.previewLink!).mockResolvedValue({ title: "  引用的专属标题\n", text: "引用正文" }); const reference = link();
    await render(); await mouse(reference, "mouseover", 170, 50);
    const card = dialog()!, heading = card.querySelector("header strong")!;
    expect(heading.textContent).toBe("引用的专属标题"); expect(heading.id).toBe(card.getAttribute("aria-labelledby"));
    expect(card.textContent).toContain("引用正文");
  });
  it("读取中以引用预览为标题，完成后同一dialog更新为真实标题", async () => {
    const pending = deferred<ReferencePreview>(), reference = link(); vi.mocked(props.previewLink!).mockReturnValue(pending.promise);
    await render(); await mouse(reference, "mouseover", 170, 50); const card = dialog()!;
    expect(card.querySelector("header strong")?.textContent).toBe("引用预览");
    expect(card.querySelector('[role="status"]')?.textContent).toContain("正在读取引用");
    await act(async () => pending.resolve({ title: "已读取的标题", text: "读取完成的正文" }));
    expect(dialog()).toBe(card); expect(card.querySelector("header strong")?.textContent).toBe("已读取的标题");
    expect(card.querySelector('[role="status"]')).toBeNull(); expect(card.textContent).toContain("读取完成的正文");
  });
  it.each(["", "   ", "\n\t　"])("空白标题%j回退为引用预览，不隐藏已加载正文", async title => {
    vi.mocked(props.previewLink!).mockResolvedValue({ title, text: "无标题但有正文" }); const reference = link();
    await render(); await mouse(reference, "mouseover", 170, 50);
    expect(dialog()?.querySelector("header strong")?.textContent).toBe("引用预览");
    expect(dialog()?.textContent).toContain("无标题但有正文"); expect(dialog()?.querySelector('[role="status"]')).toBeNull();
  });
  it("书籍标题中的script和事件属性字符串只渲染为文本，不创建可执行节点", async () => {
    const title = '<script>window.open("https://example.invalid/script")</script><img src="https://example.invalid/pixel" onerror="alert(1)">';
    vi.mocked(props.previewLink!).mockResolvedValue({ title, text: "普通引用正文" }); const reference = link(), before = scope.innerHTML;
    await render(); await mouse(reference, "mouseover", 170, 50); const heading = dialog()!.querySelector("header strong")!;
    // WHY：直接断言文本和零元素节点，不能仅依靠jsdom默认不执行脚本来证明安全。
    expect(heading.textContent).toBe(title); expect(heading.childElementCount).toBe(0);
    expect(heading.childNodes).toHaveLength(1); expect(heading.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(dialog()?.querySelector("script,img,[onerror]")).toBeNull(); expect(scope.innerHTML).toBe(before);
    expect(fetch).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
  });
});
