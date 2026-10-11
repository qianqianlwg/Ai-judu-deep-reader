// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReaderPageJump } from "./reader-page-jump";
let host: HTMLDivElement, root: Root;
const jump = vi.fn();
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host=document.createElement("div"); document.body.append(host); root=createRoot(host); jump.mockReset(); });
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(current=1,total=100,disabled=false,chapter=false) { await act(() => root.render(<ReaderPageJump current={current} total={total} disabled={disabled} chapter={chapter} onJump={jump}/>)); }
async function open() { await act(() => host.querySelector<HTMLButtonElement>("button")!.click()); }
async function type(value:string) { await act(() => { const input=document.querySelector("input")!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value); input.dispatchEvent(new Event("input",{bubbles:true})); }); }
async function submit() { await act(() => document.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))); }
it("输入过程中不翻页，提交后才跳转到完整页码", async () => { await render(); await open(); await type("25"); expect(jump).not.toHaveBeenCalled(); await submit(); expect(jump).toHaveBeenCalledWith(25); });
it.each(["", "0", "101", "-1", "1.5", "abc", "1e2"])("拒绝无效页码 %s 并显示反馈", async value => { await render(); await open(); await type(value); await submit(); expect(jump).not.toHaveBeenCalled(); expect(document.querySelector('[role="alert"]')?.textContent).toContain("1 到 100"); });
it("不可用或未取得页数时不能提交", async () => { await render(0,0); await open(); expect(jump).not.toHaveBeenCalled(); expect(host.querySelector("button")!.disabled).toBe(true); expect(document.querySelector("input")).toBeNull(); await render(1,10,true); await open(); expect(jump).not.toHaveBeenCalled(); });
it("主动导航后显示最新页码，流式书籍明确标为本章页码", async () => { await render(); await render(8,50,false,true); expect(document.querySelector("input")).toBeNull(); await open(); expect(document.querySelector("input")!.value).toBe("8"); expect(document.querySelector("input")!.getAttribute("aria-label")).toBe("本章页码"); expect(document.body.textContent).toContain("本章屏幕页"); });

it("平时只显示进度，打开浮层后自动选中页码，Escape取消不跳转", async () => {
 await render(8,100);expect(host.textContent).toBe("8 / 100");expect(document.querySelector("form")).toBeNull();await open();
 const input=document.querySelector("input")!;expect(document.activeElement).toBe(input);expect(input.selectionStart).toBe(0);expect(input.selectionEnd).toBe(1);
 await act(()=>input.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));expect(document.querySelector("form")).toBeNull();expect(jump).not.toHaveBeenCalled();expect(document.activeElement).toBe(host.querySelector("button"));
});
it("点击浮层外部关闭，不触发跳转",async()=>{await render();await open();await act(()=>document.body.dispatchEvent(new Event("pointerdown",{bubbles:true})));expect(document.querySelector("form")).toBeNull();expect(jump).not.toHaveBeenCalled();});
