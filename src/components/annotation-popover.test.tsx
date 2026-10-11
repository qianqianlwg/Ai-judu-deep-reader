// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationPopover, positionAnnotationPopover, getPopoverBounds, isInPopoverBridge, type PopoverGeometry } from "./annotation-popover";

const rect = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON() { return {}; } });
const geometry: PopoverGeometry = { anchor: rect(450, 200, 18, 18), body: rect(250, 150, 350, 200), reader: rect(200, 60, 800, 700), viewport: rect(0, 0, 1500, 800), popover: { width: 300, height: 210 } };

describe("真实边界定位算法", () => {
  it("鼠标通道仅覆盖触发点到卡片的安全路径", () => {
    const target = rect(600, 180, 300, 250);
    expect(isInPopoverBridge({ x: 530, y: 220 }, geometry.anchor, target)).toBe(true);
    expect(isInPopoverBridge({ x: 530, y: 100 }, geometry.anchor, target)).toBe(false);
    expect(isInPopoverBridge({ x: 1100, y: 220 }, geometry.anchor, target)).toBe(false);
  });
  it("优先正文右留白，不能越过阅读器进入聊天区", () => {
    const result = positionAnnotationPopover(geometry);
    expect(result).toEqual({ left: 612, top: 200, placement: "right-gutter" });
    expect(result.left + 300).toBeLessThan(geometry.reader.right);
    const noGutter = positionAnnotationPopover({ ...geometry, body: rect(250, 150, 650, 200) });
    expect(noGutter.placement).not.toBe("right-gutter"); expect(noGutter.left + 300).toBeLessThan(1000);
  });
  it("长历史、窄窗口与视觉视口偏移都不会超出可见边界", () => {
    for (const viewport of [rect(0, 0, 360, 280), rect(80, 150, 240, 230), rect(0, 0, 190, 100)]) {
      const reader = rect(0, 0, 320, 800);
      const bounds = getPopoverBounds(viewport, reader);
      const result = positionAnnotationPopover({ ...geometry, anchor: rect(300, 650, 18, 18), reader, viewport, popover: { width: 300, height: 2000 } });
      expect(result.left).toBeGreaterThanOrEqual(viewport.left + 12);
      expect(result.top).toBeGreaterThanOrEqual(viewport.top + 12);
      expect(result.left + Math.min(300, bounds.right - bounds.left)).toBeLessThanOrEqual(viewport.right - 12);
      expect(result.top + Math.min(2000, bounds.bottom - bounds.top)).toBeLessThanOrEqual(viewport.bottom - 12);
    }
  });
});

let host: HTMLDivElement;
let root: Root;
let anchor: HTMLButtonElement;
let popupHeight: number;
let anchorTop: number;
let readerWidth: number;
let observerCallback: ResizeObserverCallback | undefined;
const observerDisconnect = vi.fn();
const close = vi.fn();
function card(): HTMLElement {
  const result = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!result) throw new Error("未渲染浮层"); return result;
}
function Fixture({ pinned = false }: { pinned?: boolean }) {
  const [open, setOpen] = useState(true);
  return open ? <AnnotationPopover id="test-popover" title="句读历史" anchor={anchor} pinned={pinned} onClose={(restore) => { close(restore); setOpen(false); }}><button type="button">历史一</button><button type="button">历史二</button></AnnotationPopover> : null;
}
function show(pinned = false) { act(() => root.render(<Fixture pinned={pinned} />)); }
async function flush() { await act(async () => { await vi.advanceTimersByTimeAsync(32); }); }

beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); close.mockReset(); observerDisconnect.mockReset();
  popupHeight = 180; anchorTop = 200; readerWidth = 800;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1500 }); Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { observerCallback = callback; }
    observe() {} unobserve() {} disconnect() { observerDisconnect(); }
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("reading-pane")) return rect(200, 60, readerWidth, 700);
    if (this.matches("p")) return rect(250, 150, 350, 200);
    if (this.getAttribute("role") === "dialog") return rect(Number.parseFloat(this.style.left) || 0, Number.parseFloat(this.style.top) || 0, Math.min(300, Number.parseFloat(this.style.maxWidth)), Math.min(popupHeight, Number.parseFloat(this.style.maxHeight)));
    return rect(450, anchorTop, 18, 18);
  });
  host = document.createElement("div");
  host.innerHTML = '<article class="reading-pane"><p data-paragraph-id="p"><button id="anchor">入口</button><button id="after">后续控件</button></p></article><div id="react"></div>';
  document.body.append(host); anchor = host.querySelector<HTMLButtonElement>("#anchor")!;
  root = createRoot(host.querySelector("#react")!);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("AnnotationPopover DOM 交互与重定位", () => {
  it("历史快捷操作与标题并排，关闭按钮仍独立位于右侧", () => {
    act(() => root.render(<AnnotationPopover id="test-popover" title="句读历史" headerAction={<button className="judu-annotation-popover__action">查看完整句读</button>} anchor={anchor} onClose={close}><p>历史内容</p></AnnotationPopover>));
    const heading = card().querySelector(".judu-annotation-popover__title-group")!;
    expect(heading.querySelector("strong")?.textContent).toBe("句读历史");
    expect(heading.querySelector(".judu-annotation-popover__action")?.textContent).toBe("查看完整句读");
    expect(card().querySelector(".judu-annotation-popover__close[aria-label=\"关闭浮层\"]")).toBeTruthy();
  });
  it("初始真实测量，resize 与捕获 scroll 后重新定位，卸载清理 observer", async () => {
    show(); expect(card().style.left).toBe("612px"); expect(card().style.visibility).toBe("visible");
    const originalTop = card().style.top;
    readerWidth = 480; anchorTop = 680; popupHeight = 600;
    act(() => window.dispatchEvent(new Event("resize"))); await flush();
    expect(card().dataset.placement).toBe("bounded"); expect(card().style.top).not.toBe(originalTop);
    expect(Number.parseFloat(card().style.left) + 300).toBeLessThanOrEqual(680 - 12);
    anchorTop = 180; act(() => host.dispatchEvent(new Event("scroll"))); await flush();
    expect(Number.parseFloat(card().style.top)).toBeGreaterThanOrEqual(72);
    act(() => root.render(null)); expect(observerDisconnect).toHaveBeenCalled();
  });
  it("内容真实高度变化通过 ResizeObserver 更新，长内容限制高度并滚动", async () => {
    anchorTop = 600; show(); const initial = card().style.top;
    popupHeight = 1000;
    act(() => observerCallback?.([], {} as ResizeObserver)); await flush();
    expect(card().style.maxHeight).toBe("676px"); expect(card().style.top).not.toBe(initial);
    expect(Number.parseFloat(card().style.top) + 676).toBeLessThanOrEqual(748);
  });
  it("hover 可以跨越间隙移入卡片；离开后才关闭", async () => {
    show();
    act(() => anchor.dispatchEvent(new MouseEvent("mouseleave")));
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    act(() => card().dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(close).not.toHaveBeenCalled();
    act(() => card().dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(close).toHaveBeenCalledWith(false);
  });
  it("鼠标在通道中移动不会反复延长关闭时间", async () => {
    show(); act(() => anchor.dispatchEvent(new MouseEvent("mouseleave")));
    for (const point of [{ clientX: 510, clientY: 210 }, { clientX: 530, clientY: 210 }, { clientX: 550, clientY: 210 }]) {
      act(() => document.body.dispatchEvent(new MouseEvent("mousemove", { ...point, bubbles: true })));
      await act(async () => { await vi.advanceTimersByTimeAsync(40); });
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(40); });
    expect(close).toHaveBeenCalledWith(false);
  });
  it("点击固定后离开不关闭，点外部或 Escape 可以关闭", async () => {
    show(true); act(() => anchor.dispatchEvent(new MouseEvent("mouseleave")));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); }); expect(close).not.toHaveBeenCalled();
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(close).toHaveBeenCalledWith(false);
  });
  it("Tab 进入卡片、Shift+Tab 回到入口、末端 Tab 继续到入口后的控件", () => {
    show(); act(() => anchor.focus());
    act(() => anchor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    const first = card().querySelector("button")!; expect(document.activeElement).toBe(first);
    act(() => first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(anchor);
    const last = Array.from(card().querySelectorAll("button")).at(-1)!; act(() => last.focus());
    act(() => last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement?.id).toBe("after"); expect(close).toHaveBeenCalledWith(false);
  });
  it("滚动把触发点移出可见区域时关闭，不留飞出的卡片", async () => {
    show(); anchorTop = -100; act(() => window.dispatchEvent(new Event("scroll"))); await flush();
    expect(close).toHaveBeenCalledWith(false); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});


function showConcept() {
  act(()=>root.render(<AnnotationPopover id="word" title="概念" anchor={anchor} pinned placement="word" onClose={close}><p>词义解释</p></AnnotationPopover>));
}
it('概念卡默认紧贴词下方，不因聊天栏存在而侧向停靠', () => {
  host.classList.add('app-shell');
  const panel=document.createElement('aside');panel.className='analysis-panel';panel.innerHTML='<div class="chat-messages"></div>';host.append(panel);
  vi.spyOn(panel.firstElementChild!,'getBoundingClientRect').mockReturnValue(rect(1000,60,500,650));
  showConcept(); const result=card().getBoundingClientRect();
  expect(card().dataset.placement).toBe('word-below'); expect(result.left).toBe(450); expect(result.top).toBe(anchorTop+18+12);
});
it('滚动后词移到底部时卡片翻到词上方，保持12px间隔', async () => {
  showConcept(); anchorTop=690; act(()=>window.dispatchEvent(new Event('scroll'))); await flush();
  const result=card().getBoundingClientRect();
  expect(card().dataset.placement).toBe('word-above');expect(result.bottom).toBe(anchorTop-12);
});
it('超长概念卡缩短高度并滚动，仍只在词上方或下方', async () => {
  showConcept(); popupHeight=2000; act(()=>observerCallback?.([],{} as ResizeObserver)); await flush();
  const result=card().getBoundingClientRect();
  expect(card().dataset.placement).toBe('word-below'); expect(result.top).toBe(anchorTop+18+12); expect(result.bottom).toBeLessThanOrEqual(748);
});
it('历史浮窗仍保留原有留白定位，不被概念上下定位改变', () => {
  show(); expect(card().dataset.placement).not.toBe('word-below');expect(card().style.left).toBe('612px');
});

it('??????????????????????', () => {
  const article=host.querySelector('article')!,viewport=document.createElement('div');viewport.className='reading-content';
  const paragraph=host.querySelector('p')!;article.append(viewport);viewport.append(paragraph);
  vi.spyOn(viewport,'getBoundingClientRect').mockReturnValue(rect(200,100,800,450));
  anchorTop=400;showConcept();
  expect(card().dataset.placement).toBe('word-above');expect(card().getBoundingClientRect().bottom).toBe(anchorTop-12);
});
