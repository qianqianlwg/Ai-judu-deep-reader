// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageActions } from "./message-actions";

let root: Root; let container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const user = (content = "原始问题") => ({ id: "user-1", role: "user" as const, content });
const assistant = (content: string, extra: Record<string, unknown> = {}) => ({ id: "assistant-1", role: "assistant" as const, content, ...extra });

async function click(selector: string): Promise<void> { await act(async () => { container.querySelector<HTMLButtonElement>(selector)?.click(); }); }

describe("消息回溯编辑与复制", () => {
  it("编辑的是原始用户问题，不把助手答案写入编辑框", async () => {
    const onEdit = vi.fn();
    await act(() => { root.render(<><MessageActions message={user()} onEditMessage={onEdit} /><MessageActions message={assistant("助手答案")} /></>); });
    await click('[aria-label="编辑原始问题"]');
    const editor = container.querySelector<HTMLTextAreaElement>('[aria-label="编辑原始问题"]');
    expect(editor?.value).toBe("原始问题");
    expect(editor?.value).not.toBe("助手答案");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "修改后的原始问题"); editor!.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "修改后的原始问题" }));
    await click('button[type="submit"]');
    expect(onEdit).toHaveBeenCalledWith("user-1", "修改后的原始问题");
  });
  it("生成中禁止编辑，但不影响父任务提供停止按钮", async () => {
    const onEdit = vi.fn();
    await act(() => { root.render(<MessageActions message={user()} editingDisabled onEditMessage={onEdit} />); });
    const button = container.querySelector<HTMLButtonElement>('[aria-label="编辑原始问题"]');
    expect(button?.disabled).toBe(true); expect(container.querySelector("textarea")).toBeNull(); expect(onEdit).not.toHaveBeenCalled();
  });
  it("复制旧 JSON 句读时输出可读正文，不复制 JSON 外壳", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await act(() => { root.render(<MessageActions message={assistant(JSON.stringify({ summary: "主要观点", breakdown: [{ label: "论点", text: "原文说明" }], concepts: [{ name: "概念", text: "定义" }], context: "前文", uncertainty: "无" }), { outputFormat: "legacy-json" })} />); });
    await click('[aria-label="复制回答"]');
    const copied = writeText.mock.calls[0]?.[0] as string;
    expect(copied).toContain("主要观点"); expect(copied).toContain("论点：原文说明"); expect(copied).not.toContain('"summary"');
    expect(container.textContent).toContain("已复制");
  });
  it("复制失败显示可恢复错误", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("权限被拒绝")) } });
    await act(() => { root.render(<MessageActions message={assistant("可读回答")} />); });
    await click('[aria-label="复制回答"]');
    expect(container.textContent).toContain("权限被拒绝"); expect(container.querySelector('[role="status"]')).not.toBeNull();
  });
  it("空编辑内容不触发父回调", async () => {
    const onEdit = vi.fn(); await act(() => { root.render(<MessageActions message={user()} onEditMessage={onEdit} />); });
    await click('[aria-label="编辑原始问题"]'); const editor = container.querySelector<HTMLTextAreaElement>("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "   "); editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContent" })); await click('button[type="submit"]');
    expect(onEdit).not.toHaveBeenCalled(); expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });
});

it("用户问题可复制且有真实时间，编辑时原位替换气泡",async()=>{
 const writeText=vi.fn().mockResolvedValue(undefined),onEdit=vi.fn();Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});
 await act(()=>root.render(<MessageActions message={{...user(),createdAt:"2026-09-26T04:00:00Z"}} onEditMessage={onEdit}><div className="original-prompt">原始问题</div></MessageActions>));
 expect(container.querySelector('time')?.dateTime).toBe("2026-09-26T04:00:00.000Z");
 await click('[aria-label="复制问题"]');expect(writeText).toHaveBeenCalledWith("原始问题");
 await click('button[aria-label="编辑原始问题"]');expect(container.querySelector('.original-prompt')).toBeNull();expect(container.querySelectorAll('textarea')).toHaveLength(1);expect(document.activeElement).toBe(container.querySelector('textarea'));expect(container.querySelector('button[type="submit"]')?.textContent).toBe("发送");
 await act(()=>container.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(container.querySelector('textarea')).toBeNull();expect(container.querySelector('.original-prompt')?.textContent).toBe("原始问题");expect(onEdit).not.toHaveBeenCalled();expect(document.activeElement).toBe(container.querySelector('button[aria-label="编辑原始问题"]'));
});
it("Ctrl+Enter重新发送且生成中提交不能越过锁",async()=>{
 const onEdit=vi.fn();await act(()=>root.render(<MessageActions message={user()} onEditMessage={onEdit}/>));await click('button[aria-label="编辑原始问题"]');
 await act(()=>container.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true})));expect(onEdit).toHaveBeenCalledExactlyOnceWith('user-1','原始问题');expect(container.querySelector('textarea')).toBeNull();
 await click('button[aria-label="编辑原始问题"]');await act(()=>root.render(<MessageActions message={user()} editingDisabled onEditMessage={onEdit}/>));
 await act(()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(onEdit).toHaveBeenCalledOnce();expect(container.querySelector('textarea')?.disabled).toBe(true);
});
