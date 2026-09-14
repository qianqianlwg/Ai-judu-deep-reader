// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageAnchor } from "@/lib/chat-stream";
import { AnalysisPanel, type Analysis, type PanelMessage } from "./analysis-panel";

type Props = Parameters<typeof AnalysisPanel>[0];
let container: HTMLDivElement;
let root: Root;
let metrics = { height: 900, client: 300, top: 600 };
let frames: Map<number, FrameRequestCallback>;
let frameId = 0;
const callbacks = { onClose: vi.fn(), onBack: vi.fn() };
const analysis: Analysis = { summary: "这句话说明分工能够提高生产效率。", breakdown: [{ label: "前提", text: "每个人专门从事一种工作。" }], concepts: [{ name: "分工", text: "把生产过程拆分为不同任务。" }], context: "本段承接前文。", uncertainty: "基于当前段落。" };
const anchor = (text = "认识是通向绝对的工具或媒介。", paragraphId = "p1"): MessageAnchor => ({ paragraphId, startOffset: 3, endOffset: 3 + text.length, selectedText: text });
const render = async (props: Partial<Props> = {}) => { await act(async () => { root.render(<AnalysisPanel selected="" analysis={null} loading={false} {...callbacks} {...props} />); }); };
const viewport = () => container.querySelector<HTMLDivElement>('[data-testid="chat-messages"]')!;
const latest = () => container.querySelector<HTMLButtonElement>('[data-testid="latest-message-button"]')!;
const message = (id: string) => container.querySelector<HTMLElement>('[data-message-id="' + id + '"]')!;
const labelledButton = (name: string) => container.querySelector<HTMLButtonElement>('button[aria-label="' + name + '"]')!;
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function scroll(top: number) { metrics.top = top; await act(async () => viewport().dispatchEvent(new Event("scroll"))); }
async function flushFrames() { await act(async () => { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(performance.now()); }); }

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", undefined);
  frames = new Map(); frameId = 0; metrics = { height: 900, client: 300, top: 600 };
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  // WHY：只模拟浏览器几何，测试真实 React effect、事件、details、消息 DOM 复用；不再直接调用组件函数。
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) { return this.getAttribute("data-testid") === "chat-messages" ? metrics.height : 0; });
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) { return this.getAttribute("data-testid") === "chat-messages" ? metrics.client : 0; });
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) { return this.getAttribute("data-testid") === "chat-messages" ? metrics.top : 0; });
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (this: Element, value) { if (this.getAttribute("data-testid") === "chat-messages") metrics.top = Math.max(0, Math.min(value, metrics.height - metrics.client)); });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("AnalysisPanel 消息、选文与失败状态", () => {
  it("保持原面板接口和可访问的空状态", async () => {
    await render();
    expect(container.querySelector("aside")?.className).toBe("analysis-panel");
    expect(container.textContent).toContain("选择原文开始句读");
    expect(viewport().getAttribute("role")).toBe("log");
    await click(labelledButton("关闭句读面板"));
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });
  it("JSON 流只显示友好文本，普通聊天原样呈现；加载输入禁用", async () => {
    await render({ loading: true, messages: [{ id: "a1", role: "assistant", kind: "analysis", status: "streaming", content: '{"summary":"认识如何改变对象","breakdown":[' }, { id: "a2", role: "assistant", kind: "chat", status: "streaming", content: "自然追问回答" }] });
    expect(message("a1").textContent).toContain("认识如何改变对象");
    expect(message("a1").textContent).not.toContain('"summary"');
    expect(message("a1").querySelector('[data-streaming-format="friendly-preview"]')).not.toBeNull();
    expect(message("a2").textContent).toContain("自然追问回答");
    expect(container.querySelector("textarea")?.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("正在生成");
  });
  it("用户每条消息携带各自折叠选文，不使用当前 selected 冒充历史原文", async () => {
    const first = anchor();
    const second = anchor("另一个自我意识通过相互承认得到确认。", "p2");
    await render({ selected: "当前另选的第三段", messages: [{ id: "u1", role: "user", content: "请句读这一段", anchor: first }, { id: "u2", role: "user", content: "请句读这一段", anchor: second }] });
    expect(message("u1").textContent).toContain(first.selectedText);
    expect(message("u1").textContent).not.toContain(second.selectedText);
    expect(message("u2").textContent).toContain(second.selectedText);
    expect(container.textContent).not.toContain("当前另选的第三段");
    const details = message("u1").querySelector("details")!;
    expect(details.open).toBe(false);
    await click(details.querySelector("summary")!);
    expect(details.open).toBe(true);
    expect(details.querySelector("blockquote")?.textContent).toBe(first.selectedText);
    await click(details.querySelector("summary")!);
    expect(details.open).toBe(false);
  });
  it("user 和 assistant 的定位入口都传递完整 MessageAnchor", async () => {
    const onOpenSource = vi.fn();
    const source = anchor();
    await render({ onOpenSource, messages: [{ id: "u1", role: "user", content: "请句读这一段", anchor: source }, { id: "a1", role: "assistant", kind: "analysis", content: "回答", analysis, status: "completed", anchor: source }] });
    await click(labelledButton("定位本次选文"));
    await click(labelledButton("定位句读原文"));
    expect(onOpenSource.mock.calls).toEqual([[source], [source]]);
  });
  it("旧 onOpenCitation 接口仍能定位本次选文，携带当前消息 ID", async () => {
    const onOpenCitation = vi.fn();
    const source = anchor();
    await render({ onOpenCitation, messages: [{ id: "u1", role: "user", content: "请句读这一段", anchor: source }] });
    await click(labelledButton("定位本次选文"));
    expect(onOpenCitation).toHaveBeenCalledWith("p1", source.selectedText, "u1");
  });
  it("可读取服务端 Analysis.anchor，但旧消息无锚点不猜选区", async () => {
    const source = anchor();
    const saved = { ...analysis, anchor: source };
    await render({ selected: source.selectedText, messages: [{ id: "a1", role: "assistant", kind: "analysis", content: "答案", analysis: saved }, { id: "old", role: "user", content: "请句读这一段" }] });
    expect(message("a1").querySelector('[data-source-paragraph="p1"]')).not.toBeNull();
    expect(message("old").querySelector('[data-testid="message-source"]')).toBeNull();
  });
  it("非法锚点不显示假跳转，缺少回调时入口明确禁用", async () => {
    await render({ messages: [{ id: "bad", role: "user", content: "请句读", anchor: { ...anchor(), endOffset: 999 } }, { id: "valid", role: "user", content: "请句读", anchor: anchor() }] });
    expect(message("bad").querySelector('[data-testid="message-source"]')).toBeNull();
    expect(message("valid").querySelector("button")?.disabled).toBe(true);
  });
  it("failed _request 元数据不是 Analysis，不 crash，也不转成新的 onSend", async () => {
    const metadata = { _request: { input: { selectedText: "旧的未验证选文" }, failure: { code: "upstream_failed" } } };
    const onRetry = vi.fn(); const onSend = vi.fn();
    await render({ error: "连接中断", selected: "当前其他原文", onRetry, onSend, analysis: metadata as unknown as Analysis, messages: [{ id: "u1", role: "user", content: "请句读这一段" }, { id: "a1", role: "assistant", kind: "analysis", content: '{"summary":"部分解释', analysis: metadata as unknown as Analysis, status: "error" }] });
    expect(message("a1").textContent).toContain("部分解释");
    expect(message("a1").textContent).toContain("生成未完成");
    expect(message("a1").textContent).not.toContain("旧的未验证选文");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("连接中断");
    await click(container.querySelector<HTMLButtonElement>('[role="alert"] button')!);
    expect(onRetry).toHaveBeenCalledOnce(); expect(onSend).not.toHaveBeenCalled();
    expect(viewport().dataset.messageCount).toBe("2");
  });
  it("只有 error 没有重试 handler 时禁用重试，不以 selected 创建新消息", async () => {
    const onSend = vi.fn();
    await render({ error: "失败", selected: "原文", onSend });
    const retry = container.querySelector<HTMLButtonElement>('[role="alert"] button')!;
    expect(retry.disabled).toBe(true);
    await click(retry);
    expect(onSend).not.toHaveBeenCalled();
  });
  it("结构化内容与原始输出折叠保留，坏 citations 不使面板崩溃", async () => {
    const source = { sourceId: "book:p1", paragraphId: "p1", quote: "原文引用" };
    const withCitations = { ...analysis, citations: [null, source] } as unknown as Analysis;
    const onOpenCitation = vi.fn();
    await render({ onOpenCitation, messages: [{ id: "a1", role: "assistant", kind: "analysis", content: JSON.stringify(analysis), analysis: withCitations, status: "completed" }] });
    expect(message("a1").textContent).toContain("句子拆解");
    expect(message("a1").textContent).toContain("关键概念");
    const raw = message("a1").querySelector<HTMLDetailsElement>("details.raw-output")!;
    expect(raw.open).toBe(false);
    await click(raw.querySelector("summary")!);
    expect(raw.open).toBe(true);
    expect(raw.querySelector("pre")?.textContent).toBe(JSON.stringify(analysis));
    await click(message("a1").querySelector<HTMLButtonElement>(".citation-link")!);
    expect(onOpenCitation).toHaveBeenCalledWith("p1", "原文引用", "a1");
  });
  it("中文输入法确认与 Shift+Enter 不误发，普通 Enter 发送并清空", async () => {
    const onSend = vi.fn();
    await render({ onSend });
    const input = container.querySelector("textarea")!;
    input.value = "  继续解释承认  ";
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", isComposing: true })));
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", shiftKey: true })));
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })));
    expect(onSend).toHaveBeenCalledWith("继续解释承认");
    expect(input.value).toBe("");
  });
});

describe("AnalysisPanel 真 DOM 的滚动和消息复用", () => {
  const messages = (content: string): PanelMessage[] => [{ id: "u1", role: "user", content: "请句读这一段", anchor: anchor() }, { id: "a1", role: "assistant", kind: "chat", status: "streaming", content }];
  it("同一 assistant 增量保持两个消息 DOM 节点，底部用户自动跟随", async () => {
    await render({ loading: true, messages: messages("第一段") });
    const user = message("u1"); const assistant = message("a1");
    metrics.height = 1300;
    await render({ loading: true, messages: messages("第一段，第二段") });
    expect(viewport().dataset.messageCount).toBe("2");
    expect(container.querySelectorAll("[data-message-id]")).toHaveLength(2);
    expect(message("u1")).toBe(user); expect(message("a1")).toBe(assistant);
    expect(metrics.top).toBe(1000);
  });
  it("拖动至历史后不被同条增量弹回，latest 实际按钮一击到底", async () => {
    await render({ loading: true, messages: messages("开始") });
    await scroll(150);
    metrics.height = 1200;
    await render({ loading: true, messages: messages("开始，后续内容") });
    expect(metrics.top).toBe(150);
    expect(latest().hidden).toBe(false);
    await click(latest());
    expect(metrics.top).toBe(900);
    await flushFrames();
    expect(latest().hidden).toBe(true);
    metrics.height = 1500;
    await render({ loading: true, messages: messages("继续生成") });
    expect(metrics.top).toBe(1200);
  });
  it("展开本次选文暂停追随，窗口变化不抢正在查看的原文", async () => {
    await render({ loading: true, messages: messages("生成中") });
    await click(message("u1").querySelector("summary")!);
    metrics.height = 1300;
    await act(async () => window.dispatchEvent(new Event("resize")));
    await flushFrames();
    await render({ loading: true, messages: messages("生成中，新增") });
    expect(metrics.top).toBe(600);
    expect(message("u1").querySelector("details")?.open).toBe(true);
  });
  it("样式隔离：latest 在独立消息区域中，不被全局固定 bottom 和 hidden 规则覆盖", async () => {
    await render({ className: "custom-panel", messages: messages("内容") });
    expect(latest().classList.contains("latest-message-button")).toBe(false);
    expect(latest().parentElement).toBe(viewport().parentElement);
    const css = await readFile("src/components/analysis-panel.module.css", "utf8");
    expect(css).toContain(".latestButton[hidden] { display: none; }");
    expect(css).toContain("overflow-anchor: none");
    expect(css).toContain("pointer-events: auto");
  });
});
