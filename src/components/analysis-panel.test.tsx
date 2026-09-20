// @vitest-environment jsdom
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageAnchor } from "@/lib/chat-stream";
import { applyReadingRequest, beginReadingRequest, createReadingRequest, executeReadingRequest, type ReadingRequestState } from "@/lib/reading-request";
import styles from "./analysis-panel.module.css";
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
    expect(container.querySelector("aside")?.classList.contains("analysis-panel")).toBe(true);
    expect(container.textContent).toContain("选择原文开始句读");
    expect(viewport().getAttribute("role")).toBe("log");
    await click(labelledButton("关闭句读面板"));
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });
  it("JSON 流只显示友好文本，普通聊天原样呈现；加载输入禁用", async () => {
    await render({ loading: true, messages: [{ id: "a1", role: "assistant", kind: "analysis", outputFormat: "legacy-json", status: "streaming", content: '{"summary":"认识如何改变对象","breakdown":[' }, { id: "a2", role: "assistant", kind: "chat", status: "streaming", content: "自然追问回答" }] });
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
    await render({ onOpenCitation, messages: [{ id: "a1", role: "assistant", kind: "analysis", content: JSON.stringify(analysis), analysis: withCitations, outputFormat: "legacy-json", status: "completed" }] });
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


describe("第四阶段：正常回复、工具结果与 Token footer", () => {
  const usage = { inputTokens: 30000, outputTokens: 20000, totalTokens: 50000, cachedInputTokens: 12000, contextTokens: 20000, contextWindow: 100000, source: "provider" as const };
  it("新回复从流式到完成始终是同一份 Markdown，analysis 只追加折叠工具卡", async () => {
    const base: PanelMessage = { id: "a1", role: "assistant", kind: "analysis", outputFormat: "text", content: "## 回答\n\n这是一段**普通解释**。", status: "streaming" };
    await render({ loading: true, messages: [base] });
    const body = message("a1").querySelector('[data-output-format="text"]')!;
    expect(body.querySelector("strong")?.textContent).toBe("普通解释");
    await render({ messages: [{ ...base, status: "completed", analysis }] });
    expect(message("a1").querySelector('[data-output-format="text"]')).toBe(body);
    expect(body.textContent).toContain("这是一段普通解释");
    expect(body.textContent).not.toContain(analysis.summary);
    const record = message("a1").querySelector<HTMLDetailsElement>('[data-testid="analysis-record"]')!;
    expect(record.open).toBe(false);
    await click(record.querySelector("summary")!);
    expect(record.open).toBe(true);
    expect(record.textContent).toContain(analysis.summary);
    expect(container.querySelectorAll("[data-message-id]")).toHaveLength(1);
  });
  it("text 和未标记的新消息即便含 JSON 字面量，也绝不做 summary 提取", async () => {
    const content = '{"summary":"这是应原样展示的内容","value":1}';
    await render({ messages: [{ id: "a1", role: "assistant", kind: "analysis", outputFormat: "text", status: "streaming", content }, { id: "a2", role: "assistant", kind: "analysis", status: "completed", content }] });
    for (const id of ["a1", "a2"]) {
      expect(message(id).querySelector('[data-output-format="text"]')?.textContent).toContain('"summary"');
      expect(message(id).querySelector('[data-streaming-format="friendly-preview"]')).toBeNull();
    }
  });
  it("工具状态增量、结果和 warning 独立展示，不把 JSON 填进回复", async () => {
    const base: PanelMessage = { id: "a1", role: "assistant", outputFormat: "text", content: "正常回答", status: "streaming", tools: [{ id: "call-1", name: "search_book", status: "running" }] };
    await render({ messages: [base] });
    const tool = message("a1").querySelector<HTMLDetailsElement>('[data-tool-id="call-1"]')!;
    expect(tool.querySelector("summary")?.textContent).toContain("执行中");
    await render({ messages: [{ ...base, status: "completed", tools: [{ id: "call-1", name: "search_book", status: "completed", result: { ok: true, sources: [{ sourceId: "book:e1:paragraph:p1", paragraphId: "p1", text: "仅工具结果里的原文" }] } }], warnings: ["本轮检索结果有限"] }] });
    expect(message("a1").querySelector('[data-tool-id="call-1"]')).toBe(tool);
    expect(tool.querySelector("summary")?.textContent).toContain("已完成");
    expect(tool.open).toBe(false);
    expect(message("a1").querySelector('[data-output-format="text"]')?.textContent).toBe("正常回答");
    expect(message("a1").querySelector('[data-testid="message-warning"]')?.textContent).toContain("本轮检索结果有限");
    await click(tool.querySelector("summary")!);
    expect(tool.querySelector("pre")).toBeNull();
    expect(tool.textContent).toContain("仅工具结果里的原文");
    expect(viewport().dataset.messageCount).toBe("1");
  });
  it("Markdown 支持表格和列表，不允许原始 HTML 或 javascript 链接执行", async () => {
    const content = "- 一\n- 二\n\n|概念|解释|\n|---|---|\n|承认|关系|\n\n<script>window.bad=true</script>\n\n[危险](javascript:alert(1))";
    await render({ messages: [{ id: "a1", role: "assistant", outputFormat: "text", content }] });
    expect(message("a1").querySelectorAll("li")).toHaveLength(2);
    expect(message("a1").querySelector("table")).not.toBeNull();
    expect(message("a1").querySelector("script")).toBeNull();
    expect(message("a1").querySelector("a")?.getAttribute("href")).not.toContain("javascript:");
  });
  it("footer 显示当前模型、真实 context/window 和本轮各项用量，不把累计 tokens 当窗口占用", async () => {
    await render({ modelName: "当前模型", usage });
    const footer = container.querySelector('[data-testid="usage-footer"]')!;
    expect(footer.textContent).toContain("当前模型");
    expect(footer.querySelector("summary")?.textContent).toContain("20k / 100k");
    expect(footer.querySelector("summary")?.textContent).not.toContain("50k /");
    expect(footer.querySelector("summary")?.textContent).toContain("服务端统计");
    await click(footer.querySelector("summary")!);
    expect([...footer.querySelectorAll("dt")].map((item) => item.textContent)).toEqual(["上下文占用", "本轮输入", "本轮输出", "缓存读取", "本轮合计"]);
    expect([...footer.querySelectorAll("dd")].map((item) => item.textContent)).toEqual(["20,000 / 100,000", "30,000", "20,000", "12,000", "50,000"]);
  });
  it("估算、缺少 cached 数据和未知窗口明确标记，不虚构值", async () => {
    await render({ usage: { ...usage, source: "estimated", cachedInputTokens: undefined, contextWindow: 0 } });
    const footer = container.querySelector('[data-testid="usage-footer"]')!;
    expect(footer.querySelector("summary")?.textContent).toContain("≈");
    expect(footer.querySelector("summary")?.textContent).toContain("估算");
    expect(footer.textContent).toContain("窗口未配置");
    expect(footer.textContent).toContain("未返回");
    expect(footer.textContent).toContain("不是实际计费数据");
  });
  it("新一轮尚无统计时不沿用上一条 assistant 的账单", async () => {
    await render({ messages: [{ id: "old", role: "assistant", content: "旧回答", usage, status: "completed" }, { id: "new", role: "assistant", outputFormat: "text", content: "", status: "streaming" }] });
    const footer = container.querySelector('[data-testid="usage-footer"]')!;
    expect(footer.querySelector("summary")?.textContent).toContain("用量待返回");
    expect(footer.querySelector("summary")?.textContent).not.toContain("20k");
  });
  it("Header 回调接到 page，生成/加载期间不能新建切换；切线程清空输入框", async () => {
    const conversations = [{ id: "t1", title: "第一会话", editionId: "e1", bookId: "b1", createdAt: "2025-01-01", updatedAt: "2025-01-01", messageCount: 0 }];
    const onNewConversation = vi.fn(); const onSelectConversation = vi.fn();
    const props = { conversations, activeThreadId: "t1", editionId: "e1", onNewConversation, onSelectConversation };
    await render(props);
    expect(labelledButton("切换会话").textContent).toContain("第一会话");
    await click(labelledButton("新建会话")); expect(onNewConversation).toHaveBeenCalledOnce();
    container.querySelector("textarea")!.value = "旧会话草稿";
    await render({ ...props, activeThreadId: "t2" });
    expect(container.querySelector("textarea")!.value).toBe("");
    await render({ ...props, conversationsLoading: true });
    expect(labelledButton("新建会话").disabled).toBe(true);
    expect(labelledButton("切换会话").disabled).toBe(true);
    expect(container.querySelector("textarea")?.disabled).toBe(true);
    expect(container.textContent).toContain("正在读取会话");
  });
});


describe("工具结果可读呈现与停止生成", () => {
  it("检索出处卡显示章节/摘录，定位调用当前消息 id；普通回复不替换", async () => {
    const onOpenCitation = vi.fn(); const quote = "作为工具的认识可能改变它的对象。";
    await render({ onOpenCitation, messages: [{ id: "a1", role: "assistant", outputFormat: "text", content: "正常回复仍然存在", status: "completed", tools: [{ id: "tool-1", name: "read_source", status: "completed", result: { ok: true, sources: [{ sourceId: "book:e1:paragraph:p1", paragraphId: "p1", chapterId: "c1", chapterTitle: "导论", text: quote }] } }] }] });
    const tool = message("a1").querySelector<HTMLDetailsElement>('[data-tool-id="tool-1"]')!;
    await click(tool.querySelector("summary")!);
    expect(tool.textContent).toContain("导论"); expect(tool.textContent).toContain(quote);
    expect(tool.querySelector("pre")).toBeNull();
    await click(tool.querySelector<HTMLButtonElement>('[aria-label="定位检索原文"]')!);
    expect(onOpenCitation).toHaveBeenCalledWith("p1", quote, "a1");
    expect(message("a1").querySelector('[data-output-format="text"]')?.textContent).toBe("正常回复仍然存在");
  });
  it("save_reading_analysis 只提示已保存，Analysis 只在上方句读记录内展示一次", async () => {
    await render({ messages: [{ id: "a1", role: "assistant", outputFormat: "text", content: "这是一段自然解释。", analysis, status: "completed", tools: [{ id: "save-1", name: "save_reading_analysis", status: "completed", result: { ok: true, analysisId: "a1", saved: true, locationAvailable: true, result: analysis } }] }] });
    const tool = message("a1").querySelector<HTMLDetailsElement>('[data-tool-id="save-1"]')!;
    await click(tool.querySelector("summary")!);
    expect(tool.textContent).toContain("句读已保存");
    expect(tool.textContent).not.toContain(analysis.summary);
    expect(tool.querySelector("pre")).toBeNull();
    expect(message("a1").querySelectorAll('[data-testid="analysis-record"]')).toHaveLength(1);
  });
  it("未知工具结果仍在折叠卡里，不进入 Markdown 正文", async () => {
    await render({ messages: [{ id: "a1", role: "assistant", outputFormat: "text", content: "回复", tools: [{ id: "unknown", name: "future_tool", status: "completed", result: { useful: "未知结构" } }] }] });
    const tool = message("a1").querySelector<HTMLDetailsElement>('[data-tool-id="unknown"]')!;
    expect(tool.open).toBe(false); expect(tool.querySelector("pre")?.textContent).toContain("未知结构");
    expect(message("a1").querySelector('[data-output-format="text"]')?.textContent).toBe("回复");
  });
  it("停止按钮实际 abort 执行器，保留部分回复并允许原两条消息重试", async () => {
    const ids = ["user-1", "assistant-1"];
    const original = createReadingRequest({ threadId: "t1", mode: "chat", question: "解释承认", selectedText: "" }, () => ids.shift()!);
    const started = beginReadingRequest(original, []);
    let state = started.state; let messages = started.messages;
    const abort = new AbortController(); const cancelled = vi.fn(); const onSend = vi.fn();
    const onStop = vi.fn(() => abort.abort());
    const onRetry = vi.fn(() => { const next = beginReadingRequest(state, messages); messages = next.messages; paint(next.state); });
    function paint(next: ReadingRequestState) {
      state = next; messages = applyReadingRequest(messages, state);
      root.render(<AnalysisPanel selected="" analysis={null} loading={state.status === "streaming"} error={state.error} messages={messages} {...callbacks} onStop={onStop} onRetry={onRetry} onSend={onSend} />);
    }
    const wire = 'event: meta\ndata: {"threadId":"t1","messageId":"assistant-1"}\n\nevent: raw_delta\ndata: {"text":"已收到的部分回复"}\n\n';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(wire)); }, cancel: cancelled })));
    let execution!: Promise<ReadingRequestState>;
    await act(async () => { paint(started.state); execution = executeReadingRequest(started.state, { fetcher, signal: abort.signal, onState: paint }); });
    expect(labelledButton("停止生成").disabled).toBe(false);
    expect(message("assistant-1").textContent).toContain("已收到的部分回复");
    await act(async () => { labelledButton("停止生成").click(); state = await execution; });
    expect(onStop).toHaveBeenCalledOnce(); expect(cancelled).toHaveBeenCalledOnce(); expect(onSend).not.toHaveBeenCalled();
    expect(state.status).toBe("cancelled");
    expect(message("assistant-1").textContent).toContain("已收到的部分回复");
    expect(container.querySelectorAll("[data-message-id]")).toHaveLength(2);
    expect(container.querySelector<HTMLButtonElement>('[role="alert"] button')?.disabled).toBe(false);
    await click(container.querySelector<HTMLButtonElement>('[role="alert"] button')!);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(messages.map(item => item.id)).toEqual(["user-1", "assistant-1"]);
    expect(container.querySelectorAll("[data-message-id]")).toHaveLength(2);
  });
});

it("不可信Markdown图片在客户端与SSR都不会产生外部img或预加载", async () => {
  const payload = "正常解释。\n\n![阅读资料](https://leak.invalid/pixel?book=private)\n\n<img src='https://leak.invalid/raw'>";
  const messages: PanelMessage[] = [{ id:"image-test",role:"assistant",kind:"chat",content:payload,outputFormat:"text",status:"completed" }];
  await render({messages}); expect(container.querySelectorAll("img")).toHaveLength(0); expect(container.textContent).toContain("图片未自动加载");
  const html = renderToStaticMarkup(<AnalysisPanel selected="" analysis={null} loading={false} {...callbacks} messages={messages} />);
  expect(html).not.toContain("<img"); expect(html).not.toContain('rel="preload"'); expect(html).not.toContain("https://leak.invalid");
});


it("当前工具与历史尝试独立折叠，旧保存结果不冒充当前结构卡", async () => {
 const onOpenCitation = vi.fn();
 const current = { id: "same-call", name: "read_source", status: "completed" as const, result: { ok: true, sources: [] } };
 const historicalTools = [
  { ...current, id: "same-call", auditId: "audit-old", attemptId: "old-attempt", name: "save_reading_analysis", result: { ok: true, saved: true } },
  { ...current, id: "legacy", auditId: "audit-unknown", attemptId: null, result: { ok: true, sources: [{ sourceId: "book:e1:paragraph:p1", paragraphId: "p1", text: "过去检索到的原文" }] } },
 ];
 await render({ onOpenCitation, messages: [{ id: "u", role: "user", content: "请句读这一段" }, { id: "a", role: "assistant", content: "当前正常回复", outputFormat: "text", tools: [current], historicalTools }] });
 const area = message("a");
 const history = area.querySelector<HTMLDetailsElement>('[data-testid="historical-tools"]')!;
 expect(history.open).toBe(false);
 expect(area.querySelectorAll('[data-tool-id]')).toHaveLength(1);
 expect(history.querySelectorAll('[data-historical-tool-id]')).toHaveLength(2);
 expect(history.textContent).toContain("归属未知");
 expect(history.textContent).toContain("不代表当前回复的句读记录");
 expect(history.textContent).not.toContain("可展开上方句读记录查看");
 expect(area.querySelector('[data-testid="analysis-record"]')).toBeNull();
 expect(area.querySelector('[data-streaming-format="markdown"]')?.textContent).toBe("当前正常回复");
 await click(history.querySelector('summary')!);
 expect(history.open).toBe(true);
 await click(history.querySelector('button[aria-label="定位检索原文"]')!);
 expect(onOpenCitation).toHaveBeenCalledWith("p1", "过去检索到的原文", "a");
 expect(container.querySelectorAll('[data-message-id]')).toHaveLength(2);
});


it("上下文整理仅展示中文内部进度，状态更新复用工具卡且不公开记忆快照", async () => {
 const cases = [
  { status: "running" as const, result: "已整理 1/3 批历史", expected: "已整理 1/3 批历史" },
  { status: "completed" as const, result: "阅读记忆已压缩并保存", expected: "阅读记忆已压缩并保存" },
  { status: "error" as const, result: { snapshot: { privateContext: "不可直接展示的记忆快照" } }, expected: "阅读记忆整理未完成，可以重试。" },
 ];
 let original: Element | null = null;
 for (const item of cases) {
  await render({ messages: [{ id: "memory-message", role: "assistant", content: "正常回答保持不变", outputFormat: "text", tools: [{ id: "memory-progress", name: "compress_reading_context", status: item.status, result: item.result }] }] });
  const current = container.querySelector('[data-tool-id="memory-progress"]')!;
  if (original) expect(current).toBe(original);
  original = current;
  expect(current.querySelector('summary')?.textContent).toContain("整理阅读记忆");
  expect(current.querySelector('[data-context-progress]')?.textContent).toBe(item.expected);
  expect(current.querySelector('pre')).toBeNull();
  expect(container.textContent).not.toContain("不可直接展示的记忆快照");
  expect(message("memory-message").querySelector('[data-streaming-format="markdown"]')?.textContent).toBe("正常回答保持不变");
  expect(container.querySelectorAll('[data-tool-id]')).toHaveLength(1);
  expect(container.querySelectorAll('[data-message-id]')).toHaveLength(1);
 }
});


describe("局部输入区视觉结构与交互回归", () => {
  it("模型、用量、输入与底部操作共用局部容器，不依赖全局输入区类", async () => {
    await render({ modelName: "long-model-name".repeat(12), onSend: vi.fn() });
    const composer = container.querySelector("." + styles.composer)!;
    expect(composer).not.toBeNull();
    expect(composer.querySelector('[data-testid="usage-footer"]')).not.toBeNull();
    expect(composer.querySelector("textarea")?.classList.contains(styles.composerInput)).toBe(true);
    expect(composer.querySelector("." + styles.composerFooter)?.contains(labelledButton("发送追问"))).toBe(true);
    expect(composer.querySelector("[title]")?.getAttribute("title")).toBe("long-model-name".repeat(12));
    expect(container.querySelector(".chat-composer, .composer-footer, .send-button")).toBeNull();
    await click(composer.querySelector("." + styles.backButton)! as HTMLButtonElement);
    expect(callbacks.onBack).toHaveBeenCalledOnce();
  });

  it("点击发送去除首尾空白并清空输入，空白内容不发送", async () => {
    const onSend = vi.fn();
    await render({ onSend });
    const input = container.querySelector("textarea")!;
    input.value = "  解释这一句  ";
    await click(labelledButton("发送追问"));
    expect(onSend).toHaveBeenCalledWith("解释这一句");
    expect(input.value).toBe("");
    input.value = "  ";
    await click(labelledButton("发送追问"));
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("流式消息仍展示停止按钮，读取会话时禁用输入与发送", async () => {
    const onStop = vi.fn();
    await render({ onSend: vi.fn(), onStop, messages: [{ id: "stream", role: "assistant", content: "回答中", status: "streaming" }] });
    expect(container.querySelector("textarea")?.disabled).toBe(true);
    expect(labelledButton("停止生成").classList.contains(styles.sendButton)).toBe(true);
    await click(labelledButton("停止生成"));
    expect(onStop).toHaveBeenCalledOnce();
    await render({ onSend: vi.fn(), conversationsLoading: true });
    expect(container.querySelector("textarea")?.disabled).toBe(true);
    expect(labelledButton("发送追问").disabled).toBe(true);
  });
});


it("失败状态作为圆角消息卡在滚动区内，不挤占输入区并保留原重试",async()=>{
 const retry=vi.fn();await render({error:"模型或工具执行未完成，请检查协议。",onRetry:retry});
 const card=container.querySelector('[role="alert"]')!;
 expect(viewport().contains(card)).toBe(true);expect(card.className).toContain('errorCard');
 const b=card.querySelector('button')!;await act(async()=>b.click());expect(retry).toHaveBeenCalledOnce();
 expect(container.querySelector('textarea[aria-label="继续追问"]')).not.toBeNull();
});
