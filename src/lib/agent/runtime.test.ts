import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { createExternalReader } from "./external-reading";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadingAgentError, readingAgentFailure, runReadingAgent } from "./runtime";
import type { ReadingToolDependencies } from "./tools";
import type { ChatEvent } from "../chat-stream";
import type { ProviderConfig } from "../ai-provider";

type Step = { name?: string; args?: unknown; text?: string[]; finish?: string; interrupted?: boolean };
const closeServers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closeServers.splice(0)) await close(); });
async function mockProvider(provider: "openai" | "claude", steps: Step[]) {
  const requests: { url: string; body: Record<string, unknown>; auth?: string }[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      let raw = "";
      for await (const chunk of request) raw += String(chunk);
      requests.push({ url: request.url ?? "", body: JSON.parse(raw) as Record<string, unknown>, auth: String(request.headers.authorization ?? request.headers["x-api-key"]) });
      const step = steps[requests.length - 1];
      if (!step) { response.writeHead(500).end("unexpected model step"); return; }
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const send = (payload: unknown, event?: string) => response.write((event ? "event: " + event + "\n" : "") + "data: " + JSON.stringify(payload) + "\n\n");
      if (provider === "openai") {
        const chunk = (delta: unknown, finish_reason: string | null = null) => send({ id: "chat-" + requests.length, object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta, finish_reason }] });
        chunk({ role: "assistant", content: "" });
        for (const text of step.text ?? []) { chunk({ content: text }); await new Promise(resolve => setTimeout(resolve, 8)); }
        if (step.name) chunk({ tool_calls: [{ index: 0, id: "call-" + requests.length, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }] });
        if (!step.interrupted) {
          chunk({}, step.finish ?? (step.name ? "tool_calls" : "stop"));
          send({ id: "chat-" + requests.length, choices: [], usage: { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140, prompt_tokens_details: { cached_tokens: 60 } } });
          response.write("data: [DONE]\n\n");
        }
      } else {
        send({ type: "message_start", message: { id: "msg-" + requests.length, type: "message", role: "assistant", content: [], model: "test-model", stop_reason: null, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 0 } } }, "message_start");
        if (step.name) {
          send({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call-" + requests.length, name: step.name, input: {} } }, "content_block_start");
          send({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(step.args) } }, "content_block_delta");
        } else {
          send({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, "content_block_start");
          for (const text of step.text ?? []) { send({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }, "content_block_delta"); await new Promise(resolve => setTimeout(resolve, 8)); }
        }
        send({ type: "content_block_stop", index: 0 }, "content_block_stop");
        if (!step.interrupted) {
          send({ type: "message_delta", delta: { stop_reason: step.finish ?? (step.name ? "tool_use" : "end_turn"), stop_sequence: null }, usage: { output_tokens: 20 } }, "message_delta");
          send({ type: "message_stop" }, "message_stop");
        }
      }
      response.end();
    })().catch(error => { response.writeHead(500).end(String(error)); });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  closeServers.push(() => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("missing test address");
  return { requests, config: { provider, baseUrl: "http://127.0.0.1:" + address.port + (provider === "openai" ? "/v1" : "/v1"), apiKey: "test-key", model: "test-model" } satisfies ProviderConfig };
}
const analysis = { readingText: "认识改变对象啊啊", summary: "认识并不是外在工具。", breakdown: [], concepts: [{ name: "认识", text: "认识活动" }], context: "导论", uncertainty: "", citations: [] };
function fixture() {
  const events: ChatEvent[] = [];
  const tools: ReadingToolDependencies = { messageId: "assistant", selectedText: "认识改变对象而不是保持原来形态，这需要根据原文来理解。", detail: "standard", sources: new Map(), search: vi.fn(async () => []), read: vi.fn(async () => []), save: vi.fn(async () => undefined) };
  return { events, tools, audit: vi.fn(async () => undefined), emit: (event: ChatEvent) => { events.push(event); }, signal: new AbortController().signal, systemPrompt: "正常回答并通过工具保存结构数据", messages: [{ role: "user" as const, content: "请句读" }], maxOutputTokens: 2048, contextWindow: 32768 };
}
describe("真实 LangChain + HTTP 双协议闭环", () => {
  it.each(["openai", "claude"] as const)("%s 执行 tool calling 后流式正常回复，工具 JSON 不泄漏到正文", async provider => {
    const { config, requests } = await mockProvider(provider, [{ name: "save_reading_analysis", args: analysis }, { text: ["### 句读\n", "认识与对象并非简单分离。"] }]);
    const f = fixture(); const result = await runReadingAgent({ ...f, config });
    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe(provider === "openai" ? "/v1/chat/completions" : "/v1/messages");
    expect(requests[0].auth).toBe(provider === "openai" ? "Bearer test-key" : "test-key");
    expect(requests[0].body.tools).toEqual(expect.any(Array));
    expect(requests[0].body).not.toHaveProperty("response_format");
    expect(f.tools.save).toHaveBeenCalledOnce();
    expect(f.events.filter(e => e.type === "raw_delta")).toHaveLength(2);
    expect(result.text).toBe("### 句读\n认识与对象并非简单分离。");
    expect(result.text).not.toContain('"summary"');
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ name: "save_reading_analysis", status: "completed" }));
    expect(result.usage.source).toBe("provider");
    expect(result.usage.totalTokens).toBeGreaterThan(result.usage.contextTokens);
  });
  it("仅装配本轮授权的外部资料工具，并将三路查询结果写入可见审计", async () => {
    const { config, requests } = await mockProvider("openai", [
      { name: "search_openalex", args: { query: "ethics" } },
      { name: "verify_crossref", args: { query: "10.1000/abc" } },
      { name: "search_web", args: { query: "ethics 2026" } },
      { text: ["已取得三个来源的条目，请核验链接及证据级别。"] },
    ]);
    const f = fixture();
    const search = vi.fn(async (source: "openalex" | "crossref" | "web", query: string) => ({
      ok: true as const, source, query, results: [{ title: "测试条目", url: "https://example.org/item", evidence: source === "web" ? "snippet" as const : "metadata" as const }],
      evidence: source === "web" ? "snippet" as const : "metadata" as const, durationMs: 9,
    }));
    const result = await runReadingAgent({ ...f, config, external: { permissions: { openalex: true, crossref: true, web: true }, selectedText: "原书中需要分析的一段正文", search } });
    expect(JSON.stringify(requests[0].body.tools)).toContain("search_openalex");
    expect(JSON.stringify(requests[0].body.tools)).toContain("verify_crossref");
    expect(JSON.stringify(requests[0].body.tools)).toContain("search_web");
    expect(search.mock.calls.map(call => call.slice(0, 2))).toEqual([["openalex", "ethics"], ["crossref", "10.1000/abc"], ["web", "ethics 2026"]]);
    expect(f.audit).toHaveBeenCalledTimes(3);
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ name: "search_web", status: "completed", output: expect.objectContaining({ source: "web", query: "ethics 2026", results: expect.any(Array) }) }));
    expect(f.events).toContainEqual(expect.objectContaining({ type: "tool", tool: expect.objectContaining({ name: "search_web", status: "completed", result: expect.objectContaining({ results: expect.any(Array) }) }) }));
    expect(result.text).not.toContain("example.org");
  });
  it("LangChain 先检索再读实际页面片段，模型与可见审计都拿到正文，不冒充全文", async () => {
    const url = "https://example.org/item";
    const sourceId = "external:web:" + createHash("sha256").update("web:" + url).digest("hex").slice(0, 24);
    const { config, requests } = await mockProvider("openai", [
      { name: "search_web", args: { query: "Kant antinomy" } },
      { name: "read_external_source", args: { sourceId } },
      { text: ["所读页面相关段落指出：理性有自己的界限；仍需核对原文上下文。"] },
    ]);
    const f = fixture();
    const search = vi.fn(async (source: "openalex" | "crossref" | "web", query: string) => ({ ok: true as const, source, query, results: [{ title: "Source", url, evidence: "snippet" as const }], evidence: "snippet" as const, durationMs: 1 }));
    const read = createExternalReader({ TAVILY_API_KEY: "mock-key" }, vi.fn(async () => new Response(JSON.stringify({ results: [{ url, raw_content: "真实网页段落：理性有自己的界限。" }] }), { status: 200 })) as typeof fetch);
    const result = await runReadingAgent({ ...f, config, external: { permissions: { openalex: false, crossref: false, web: true }, selectedText: "书中的长段选文", search, read } });
    expect(JSON.stringify(requests[0].body.tools)).toContain("read_external_source");
    expect(JSON.stringify(requests[2].body.messages)).toContain("真实网页段落");
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ name: "read_external_source", status: "completed", output: expect.objectContaining({ evidence: "extracted", coverage: "relevant_chunks" }) }));
    expect(f.events).toContainEqual(expect.objectContaining({ type: "tool", tool: expect.objectContaining({ name: "read_external_source", status: "completed", result: expect.objectContaining({ text: expect.stringContaining("真实网页段落") }) }) }));
    expect(result.text).toContain("仍需核对");
  });
  it("没有外部授权时不向模型暴露第三方工具", async () => {
    const { config, requests } = await mockProvider("openai", [{ text: ["只回答书内内容。"] }]);
    await runReadingAgent({ ...fixture(), config });
    const tools = JSON.stringify(requests[0].body.tools);
    for (const name of ["search_openalex", "verify_crossref", "search_web", "read_external_source"]) expect(tools).not.toContain(name);
  });
  it("参数缺字段返回工具错误，Agent 可以修正后继续正常回答", async () => {
    const { config, requests } = await mockProvider("openai", [{ name: "save_reading_analysis", args: { summary: "缺字段" } }, { name: "save_reading_analysis", args: analysis }, { text: ["已解释并保存。"] }]);
    const f = fixture(); const result = await runReadingAgent({ ...f, config });
    expect(requests).toHaveLength(3); expect(result.text).toBe("已解释并保存。");
    expect(f.tools.save).toHaveBeenCalledOnce();
    expect(f.events).toContainEqual(expect.objectContaining({ type: "tool", tool: expect.objectContaining({ status: "error" }) }));
  });
  it("普通回复夹杂代码或花括号不做 JSON.parse", async () => {
    const { config } = await mockProvider("openai", [{ text: ["不是每条消息都解析：", "\n\n示例 {并非 JSON}。"] }]);
    const f = fixture(); const result = await runReadingAgent({ ...f, config });
    expect(result.text).toContain("{并非 JSON}"); expect(f.tools.save).not.toHaveBeenCalled();
  });
  it("输出截断和 EOF 中断不误报成功", async () => {
    const { config } = await mockProvider("openai", [{ text: ["半截"], finish: "length" }]);
    await expect(runReadingAgent({ ...fixture(), config })).rejects.toThrow("输出上限");
    const interrupted = await mockProvider("openai", [{ text: ["半截"], interrupted: true }]);
    await expect(runReadingAgent({ ...fixture(), config: interrupted.config })).rejects.toThrow("中断");
  });
  it("取消后不调用工具保存", async () => {
    const { config } = await mockProvider("openai", [{ text: ["未发送"] }]);
    const f = fixture(); const abort = new AbortController(); abort.abort();
    await expect(runReadingAgent({ ...f, config, signal: abort.signal })).rejects.toThrow();
    expect(f.tools.save).not.toHaveBeenCalled();
  });
  it("工具 schema 也计入上下文预算，超限不调用模型", async () => {
    const { config, requests } = await mockProvider("openai", []);
    await expect(runReadingAgent({ ...fixture(), config, contextWindow: 256, maxOutputTokens: 128 })).rejects.toThrow("上下文预算");
    expect(requests).toHaveLength(0);
  });
  it("普通聊天不绑定保存句读工具", async () => {
    const { config, requests } = await mockProvider("openai", [{ text: ["自然回答"] }]);
    const f = fixture(); f.tools.selectedText = "";
    await runReadingAgent({ ...f, config });
    expect(JSON.stringify(requests[0].body.tools)).not.toContain("save_reading_analysis");
  });

  it("多步自然回复之间留段落边界，Markdown标题不粘连", async () => {
    const { config } = await mockProvider("openai", [{ text: ["我先检查原文。"], name: "search_book", args: { query: "认识" } }, { text: ["### 解释\n认识不是外在工具。"] }]);
    const result = await runReadingAgent({ ...fixture(), config });
    expect(result.text).toBe("我先检查原文。\n\n### 解释\n认识不是外在工具。");
  });

  it("循环工具调用会有界停止，而不是无限占用模型", async () => {
    const { config, requests } = await mockProvider("openai", Array.from({length:40},()=>({name:"search_book",args:{query:"认识"}})));
    let failure: unknown; try { await runReadingAgent({...fixture(),config}); } catch(error: unknown) { failure=error; }
    expect(readingAgentFailure(failure)?.code).toBe("tool_limit"); expect(requests.length).toBeLessThan(40);
  });
  it("包装后的上下文错误保留可操作说明，但不公开供应商错误",()=>{
    expect(readingAgentFailure(new Error("wrapper",{cause:new ReadingAgentError("context_limit","上下文超限")}))).toEqual({code:"context_limit",message:"上下文超限"});
    expect(readingAgentFailure(new Error("private token or upstream response"))).toBeUndefined();
  });

});

it("正常长度只是目标，输出和保存超出目标仍完成且保存后不再续写", async () => {
  const longText = "释".repeat(900);
  const { config, requests } = await mockProvider("openai", [
    { text: [longText], name: "save_reading_analysis", args: { ...analysis, readingText: longText, citations: [] } },
  ]);
  const f = fixture();
  const result = await runReadingAgent({ ...f, config });
  expect(result.text).toBe(longText);
  expect(requests).toHaveLength(1);
  expect(f.tools.save).toHaveBeenCalledOnce();
  expect(f.events.some(event => event.type === "tool" && event.tool.name === "save_reading_analysis" && event.tool.status === "completed")).toBe(true);
});
