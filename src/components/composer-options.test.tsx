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
    expect(host.textContent).toContain("知识库 · 未接通"); expect(host.textContent).toContain("文献引用 · 未接通");
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
    await act(async () => { buttons.find(button => button.textContent?.startsWith("插件"))?.click(); buttons.find(button => button.textContent?.startsWith("引用"))?.click(); });
    expect(onPluginSelect).toHaveBeenCalledWith("knowledge-base"); expect(onCitationSelect).toHaveBeenCalledTimes(1);
  });
  it("运行中禁用加号和菜单内操作", async () => {
    await act(() => root.render(<ComposerOptions disabled modelOptions={["模型A"]} />));
    const plus = host.querySelector<HTMLButtonElement>('[aria-label="打开插件和引用菜单"]'); expect(plus?.disabled).toBe(true); expect(host.querySelector('[role="menu"]')).toBeNull();
  });
});
