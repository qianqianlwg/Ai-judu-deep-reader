// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatFollow } from "./use-chat-follow";

let container: HTMLDivElement;
let root: Root;
let mounted = true;
let metrics = { height: 900, client: 300, top: 600 };
let frames = new Map<number, FrameRequestCallback>();
let serial = 0;
let writes: number[] = [];
let observers: Observer[] = [];
class Observer implements ResizeObserver {
  readonly targets = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) { observers.push(this); }
  observe(element: Element) { this.targets.add(element); }
  unobserve(element: Element) { this.targets.delete(element); }
  disconnect() { this.targets.clear(); }
  notify() { if (this.targets.size) this.callback([], this); }
}
function Harness({ generating = true, revision = "first", conversationKey }: { generating?: boolean; revision?: string; conversationKey?: string }) {
  const { viewportRef, contentRef, showLatest, jumpToLatest } = useChatFollow(generating, revision, conversationKey);
  return <div><div ref={viewportRef} data-testid="viewport" tabIndex={0}><div ref={contentRef}>{revision}</div></div>
    <button data-testid="latest" hidden={!showLatest} onClick={jumpToLatest}>最新</button><input aria-label="输入框" /></div>;
}
const viewport = () => container.querySelector<HTMLDivElement>('[data-testid="viewport"]')!;
const button = () => container.querySelector<HTMLButtonElement>('[data-testid="latest"]')!;
const render = async (generating = true, revision = "first", strict = false) => { await act(async () => { root.render(strict ? <StrictMode><Harness generating={generating} revision={revision} /></StrictMode> : <Harness generating={generating} revision={revision} />); }); };
async function event(element: EventTarget, value: Event) { await act(async () => { element.dispatchEvent(value); }); }
async function scroll(top: number) { metrics.top = top; await event(viewport(), new Event("scroll")); }
async function flushFrames() { await act(async () => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(performance.now()); }); }
async function resize() { await act(async () => { for (const observer of observers) observer.notify(); window.dispatchEvent(new Event("resize")); }); await flushFrames(); }

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  metrics = { height: 900, client: 300, top: 600 }; writes = []; frames = new Map(); serial = 0; observers = []; mounted = true;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++serial, callback); return serial; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  vi.stubGlobal("ResizeObserver", Observer);
  // WHY：jsdom 不做排版，只替换几何读数；React commit/effect、原生事件、清理和 DOM 点击均实际执行。
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) { return this.getAttribute("data-testid") === "viewport" ? metrics.height : 0; });
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) { return this.getAttribute("data-testid") === "viewport" ? metrics.client : 0; });
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) { return this.getAttribute("data-testid") === "viewport" ? metrics.top : 0; });
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (this: Element, value) { if (this.getAttribute("data-testid") === "viewport") { metrics.top = Math.max(0, Math.min(value, metrics.height - metrics.client)); writes.push(value); } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { if (mounted) await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("useChatFollow 真实 React 滚动意图", () => {
  it("在底部时随同一条消息的增量触底，不依赖消息数量增加", async () => {
    await render();
    expect(metrics.top).toBe(600);
    metrics.height = 1200;
    await render(true, "同一条消息新增内容");
    expect(metrics.top).toBe(900);
    expect(button().hidden).toBe(true);
    expect(viewport().dataset.followLatest).toBe("true");
  });
  it("滚上去后增量、ResizeObserver 和窗口 resize 都不抢位置", async () => {
    await render();
    await event(viewport(), new WheelEvent("wheel", { deltaY: -80 }));
    await scroll(210);
    const count = writes.length;
    metrics.height = 1400;
    await render(true, "追加内容");
    metrics.client = 250;
    await resize();
    expect(metrics.top).toBe(210);
    expect(writes).toHaveLength(count);
    expect(button().hidden).toBe(false);
    expect(viewport().dataset.followLatest).toBe("false");
  });
  it("拖动滚动条期间先暂停跟随，松手后也不弹回", async () => {
    await render();
    await event(viewport(), new Event("pointerdown"));
    const count = writes.length;
    metrics.height = 1150;
    await render(true, "拖拽时新增");
    expect(writes).toHaveLength(count);
    await scroll(180);
    await event(window, new Event("pointerup"));
    metrics.height = 1350;
    await render(true, "拖拽后新增");
    expect(metrics.top).toBe(180);
    expect(button().hidden).toBe(false);
  });
  it("只拖动滚动条触发 scroll、没有 wheel 也能取消跟随", async () => {
    await render();
    await scroll(300);
    metrics.height += 400;
    await render(true, "新增");
    expect(metrics.top).toBe(300);
  });
  it("latest 一次点击立即到真底部并复核一次新布局，不使用 smooth", async () => {
    metrics.top = 100;
    await render(false);
    expect(button().hidden).toBe(false);
    await act(async () => button().click());
    expect(metrics.top).toBe(600);
    metrics.height = 1100;
    await flushFrames();
    expect(metrics.top).toBe(800);
    expect(button().hidden).toBe(true);
    expect(frames.size).toBe(0);
  });
  it("latest 的待执行复核被后续上滚取消，不反抢用户", async () => {
    metrics.top = 100;
    await render(false);
    await act(async () => button().click());
    await scroll(240);
    metrics.height = 1300;
    await flushFrames();
    expect(metrics.top).toBe(240);
    expect(frames.size).toBe(0);
  });
  it("输入框 focus 和非生成期 resize 不会锁住或恢复历史位置", async () => {
    metrics.top = 100;
    await render(false);
    await act(async () => button().click()); await flushFrames();
    await scroll(170);
    await act(async () => container.querySelector("input")!.focus());
    metrics.client = 240;
    await resize();
    expect(metrics.top).toBe(170);
    await scroll(420);
    await render(false, "普通 UI 重渲染");
    expect(metrics.top).toBe(420);
  });
  it("用户主动滚回底部后恢复生成跟随", async () => {
    await render();
    await scroll(100);
    await scroll(600);
    metrics.height = 1400;
    await render(true, "用户继续看最新");
    expect(metrics.top).toBe(1100);
  });
  it("非生成期追加内容不自动滚动，结束生成的最后一次排版可跟随", async () => {
    await render();
    metrics.height = 1200;
    await render(false, "完成后的结构化内容");
    expect(metrics.top).toBe(900);
    metrics.height = 1500;
    await render(false, "非生成期其他内容变化");
    expect(metrics.top).toBe(900);
    expect(button().hidden).toBe(false);
  });
  it("键盘上翻在增量到达前表达暂停意图", async () => {
    await render();
    await event(viewport(), new KeyboardEvent("keydown", { key: "PageUp" }));
    metrics.height = 1200;
    await render(true, "新字");
    expect(metrics.top).toBe(600);
  });
  it("切换会话取消上一会话 latest 的延后滚动，不把跟随状态带过去", async () => {
    metrics.top = 100;
    await act(async () => root.render(<Harness generating={false} conversationKey="t1" />));
    await act(async () => button().click());
    expect(frames.size).toBe(1);
    metrics.top = 150;
    await act(async () => root.render(<Harness generating={false} conversationKey="t2" revision="第二会话" />));
    expect(frames.size).toBe(0);
    metrics.height = 1500;
    await flushFrames();
    expect(metrics.top).toBe(150);
  });
  it("StrictMode 重挂载与连续渲染不累计 listener，卸载清理 observer 和 RAF", async () => {
    const add = vi.spyOn(EventTarget.prototype, "addEventListener");
    const remove = vi.spyOn(EventTarget.prototype, "removeEventListener");
    const windowAdd = vi.spyOn(window, "addEventListener");
    const windowRemove = vi.spyOn(window, "removeEventListener");
    await render(true, "first", true);
    const element = viewport();
    for (let index = 0; index < 6; index++) await render(true, "增量" + index, true);
    const activeCount = (type: string, target: EventTarget) => add.mock.calls.filter((call, index) => call[0] === type && add.mock.contexts[index] === target).length
      - remove.mock.calls.filter((call, index) => call[0] === type && remove.mock.contexts[index] === target).length;
    expect(activeCount("scroll", element)).toBe(1);
    expect(activeCount("wheel", element)).toBe(1);
    expect(windowAdd.mock.calls.filter(([type]) => type === "resize").length - windowRemove.mock.calls.filter(([type]) => type === "resize").length).toBe(1);
    expect(observers.filter((observer) => observer.targets.size > 0)).toHaveLength(1);
    await act(async () => button().click());
    expect(frames.size).toBe(1);
    await act(async () => root.unmount()); mounted = false;
    expect(activeCount("scroll", element)).toBe(0);
    expect(activeCount("wheel", element)).toBe(0);
    expect(windowAdd.mock.calls.filter(([type]) => type === "resize").length - windowRemove.mock.calls.filter(([type]) => type === "resize").length).toBe(0);
    expect(observers.every((observer) => observer.targets.size === 0)).toBe(true);
    expect(frames.size).toBe(0);
    const count = writes.length;
    element.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    expect(writes).toHaveLength(count);
  });
});
