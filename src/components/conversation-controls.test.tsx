// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationControls, type ConversationControlsProps } from "./conversation-controls";
const conversation = (id: string, title: string, editionId = "e1") => ({ id, title, editionId, bookId: "same-book", createdAt: "2025-01-01", updatedAt: "2025-01-01", messageCount: 2 });
const items = [conversation("t1", "承认问题"), conversation("t2", "工具与认识"), conversation("foreign", "另一个版本", "e2")];
let container: HTMLDivElement; let root: Root;
const render = async (props: Partial<ConversationControlsProps> = {}) => { await act(async () => root.render(<ConversationControls conversations={items} editionId="e1" activeThreadId="t1" {...props} />)); };
const byLabel = (label: string) => container.querySelector<HTMLButtonElement>('button[aria-label="' + label + '"]')!;
const byText = (text: string) => [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === text)!;
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
async function input(label: string, value: string) {
  const element = container.querySelector<HTMLInputElement>('input[aria-label="' + label + '"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("ConversationControls 受控多会话交互", () => {
  it("展示当前名称、按版本列历史，点击选择回调而不隐式 fetch", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const onSelectConversation = vi.fn();
    await render({ onSelectConversation });
    expect(byLabel("切换会话").textContent).toContain("承认问题");
    await click(byLabel("切换会话"));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).not.toContain("另一个版本");
    const choices = container.querySelectorAll("li button");
    expect(choices).toHaveLength(2);
    expect(choices[0].getAttribute("aria-current")).toBe("true");
    await click(choices[1] as HTMLElement);
    expect(onSelectConversation).toHaveBeenCalledWith("t2");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("搜索过滤、选择当前会话不重复请求", async () => {
    const select = vi.fn();
    await render({ onSelectConversation: select }); await click(byLabel("切换会话"));
    await input("搜索会话", "承认");
    expect(container.querySelectorAll("li")).toHaveLength(1);
    await click(container.querySelector("li button")!);
    expect(select).not.toHaveBeenCalled();
  });
  it("新建异步执行时同步锁挡住同帧双击并禁用切换", async () => {
    let finish!: () => void;
    const create = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    await render({ onNewConversation: create });
    await act(async () => { byLabel("新建会话").click(); byLabel("新建会话").click(); });
    expect(create).toHaveBeenCalledOnce();
    expect(byLabel("新建会话").disabled).toBe(true);
    expect(byLabel("切换会话").disabled).toBe(true);
    await act(async () => finish());
    expect(byLabel("新建会话").disabled).toBe(false);
  });
  it("支持重命名并提交原 id 和修剪后的名称", async () => {
    const rename = vi.fn();
    await render({ onRenameConversation: rename }); await click(byLabel("切换会话")); await click(byText("重命名当前会话"));
    await input("会话名称", "  对承认的讨论  ");
    await click(byText("保存"));
    expect(rename).toHaveBeenCalledWith("t1", "对承认的讨论");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
  it("非法名称与保存失败有明确错误，不能静默吞掉", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rename = vi.fn().mockRejectedValue(new Error("保存失败，请重试"));
    await render({ onRenameConversation: rename }); await click(byLabel("切换会话")); await click(byText("重命名当前会话"));
    await input("会话名称", " "); await click(byText("保存"));
    expect(rename).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("1–80");
    await input("会话名称", "合法名称"); await click(byText("保存"));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("保存失败");
    expect(log).toHaveBeenCalled();
  });
  it("生成状态即使在菜单已展开时到来，也禁止选择、新建和重命名", async () => {
    const select = vi.fn(); const create = vi.fn(); const rename = vi.fn();
    const props = { onSelectConversation: select, onNewConversation: create, onRenameConversation: rename };
    await render(props); await click(byLabel("切换会话")); await render({ ...props, busy: true });
    for (const button of container.querySelectorAll("button")) { expect(button.disabled).toBe(true); await click(button); }
    expect(select).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(rename).not.toHaveBeenCalled();
  });
  it("Escape 和点击外部关闭弹层，反复打开不累计监听", async () => {
    const add = vi.spyOn(document, "addEventListener"); const remove = vi.spyOn(document, "removeEventListener");
    await render(); await click(byLabel("切换会话"));
    await act(async () => container.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(byLabel("切换会话"));
    await click(byLabel("切换会话"));
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(add.mock.calls.filter(([event]) => event === "pointerdown").length).toBe(remove.mock.calls.filter(([event]) => event === "pointerdown").length);
  });
  it("空列表给出新建入口，不擅自增加删除功能", async () => {
    await render({ conversations: [], onNewConversation: vi.fn() }); await click(byLabel("切换会话"));
    expect(container.textContent).toContain("暂无会话");
    expect(container.textContent).not.toContain("删除");
  });
});
