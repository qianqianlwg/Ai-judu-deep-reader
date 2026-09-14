import { describe, expect, it, vi } from "vitest";
import { isConversationId, isConversationSummary, conversationId, conversationToolFromRow, canSelectConversation, conversationEditionQuery, conversationFromRow, conversationTitle, createConversationClient, displayConversationTitle, newConversationInput, renameConversationInput } from "./conversations";
const thread = { id: "t1", editionId: "e1", bookId: "b1", title: "承认关系", createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z", messageCount: 2 };
describe("会话输入与旧数据展示", () => {
  it("创建和重命名必须提供版本，不能提交未知字段或非法 ID", () => {
    expect(newConversationInput({ editionId: "e1", threadId: "t1", title: "  承认关系  " })).toEqual({ editionId: "e1", threadId: "t1", title: "承认关系" });
    expect(() => newConversationInput({ editionId: "e1", bookId: "b2" })).toThrow("未知字段");
    expect(() => renameConversationInput({ title: "名称" })).toThrow("版本 ID");
    expect(() => newConversationInput({ editionId: "../bad" })).toThrow("不合法");
    expect(() => conversationEditionQuery(new URLSearchParams("editionId=e1&editionId=e2"))).toThrow("唯一");
    expect(conversationEditionQuery(new URLSearchParams("editionId=e1"))).toBe("e1");
  });
  it("标题按 Unicode 字符计数，拒绝空值和控制字符", () => {
    expect(conversationTitle("😀".repeat(80))).toHaveLength(160);
    for (const value of [" ", "字".repeat(81), "新\n标题", 12]) expect(() => conversationTitle(value)).toThrow();
  });
  it("旧会话从原问题或原选区派生展示标题，不改变 ID", () => {
    expect(displayConversationTitle(null, "请句读这一段", "原来的选区" )).toBe("原来的选区");
    expect(displayConversationTitle("手动名称", "追问问题", "选区")).toBe("手动名称");
    expect(displayConversationTitle("", "如何理解承认", "选区")).toBe("如何理解承认");
    expect(displayConversationTitle(null, null, null)).toBe("新会话");
    expect(conversationFromRow({ ...thread, title: null, firstQuestion: "旧问题" })).toMatchObject({ id: "t1", title: "旧问题" });
  });
  it("生成中或者目标属于其他版本时不能切换", () => {
    expect(canSelectConversation([thread], "e1", "t1", true)).toBe(false);
    expect(canSelectConversation([thread], "e2", "t1", false)).toBe(false);
    expect(canSelectConversation([thread], "e1", "t1", false)).toBe(true);
  });
});
describe("显式注入传输的会话 client", () => {
  it("读取列表/历史始终携带版本和 AbortSignal，历史原样保留 usageJson", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ threads: [thread] })).mockResolvedValueOnce(Response.json({ threadId: "t1", thread, messages: [{ id: "m1", role: "assistant", content: "回答", status: "completed", usageJson: '{"source":"provider"}' }] }));
    const client = createConversationClient(fetcher); const controller = new AbortController();
    expect(await client.list("e1", controller.signal)).toEqual([thread]);
    expect((await client.load("t1", "e1", controller.signal)).messages[0].usageJson).toContain("provider");
    expect(fetcher.mock.calls[0]).toEqual(["/api/threads?editionId=e1", { signal: controller.signal }]);
    expect(fetcher.mock.calls[1][0]).toBe("/api/threads/t1?editionId=e1");
  });
  it("创建和重命名 payload 校验并返回服务端会话", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ thread }));
    const client = createConversationClient(fetcher);
    expect(await client.create({ editionId: "e1", threadId: "t1" })).toEqual(thread);
    expect(await client.rename("t1", "e1", "  承认关系 ")).toEqual(thread);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ editionId: "e1", title: "承认关系" });
  });
  it("指定客户端创建 ID 时拒绝不同 ID 的响应", async () => {
    const client = createConversationClient(vi.fn<typeof fetch>().mockResolvedValue(Response.json({ thread: { ...thread, id: "other-id" } })));
    await expect(client.create({ editionId: "e1", threadId: "t1" })).rejects.toThrow("客户端会话 ID 不一致");
  });
  it("拒绝其他版本的响应并保留可见错误，不悄悄合并会话", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ threads: [{ ...thread, editionId: "e2" }] })).mockResolvedValueOnce(Response.json({ error: "版本不存在" }, { status: 404 })).mockResolvedValueOnce(new Response("broken"));
    const client = createConversationClient(fetcher);
    await expect(client.list("e1")).rejects.toThrow("其他版本");
    await expect(client.load("t1", "e1")).rejects.toThrow("版本不存在");
    await expect(client.list("e1")).rejects.toThrow("无法读取");
  });
});


describe("历史工具的安全展示白名单", () => {
  const row = (output: unknown, name = "save_reading_analysis") => ({ id: "audit-1", messageId: "m1", name, status: "completed", outputJson: JSON.stringify(output), inputJson: "never expose" });
  it("保存结果保留 Analysis 字段，丢弃输入、元数据与密钥并限长", () => {
    const output = { ok: true, saved: true, analysisId: "m1", locationAvailable: true, result: { summary: "长".repeat(3000), breakdown: [], concepts: [{ name: "认识", text: "说明", secret: "hidden" }], context: "上下文", uncertainty: "", _request: { api_key: "hidden-key" }, input: "private-input" }, metadata: "private-data" };
    const result = conversationToolFromRow(row(output), "e1")!;
    const display = result.tool.result as { saved: boolean; result: { summary: string }; displayLimited: boolean };
    expect(display.saved).toBe(true); expect(display.result.summary).toHaveLength(2000); expect(display.displayLimited).toBe(true);
    for (const hidden of ["never expose", "hidden-key", "private-input", "private-data", "hidden"]) expect(JSON.stringify(result)).not.toContain(hidden);
  });
  it("未知工具不公开未经适配的原始审计结果", () => {
    const result = conversationToolFromRow(row({ password: "secret-value", text: "sensitive-output" }, "unknown_secret_tool"), "e1")!;
    expect(result.tool.name).toBe("unknown_tool");
    expect(JSON.stringify(result)).not.toContain("sensitive-output");
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });
  it("默认新会话是占位名，不掩盖首次问题或原文", () => {
    expect(displayConversationTitle("新会话", "为什么需要承认？", "原文")).toBe("为什么需要承认？");
    expect(displayConversationTitle("新会话", "请句读这一段", "自我意识的独立性")).toBe("自我意识的独立性");
    expect(conversationFromRow({ ...thread, title: "新会话", firstQuestion: "请句读这一段", selectedText: null, titleSelectedText: "消息中保存的选文" }).title).toBe("消息中保存的选文");
  });
});


describe("空/非法会话ID防御", () => {
  it("列表与输入使用同一个完整匹配规则", () => {
    for (const id of ["", " ", "bad/id", "t1\n", "t1\r", "t1\u2028", "_start", "a".repeat(129), null, 7]) {
      expect(isConversationId(id)).toBe(false);
      expect(() => conversationId(id)).toThrow("不合法");
      expect(isConversationSummary({ ...thread, id })).toBe(false);
    }
    for (const id of ["t1", "legacy:ok_1", "a".repeat(128)]) expect(isConversationId(id)).toBe(true);
  });
  it("客户端明确拒绝坏列表，不过滤掉14条旧历史假装成功", async () => {
    const invalid = { ...thread, id: "", messageCount: 14 };
    const client = createConversationClient(vi.fn<typeof fetch>().mockResolvedValue(Response.json({ threads: [thread, invalid] })));
    await expect(client.list("e1")).rejects.toThrow("会话列表数据不合法");
    expect(canSelectConversation([invalid], "e1", "", false)).toBe(false);
    expect(() => conversationFromRow(invalid)).toThrow("会话数据不完整");
  });
  it("创建响应为空ID时不进入后续加载锁", async () => {
    const client = createConversationClient(vi.fn<typeof fetch>().mockResolvedValue(Response.json({ thread: { ...thread, id: "" } })));
    await expect(client.create({ editionId: "e1" })).rejects.toThrow();
  });
});


it("会话 client 不丢失当前工具与独立的旧尝试分区", async () => {
 const tool = { id: "call-1", name: "search_book", status: "completed", result: { ok: true, sources: [] } };
 const saved = { id: "m1", role: "assistant", content: "本轮正文", status: "completed", tools: [tool], historicalTools: [{ ...tool, attemptId: null, auditId: "legacy-audit" }] };
 const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ threadId: "t1", thread, messages: [saved] }));
 const history = await createConversationClient(fetcher).load("t1", "e1");
 expect(history.messages[0]).toEqual(saved);
 expect(history.messages[0].tools).toHaveLength(1);
 expect(history.messages[0].historicalTools?.[0].attemptId).toBeNull();
});
