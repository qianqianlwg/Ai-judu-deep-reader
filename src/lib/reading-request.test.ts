import { describe, expect, it, vi } from "vitest";
import { captureReadingContext, readReadingContextSnapshot, applyReadingRequest, beginReadingRequest, createReadingRequest, executeReadingRequest, reduceReadingRequest, restoreReadingRequest } from "./reading-request";
import type { ChatMessage } from "./chat-stream";

function request() {
  const ids = ["thread-1", "user-1", "assistant-1"];
  return createReadingRequest({ mode: "analyze", question: "请句读这一段", selectedText: "原文", paragraphId: "p1", selectionStart: 2, selectionEnd: 4 }, () => ids.shift()!);
}
const sse = (event: string, data: unknown) => "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n";
const response = (...chunks: string[]) => new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } }));

describe("reading request 原消息重试状态机", () => {
  it("首次提交就固定三个 ID 并快照原输入", () => {
    const history = [{ role: "user" as const, content: "早先问题" }];
    const input = { mode: "chat" as const, question: "追问", selectedText: "", chatHistory: history };
    const state = createReadingRequest(input);
    history[0].content = "改变历史";
    expect(new Set([state.payload.threadId, state.payload.clientUserMessageId, state.payload.clientAssistantMessageId]).size).toBe(3);
    expect(state.payload.chatHistory?.[0].content).toBe("早先问题");
    expect(request().payload).toMatchObject({ threadId: "thread-1", clientUserMessageId: "user-1", clientAssistantMessageId: "assistant-1", selectionStart: 2, selectionEnd: 4 });
  });
  it("失败重试只重置原助手，保留原用户对象及后续消息", () => {
    const started = beginReadingRequest(request(), []);
    let state = reduceReadingRequest(started.state, { type: "raw_delta", text: "半截内容" });
    state = reduceReadingRequest(state, { type: "error", message: "网络错误" });
    const failed = applyReadingRequest(started.messages, state);
    const later: ChatMessage = { id: "later", role: "user", content: "后面的消息" };
    const retry = beginReadingRequest(state, [...failed, later]);
    expect(retry.messages).toHaveLength(3);
    expect(retry.messages[0]).toBe(started.messages[0]);
    expect(retry.messages[1]).toMatchObject({ id: "assistant-1", content: "", status: "streaming" });
    expect(retry.messages[2]).toBe(later);
    expect(retry.state.payload).toBe(state.payload);
    expect(retry.state.attempt).toBe(2);
    expect(failed[1].content).toBe("半截内容");
  });
  it("刷新后按持久化身份和原选区恢复失败请求，不依赖当前选择", () => {
    const restored = restoreReadingRequest("thread-1", { id: "assistant-1", role: "assistant", content: "部分", status: "error", structuredOutput: JSON.stringify({ _request: { version: 1, clientUserMessageId: "user-1", clientAssistantMessageId: "assistant-1", input: { mode: "analyze", question: "请句读这一段", selectedText: "原文", paragraphId: "p1", selectionStart: 2, selectionEnd: 4 }, failure: { code: "cancelled", message: "已停止" } } }) });
    expect(restored).toMatchObject({ status: "cancelled", content: "部分", payload: { threadId: "thread-1", clientUserMessageId: "user-1", clientAssistantMessageId: "assistant-1", selectedText: "原文", paragraphId: "p1", selectionStart: 2, selectionEnd: 4 } });
    expect(beginReadingRequest(restored!, []).state.payload).toBe(restored!.payload);
    expect(restoreReadingRequest("thread-1", { id: "old", role: "assistant", content: "旧数据", status: "error", structuredOutput: "{}" })).toBeNull();
  });
  it("拒绝重复开始、完成后重试和 ID 冲突", () => {
    const state = beginReadingRequest(request(), []).state;
    expect(() => beginReadingRequest(state, [])).toThrow("不能重试");
    expect(() => beginReadingRequest({ ...state, status: "completed" }, [])).toThrow("不能重试");
    expect(() => applyReadingRequest([{ id: "user-1", role: "user", content: "其他问题" }], state)).toThrow("不匹配");
    expect(() => reduceReadingRequest(state, { type: "meta", threadId: "other", messageId: "assistant-1" })).toThrow("其他请求");
  });
  it("完成或失败后的迟到增量无效", () => {
    const state = beginReadingRequest(request(), []).state;
    const completed = reduceReadingRequest(state, { type: "done", content: "答案" });
    expect(reduceReadingRequest(completed, { type: "raw_delta", text: "迟到" })).toBe(completed);
    const failed = reduceReadingRequest(state, { type: "error", message: "失败" });
    expect(reduceReadingRequest(failed, { type: "done", content: "迟到" })).toBe(failed);
  });
});

describe("reading request 流式执行", () => {
  it("请求带稳定 ID、历史不重复本轮消息、done 才完成", async () => {
    const original = request();
    original.payload.chatHistory = [{ id: "old", role: "user", content: "之前" }, { id: "user-1", role: "user", content: "请句读这一段" }, { id: "assistant-1", role: "assistant", content: "失败内容" }];
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(sse("meta", { threadId: "thread-1", messageId: "assistant-1" }), sse("raw_delta", { text: "第一部分" }), sse("raw_delta", { text: "，第二部分" }), sse("done", { content: "第一部分，第二部分" })));
    const onState = vi.fn();
    const state = await executeReadingRequest(beginReadingRequest(original, []).state, { fetcher, onState });
    expect(state).toMatchObject({ status: "completed", content: "第一部分，第二部分" });
    expect(onState.mock.calls.some(([value]) => value.content === "第一部分")).toBe(true);
    const payload = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(payload).toMatchObject({ threadId: "thread-1", clientUserMessageId: "user-1", clientAssistantMessageId: "assistant-1", chatHistory: [{ id: "old", role: "user", content: "之前" }] });
  });
  it("中途 EOF 保留部分内容，并可用原 payload 重试", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(sse("raw_delta", { text: "部分" }))).mockResolvedValueOnce(response(sse("raw_delta", { text: "完整答案" }), sse("done", {})));
    const first = beginReadingRequest(request(), []);
    const failed = await executeReadingRequest(first.state, { fetcher });
    expect(failed).toMatchObject({ status: "error", content: "部分" });
    const retry = beginReadingRequest(failed, applyReadingRequest(first.messages, failed));
    const completed = await executeReadingRequest(retry.state, { fetcher });
    expect(completed.content).toBe("完整答案");
    expect(applyReadingRequest(retry.messages, completed)).toHaveLength(2);
    expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);
  });
  it("空内容即使收到 done 也不能记为成功", async () => {
    const state = await executeReadingRequest(beginReadingRequest(request(), []).state, { fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(sse("raw_delta", { text: "  " }), sse("done", {}))) });
    expect(state.status).toBe("error");
    expect(state.error).toContain("没有返回内容");
  });
  it("HTTP 失败保留服务端错误并可重试", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const state = await executeReadingRequest(beginReadingRequest(request(), []).state, { fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "未配置 AI 服务" }, { status: 503 })) });
      expect(state).toMatchObject({ status: "error", error: "未配置 AI 服务" });
      expect(beginReadingRequest(state, []).state.payload.clientUserMessageId).toBe("user-1");
    } finally { log.mockRestore(); }
  });
  it("SSE error 不能被后面的 done 改成成功", async () => {
    const state = await executeReadingRequest(beginReadingRequest(request(), []).state, { fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(sse("raw_delta", { text: "部分" }), sse("error", { message: "失败" }), sse("done", { content: "伪成功" }))) });
    expect(state).toMatchObject({ status: "error", content: "部分", error: "失败" });
  });
  it("取消挂起的流立即结束并保留原消息供重试", async () => {
    const abort = new AbortController();
    const cancelled = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(sse("raw_delta", { text: "部分" }))); }, cancel: cancelled })));
    const state = await executeReadingRequest(beginReadingRequest(request(), []).state, { fetcher, signal: abort.signal, onState(next) { if (next.content === "部分" && next.status === "streaming") abort.abort(); } });
    expect(state).toMatchObject({ status: "cancelled", content: "部分" });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(beginReadingRequest(state, []).state.payload).toEqual(state.payload);
  });
  it("发送前取消不会请求网络", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const abort = new AbortController(); abort.abort();
    const state = await executeReadingRequest(beginReadingRequest(request(), []).state, { fetcher, signal: abort.signal });
    expect(state.status).toBe("cancelled");
    expect(fetcher).not.toHaveBeenCalled();
  });
});


describe("阅读请求的首次上下文快照", () => {
  const context = () => ({
    bookTitle: "精神现象学", chapterTitle: "自我意识", context: "原段落前后文", textHash: "original-hash",
    contextSettings: { maxInputTokens: 65536, maxOutputTokens: 8192, compressionStrategy: "aggressive" as const },
    chatHistory: [{ id: "old-question", role: "user" as const, content: "如何理解承认？" }, { id: "old-answer", role: "assistant" as const, content: "先考察两个自我意识。" }],
    bookSearch: [{ sourceId: "book:p1", paragraphId: "p1", excerpt: "原检索片段", context: { before: [{ id: "p0", chapterId: "c1", text: "检索前文" }], after: [] }, retrieval: { backend: "sqlite", vectorUsed: false, keywordScore: 2 } }],
  });
  it("快照独立保存完整有效上下文，仅白名单字段进入存储", () => {
    const input = context();
    const snapshot = captureReadingContext({ ...input, apiKey: "root-secret", authorization: "header-secret", contextSnapshot: { secret: "nested-secret" }, contextSettings: { ...input.contextSettings, api_key: "settings-secret" }, chatHistory: [...input.chatHistory, { id: "user-1", role: "user", content: "重复本轮" }, { id: "failed", role: "assistant", content: "失败消息", status: "error" }], bookSearch: [{ ...input.bookSearch[0], apiKey: "search-secret", context: { ...input.bookSearch[0].context, token: "context-secret" } }] }, ["user-1"]);
    expect(snapshot).toEqual({ version: 1, ...input });
    expect(JSON.stringify(snapshot)).not.toContain("secret");
    input.chatHistory[0].content = "之后修改历史";
    input.bookSearch[0].context.before[0].text = "之后修改检索";
    expect(snapshot.chatHistory[0].content).toBe("如何理解承认？");
    expect(JSON.stringify(snapshot.bookSearch)).toContain("检索前文");
    expect(readReadingContextSnapshot(snapshot)).toEqual(snapshot);
  });
  it("刷新恢复全部原上下文，忽略刷新后传入的新历史且保留原 anchor 对象身份", () => {
    const original = request();
    const started = beginReadingRequest(original, []);
    const snapshot = captureReadingContext(context());
    const restored = restoreReadingRequest("thread-1", { id: "assistant-1", role: "assistant", status: "error", content: "部分输出", structuredOutput: JSON.stringify({ _request: { version: 1, clientUserMessageId: "user-1", clientAssistantMessageId: "assistant-1", input: original.payload, contextSnapshot: snapshot } }) }, [{ role: "user", content: "刷新后的新问题" }]);
    expect(restored?.payload).toMatchObject(context());
    expect(restored?.payload.chatHistory).not.toContainEqual({ role: "user", content: "刷新后的新问题" });
    const retry = beginReadingRequest(restored!, started.messages);
    expect(retry.messages[0]).toBe(started.messages[0]);
    expect(retry.messages[0].anchor).toBe(started.messages[0].anchor);
    expect(retry.messages[1].anchor).toEqual(started.messages[1].anchor);
    expect(retry.messages).toHaveLength(2);
  });
  it("首次历史为空也保持为空，不混入刷新后的历史", () => {
    const snapshot = captureReadingContext({ ...context(), chatHistory: [] });
    const state = request();
    const restored = restoreReadingRequest("thread-1", { id: "assistant-1", role: "assistant", status: "error", content: "", structuredOutput: JSON.stringify({ _request: { version: 1, clientUserMessageId: "user-1", clientAssistantMessageId: "assistant-1", input: state.payload, contextSnapshot: snapshot } }) }, [{ role: "user", content: "新消息" }]);
    expect(restored?.payload.chatHistory).toEqual([]);
  });
  it("旧记录无快照仍可恢复原 ID，保留已有的历史兼容回退", () => {
    const state = request();
    const history = [{ role: "user" as const, content: "旧版历史回退" }];
    const restored = restoreReadingRequest("thread-1", { id: "assistant-1", role: "assistant", status: "error", content: "", structuredOutput: JSON.stringify({ _request: { version: 1, clientUserMessageId: "user-1", clientAssistantMessageId: "assistant-1", input: state.payload } }) }, history);
    expect(restored?.payload.chatHistory).toEqual(history);
    expect(restored?.payload.chatHistory).not.toBe(history);
    expect(restored?.payload.bookTitle).toBeUndefined();
    expect(restored?.payload.clientAssistantMessageId).toBe("assistant-1");
  });
  it("已有快照损坏时明确报错，不悄悄改用当前上下文", () => {
    const state = request();
    expect(() => restoreReadingRequest("thread-1", { id: "assistant-1", role: "assistant", status: "error", content: "", structuredOutput: JSON.stringify({ _request: { version: 1, clientUserMessageId: "user-1", clientAssistantMessageId: "assistant-1", input: state.payload, contextSnapshot: {} } }) })).toThrow("上下文快照损坏");
    expect(() => readReadingContextSnapshot({ ...captureReadingContext(context()), contextSettings: { maxInputTokens: "错误" } })).toThrow("上下文设置损坏");
  });
});
