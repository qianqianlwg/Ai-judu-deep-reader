// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/chat-stream";
import { MAX_CHAT_MESSAGE_WINDOW, useChatHistoryWindow } from "./use-chat-history-window";

type Props = { messages: ChatMessage[]; conversationKey: string; historyLoading?: boolean; targetId?: string | null };
let container: HTMLDivElement;
let root: Root;
let scrollTop = 0;

function Harness({ messages, conversationKey, historyLoading = false, targetId }: Props) {
  const state = useChatHistoryWindow(messages, conversationKey, historyLoading, targetId);
  const { viewportRef, contentRef, startIndex, visibleMessages, hasOlder, hasNewer, loadEarlier, loadNewer } = state;
  return <div ref={viewportRef} data-testid="chat" data-window-start={startIndex} data-visible-count={visibleMessages.length}>
    <div ref={contentRef}>{visibleMessages.map(({ message, index }) => <article data-message-index={index} data-message-id={message.id} key={message.id}>{message.content}</article>)}</div>
    <button data-testid="older" disabled={!hasOlder} onClick={loadEarlier}>older</button>
    <button data-testid="newer" disabled={!hasNewer} onClick={loadNewer}>newer</button>
  </div>;
}
const messages = (count: number): ChatMessage[] => Array.from({ length: count }, (_, index) => ({ id: `m${index}`, role: "user", content: `message-${index}` }));
const viewport = () => container.querySelector<HTMLDivElement>('[data-testid="chat"]')!;
const firstMessageIndex = () => Number(container.querySelector<HTMLElement>("[data-message-index]")?.dataset.messageIndex);
const visibleCount = () => Number(viewport().dataset.visibleCount);
async function render(props: Props) { await act(async () => root.render(<Harness {...props} />)); }
async function click(testId: string) { await act(async () => container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click()); }

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  scrollTop = 0;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
    return this.getAttribute("data-testid") === "chat" ? Number(this.getAttribute("data-visible-count")) * 100 : 0;
  });
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) { return this.getAttribute("data-testid") === "chat" ? 500 : 0; });
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) { return this.getAttribute("data-testid") === "chat" ? scrollTop : 0; });
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (this: Element, value) { if (this.getAttribute("data-testid") === "chat") scrollTop = value; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute("data-testid") === "chat") return new DOMRect(0, 100, 400, 500);
    if (this.hasAttribute("data-message-index")) {
      const index = Number(this.dataset.messageIndex), start = Number(viewport().dataset.windowStart);
      return new DOMRect(0, 100 + (index - start) * 100 - scrollTop, 400, 80);
    }
    return new DOMRect(0, 0, 0, 0);
  });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("会话首次只渲染最新 30 条，旧消息入口可见", async () => {
  await render({ messages: messages(100), conversationKey: "thread-a" });
  expect(visibleCount()).toBe(30);
  expect(firstMessageIndex()).toBe(70);
  expect(container.querySelector<HTMLButtonElement>('[data-testid="older"]')?.disabled).toBe(false);
  expect(container.querySelector('[data-message-index="69"]')).toBeNull();
});

it("显式加载较早消息后最多渲染 60 条，并保持原首条消息的屏幕位置", async () => {
  await render({ messages: messages(100), conversationKey: "thread-a" });
  const oldFirst = container.querySelector<HTMLElement>('[data-message-index="70"]')!.getBoundingClientRect().top;
  await click("older");
  expect(visibleCount()).toBe(50);
  expect(firstMessageIndex()).toBe(50);
  expect(container.querySelector<HTMLElement>('[data-message-index="70"]')!.getBoundingClientRect().top).toBe(oldFirst);
  await click("older");
  expect(visibleCount()).toBe(MAX_CHAT_MESSAGE_WINDOW);
  await click("older");
  expect(visibleCount()).toBe(MAX_CHAT_MESSAGE_WINDOW);
  expect(firstMessageIndex()).toBe(20);
});

it("只有用户向上滚到窗口顶部才自动加载，不因初始挂载或程序定位自动展开", async () => {
  await render({ messages: messages(100), conversationKey: "thread-a" });
  expect(firstMessageIndex()).toBe(70);
  await act(async () => { viewport().dispatchEvent(new WheelEvent("wheel", { deltaY: -80 })); });
  expect(firstMessageIndex()).toBe(50);
  expect(visibleCount()).toBe(50);
});

it("新会话加载完成后重置到新历史的最新窗口", async () => {
  await render({ messages: messages(100), conversationKey: "thread-a" });
  await click("older");
  await render({ messages: [], conversationKey: "thread-b", historyLoading: true });
  expect(visibleCount()).toBe(0);
  await render({ messages: messages(42), conversationKey: "thread-b" });
  expect(firstMessageIndex()).toBe(12);
  expect(visibleCount()).toBe(30);
});

it("历史定位可按需挂载未显示的旧消息并完成定位", async () => {
  await render({ messages: messages(100), conversationKey: "thread-a", targetId: "m10" });
  expect(firstMessageIndex()).toBe(0);
  expect(visibleCount()).toBe(MAX_CHAT_MESSAGE_WINDOW);
  expect(container.querySelector('[data-message-id="m10"]')).not.toBeNull();
});

it("已删除或不属于当前会话的目标不会改写当前窗口", async () => {
  await render({ messages: messages(4), conversationKey: "thread-a", targetId: "missing" });
  expect(visibleCount()).toBe(4);
  expect(container.querySelector("[data-message-id=\"missing\"]")).toBeNull();
});

it("does not load for a programmatic top position or while the user is away from the history edge", async () => {
  await render({ messages: messages(100), conversationKey: "thread-a" });
  await act(async () => { scrollTop = 0; viewport().dispatchEvent(new Event("scroll")); });
  expect(firstMessageIndex()).toBe(70);
  await act(async () => {
    scrollTop = 180;
    viewport().dispatchEvent(new WheelEvent("wheel", { deltaY: -90 }));
    scrollTop = 120;
    viewport().dispatchEvent(new Event("scroll"));
  });
  expect(firstMessageIndex()).toBe(70);
  await act(async () => { scrollTop = 0; viewport().dispatchEvent(new WheelEvent("wheel", { deltaY: -90 })); });
  expect(firstMessageIndex()).toBe(50);
});

it("用户主动滚到历史窗口底部时加载后续消息，渲染窗口仍有上限", async () => {
  await render({ messages: messages(100), conversationKey: "thread-a", targetId: "m10" });
  expect(firstMessageIndex()).toBe(0);
  expect(visibleCount()).toBe(MAX_CHAT_MESSAGE_WINDOW);
  await act(async () => {
    scrollTop = 5_500;
    viewport().dispatchEvent(new WheelEvent("wheel", { deltaY: 120 }));
  });
  expect(firstMessageIndex()).toBe(20);
  expect(visibleCount()).toBe(MAX_CHAT_MESSAGE_WINDOW);
  expect(container.querySelector('[data-message-index="79"]')).not.toBeNull();
  expect(container.querySelector('[data-message-index="80"]')).toBeNull();
});