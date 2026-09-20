// @vitest-environment jsdom
import { act, createRef, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanelResizer, type ChatPanelResizerProps } from "./chat-panel-resizer";

let root: Root;
let host: HTMLDivElement;
let containerWidth: number;
let narrow: boolean;
let resize: () => void;
let mediaChange: (() => void) | undefined;
const disconnect = vi.fn();
const onWidthChange = vi.fn<(width: number) => void>();
const storageKey = "reader-chat-panel-width";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  containerWidth = 1400;
  narrow = false;
  window.localStorage.clear();
  onWidthChange.mockClear();
  disconnect.mockClear();
  host = document.createElement("div");
  host.className = "reader-layout";
  host.getBoundingClientRect = () => ({ width: containerWidth, height: 800, x: 0, y: 0, top: 0, left: 0, right: containerWidth, bottom: 800, toJSON: () => ({}) });
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = disconnect;
  });
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    get matches() { return narrow; },
    addEventListener: (_event: string, listener: () => void) => { mediaChange = listener; },
    removeEventListener: () => { mediaChange = undefined; },
  })));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(props: Partial<ChatPanelResizerProps> = {}) {
  await act(() => root.render(<ChatPanelResizer onWidthChange={onWidthChange} {...props} />));
}
function handle() { return host.querySelector<HTMLDivElement>('[role="separator"]')!; }
function width() { return Number(handle().getAttribute("aria-valuenow")); }
async function key(value: string, shiftKey = false) {
  await act(() => handle().dispatchEvent(new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true })));
}
async function pointer(type: string, x: number, target: EventTarget = window, id = 1, button = 0, primary = true) {
  const event = new MouseEvent(type, { clientX: x, button, bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: primary } });
  await act(() => target.dispatchEvent(event));
}
async function doubleClick() { await act(() => handle().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))); }

describe("ChatPanelResizer", () => {
  it("默认宽度 390、最小 300、容器上限与可访问属性", async () => {
    await render({ controlsId: "chat" });
    expect(width()).toBe(390);
    expect(onWidthChange).toHaveBeenLastCalledWith(390);
    expect(handle().getAttribute("aria-valuemin")).toBe("300");
    expect(handle().getAttribute("aria-valuemax")).toBe("800");
    expect(handle().getAttribute("aria-orientation")).toBe("vertical");
    expect(handle().getAttribute("aria-controls")).toBe("chat");
    expect(handle().tabIndex).toBe(0);
  });

  it("向左增宽、向右缩小，拖出把手仍有效且受上下限限制", async () => {
    await render();
    await pointer("pointerdown", 1000, handle());
    await pointer("pointermove", 900);
    expect(width()).toBe(490);
    expect(document.activeElement).toBe(handle());
    await pointer("pointermove", 200);
    expect(width()).toBe(800);
    await pointer("pointermove", 1400);
    expect(width()).toBe(300);
    await pointer("pointerup", 1400);
    await pointer("pointermove", 900);
    expect(width()).toBe(300);
    expect(localStorage.getItem(storageKey)).toBe("300");
  });

  it("忽略右键、非主指针与不同 pointerId", async () => {
    await render();
    await pointer("pointerdown", 1000, handle(), 1, 2);
    await pointer("pointermove", 900);
    expect(width()).toBe(390);
    await pointer("pointerdown", 1000, handle(), 2, 0, false);
    await pointer("pointermove", 900, window, 2);
    expect(width()).toBe(390);
    await pointer("pointerdown", 1000, handle());
    await pointer("pointermove", 900, window, 2);
    await pointer("pointerup", 900, window, 2);
    expect(width()).toBe(390);
    await pointer("pointermove", 900);
    expect(width()).toBe(490);
  });

  it.each(["pointercancel", "blur"])("%s 终止拖动", async (event) => {
    await render();
    await pointer("pointerdown", 1000, handle());
    await pointer(event, 1000);
    await pointer("pointermove", 800);
    expect(width()).toBe(390);
  });

  it("键盘左右、Shift 加速、Home、End、双击复位并持久化", async () => {
    await render();
    await key("ArrowLeft"); expect(width()).toBe(400);
    await key("ArrowRight"); expect(width()).toBe(390);
    await key("ArrowLeft", true); expect(width()).toBe(440);
    await key("Home"); expect(width()).toBe(300);
    await key("ArrowRight"); expect(width()).toBe(300);
    await key("End"); expect(width()).toBe(800);
    await key("ArrowLeft"); expect(width()).toBe(800);
    await key("Enter"); expect(width()).toBe(800);
    await doubleClick(); expect(width()).toBe(390);
    expect(localStorage.getItem(storageKey)).toBe("390");
  });

  it("读取自定义存储键并在重新挂载后恢复", async () => {
    localStorage.setItem("custom-width", "520");
    await render({ storageKey: "custom-width" });
    expect(width()).toBe(520);
    await key("ArrowLeft");
    await act(() => root.render(null));
    await render({ storageKey: "custom-width" });
    expect(width()).toBe(530);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it.each(["", " ", "NaN", "Infinity", "abc", "-10", "299", '{"width":500}'])("安全忽略无效存储值 %s", async (stored) => {
    localStorage.setItem(storageKey, stored);
    await render();
    expect(width()).toBe(390);
  });

  it("显式 containerRef 与宿主最大值回调优先，回调不能突破容器", async () => {
    const containerRef = createRef<HTMLDivElement>();
    containerRef.current = document.createElement("div");
    containerRef.current.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 700);
    const getMaxWidth = vi.fn((size: number) => size - 450);
    await render({ containerRef, getMaxWidth });
    expect(getMaxWidth).toHaveBeenCalledWith(1000);
    await key("End"); expect(width()).toBe(550);
    await render({ containerRef, getMaxWidth: () => 5000 });
    await key("End"); expect(width()).toBe(1000);
  });

  it("没有 reader-layout 时回退父容器，自定义保留宽度", async () => {
    host.className = "";
    await render({ minRemainingWidth: 700 });
    await key("End"); expect(width()).toBe(700);
  });

  it("容器变化重算上限，不覆盖偏好；空间恢复后恢复宽度", async () => {
    localStorage.setItem(storageKey, "750");
    await render();
    containerWidth = 1100;
    await act(() => resize());
    expect(width()).toBe(500);
    expect(onWidthChange).toHaveBeenLastCalledWith(500);
    expect(localStorage.getItem(storageKey)).toBe("750");
    containerWidth = 1400;
    await act(() => window.dispatchEvent(new Event("resize")));
    expect(width()).toBe(750);
  });

  it("复位仍受宿主上限约束", async () => {
    await render({ getMaxWidth: () => 350 });
    await key("Home");
    await doubleClick();
    expect(width()).toBe(350);
  });

  it("窄屏隐藏、不可聚焦且禁止修改；宽屏恢复", async () => {
    await render();
    await pointer("pointerdown", 1000, handle());
    narrow = true;
    await act(() => mediaChange?.());
    expect(handle().hidden).toBe(true);
    expect(handle().tabIndex).toBe(-1);
    await pointer("pointermove", 800);
    await key("End");
    await doubleClick();
    expect(width()).toBe(390);
    expect(localStorage.getItem(storageKey)).toBeNull();
    narrow = false;
    await act(() => mediaChange?.());
    expect(handle().hidden).toBe(false);
    expect(handle().tabIndex).toBe(0);
  });

  it("容器可用空间低于 300 时隐藏，ARIA 上下限仍合法", async () => {
    containerWidth = 800;
    await render();
    expect(handle().hidden).toBe(true);
    expect(width()).toBe(300);
    expect(handle().getAttribute("aria-valuemax")).toBe("300");
  });

  it("非有限最大值回退安全容器约束", async () => {
    await render({ getMaxWidth: () => Number.NaN });
    await key("End"); expect(width()).toBe(800);
  });

  it("存储读取失败记录错误并提示，恢复后继续使用", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    await render();
    expect(width()).toBe(390);
    expect(warn).toHaveBeenCalled();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("本次仍可调整");
    read.mockRestore();
    await key("ArrowLeft");
    expect(width()).toBe(400);
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("存储写入失败不阻断调整且显示反馈", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    await render();
    await key("ArrowLeft");
    expect(width()).toBe(400);
    expect(onWidthChange).toHaveBeenLastCalledWith(400);
    expect(host.querySelector('[role="status"]')).not.toBeNull();
  });

  it("回调更新后使用最新函数，不重置当前宽度", async () => {
    await render();
    await key("ArrowLeft");
    const updated = vi.fn();
    await render({ onWidthChange: updated });
    expect(width()).toBe(400);
    await key("ArrowLeft");
    expect(updated).toHaveBeenLastCalledWith(410);
  });

  it("StrictMode 正常运行且卸载清理观察器和全局拖动监听", async () => {
    await act(() => root.render(<StrictMode><ChatPanelResizer onWidthChange={onWidthChange} /></StrictMode>));
    await pointer("pointerdown", 1000, handle());
    await act(() => root.render(null));
    const calls = onWidthChange.mock.calls.length;
    await pointer("pointermove", 800);
    await act(() => window.dispatchEvent(new Event("resize")));
    expect(onWidthChange).toHaveBeenCalledTimes(calls);
    expect(disconnect).toHaveBeenCalled();
    expect(mediaChange).toBeUndefined();
  });

  it("matchMedia 与 ResizeObserver 缺失时回退视口宽度及 resize", async () => {
    vi.stubGlobal("matchMedia", undefined);
    vi.stubGlobal("ResizeObserver", undefined);
    vi.stubGlobal("innerWidth", 1280);
    await render();
    expect(handle().hidden).toBe(false);
    vi.stubGlobal("innerWidth", 900);
    await act(() => window.dispatchEvent(new Event("resize")));
    expect(handle().hidden).toBe(true);
    vi.stubGlobal("innerWidth", 1200);
    containerWidth = 1100;
    await act(() => window.dispatchEvent(new Event("resize")));
    expect(handle().hidden).toBe(false);
    await key("End");
    expect(width()).toBe(500);
  });

  it("SSR 不访问 localStorage 或触发宿主回调", () => {
    const read = vi.spyOn(Storage.prototype, "getItem");
    const html = renderToString(<ChatPanelResizer onWidthChange={onWidthChange} />);
    expect(html).toContain('aria-valuenow="390"');
    expect(read).not.toHaveBeenCalled();
    expect(onWidthChange).not.toHaveBeenCalled();
  });
});


it("拖动命中区域透明，不将主题强调色绘成整条分隔带",async()=>{
 const {readFile}=await import('node:fs/promises');
 const css=await readFile('src/components/chat-panel-resizer.module.css','utf8');
 const global=await readFile('src/app/globals.css','utf8');
 expect(css).toContain('background: transparent');expect(css).toContain('width: 1px');
 expect(global).not.toMatch(/\.workspace-chat-resizer\s*\{[^}]*background:\s*var\(--reading-accent/);
});
