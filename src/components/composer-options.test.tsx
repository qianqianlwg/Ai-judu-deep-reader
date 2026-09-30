// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerOptions, type ReasoningEffort } from "./composer-options";
let root: Root; let host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const clickLabel = async (label: string) => act(async () => { Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.getAttribute("aria-label") === label)?.click(); });

describe("聊天输入框选项", () => {
  it("加号菜单显示插件、引用未接通状态和选择控件", async () => {
    await act(() => root.render(<ComposerOptions modelName="模型A" modelOptions={["模型A", "模型B"]} />));
    await clickLabel("打开插件和引用菜单");
    expect(host.textContent).toContain("知识库 · 未接通"); expect(host.querySelectorAll('[role="menu"] button[role="menuitem"] svg')).toHaveLength(2); expect(host.textContent).toContain("文献引用 · 未接通");
    expect(host.querySelector('[aria-label="选择模型"]')).not.toBeNull(); expect(host.querySelector('[aria-label="选择思考强度"]')).not.toBeNull();
  });
  it("模型和思考强度通过回调传出，纯前端不保存服务端配置", async () => {
    const onModelChange = vi.fn(), onReasoningChange = vi.fn<(value: ReasoningEffort) => void>();
    await act(() => root.render(<ComposerOptions modelOptions={["模型A", "模型B"]} onModelChange={onModelChange} onReasoningChange={onReasoningChange} />));
    await clickLabel("打开插件和引用菜单");
    await act(async () => { const control = host.querySelector<HTMLSelectElement>('[aria-label="选择模型"]')!; control.value = "模型B"; control.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { const control = host.querySelector<HTMLSelectElement>('[aria-label="选择思考强度"]')!; control.value = "high"; control.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onModelChange).toHaveBeenCalledWith("模型B"); expect(onReasoningChange).toHaveBeenCalledWith("high");
  });
  it("插件和引用回调可选，未提供时仅显示未接通提示", async () => {
    const onPluginSelect = vi.fn(), onCitationSelect = vi.fn();
    await act(() => root.render(<ComposerOptions onPluginSelect={onPluginSelect} onCitationSelect={onCitationSelect} />)); await clickLabel("打开插件和引用菜单");
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>("button"));
    await act(async () => { buttons.find(button => button.textContent?.startsWith("本地插件"))?.click(); buttons.find(button => button.textContent?.startsWith("引用"))?.click(); });
    expect(onPluginSelect).toHaveBeenCalledWith("knowledge-base"); expect(onCitationSelect).toHaveBeenCalledTimes(1);
  });
  it("发送后菜单自动收起；运行中仍可按 + 打开查看并收起，设置只读", async () => {
    const preferences = { openalex: true, crossref: true, web: true };
    const change = vi.fn();
    await act(() => root.render(<ComposerOptions key="ready" modelOptions={["模型A"]} externalPermissions={preferences} onExternalPermissionsChange={change} />));
    await clickLabel("打开插件和引用菜单");
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    await act(() => root.render(<ComposerOptions key="busy" disabled modelOptions={["模型A"]} externalPermissions={preferences} onExternalPermissionsChange={change} />));
    const plus = host.querySelector<HTMLButtonElement>('[aria-label="打开插件和引用菜单"]')!;
    expect(plus.disabled).toBe(false); expect(host.querySelector('[role="menu"]')).toBeNull();
    await clickLabel("打开插件和引用菜单");
    expect(host.textContent).toContain("设置暂不可用");
    expect(Array.from(host.querySelectorAll('[role="menu"] button')).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(Array.from(host.querySelectorAll('[role="menu"] input')).every(input => (input as HTMLInputElement).disabled)).toBe(true);
    await clickLabel("打开插件和引用菜单");
    expect(host.querySelector('[role="menu"]')).toBeNull(); expect(change).not.toHaveBeenCalled();
  });
  it("本书关联检索须明确打开，生成时保持只读并披露向量查询", async () => {
    const change = vi.fn();
    await act(() => root.render(<ComposerOptions bookContextPrefetch={false} onBookContextPrefetchChange={change} />));
    await clickLabel("打开插件和引用菜单");
    const checkbox = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(input => input.parentElement?.textContent?.includes("句读前关联本书原文"));
    expect(checkbox?.checked).toBe(false); expect(host.textContent).toContain("裁剪选文发送至向量服务");
    await act(async () => checkbox?.click()); expect(change).toHaveBeenCalledWith(true);
    await act(() => root.render(<ComposerOptions bookContextPrefetch disabled onBookContextPrefetchChange={change} />));
    expect(Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))[0].disabled).toBe(true);
  });
});

it("加号菜单不再重复提供已迁移的解读设置",async()=>{await act(async()=>root.render(<ComposerOptions readingPreferences={{difficulty:'normal',detail:'standard'}} onReadingPreferencesChange={()=>{}}/>));await clickLabel('打开插件和引用菜单');expect(host.querySelector('[aria-label="解读方式"]')).toBeNull();expect(host.querySelector('[aria-label="回复长度"]')).toBeNull();});

it("生成中可以调整下一轮模型，提示设置不影响当前轮", async () => {
  const onModelChange = vi.fn();
  await act(async () => root.render(<ComposerOptions generating modelOptions={["模型A", "模型B"]} selectedModel="模型A" onModelChange={onModelChange} />));
  await clickLabel("打开插件和引用菜单"); expect(host.textContent).toContain("下一轮生效");
  const select = host.querySelector<HTMLSelectElement>('[aria-label="选择模型"]')!;
  expect(select.disabled).toBe(false);
  await act(async () => { select.value = "模型B"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(onModelChange).toHaveBeenCalledWith("模型B");
});
