import { describe, expect, it } from "vitest";
import {
  buildProviderHeaders,
  buildProviderRequestBody,
  buildProviderUrl,
  parseProviderSseEvent,
  type ProviderConfig,
} from "./ai-provider";

const openai: ProviderConfig = { provider: "openai", baseUrl: "https://example.test/v1/", apiKey: "key", model: "gpt-test" };
const claude: ProviderConfig = { provider: "claude", baseUrl: "https://example.test", apiKey: "key", model: "claude-test" };

const messages = [
  { role: "system" as const, content: "系统规则" },
  { role: "user" as const, content: "你好" },
];

describe("ai provider adapter", () => {
  it("构造 OpenAI 请求体和认证地址", () => {
    expect(buildProviderUrl(openai)).toBe("https://example.test/v1/chat/completions");
    expect(buildProviderHeaders(openai).Authorization).toBe("Bearer key");
    expect(buildProviderRequestBody(openai, { messages, maxTokens: 100, stream: true })).toEqual({
      model: "gpt-test", messages, max_tokens: 100, stream: true,
    });
  });

  it("把 system 消息转换到 Claude 顶层", () => {
    expect(buildProviderUrl(claude)).toBe("https://example.test/v1/messages");
    expect(buildProviderHeaders(claude)["x-api-key"]).toBe("key");
    expect(buildProviderRequestBody(claude, { messages, maxTokens: 200, stream: true })).toEqual({
      model: "claude-test", system: "系统规则", messages: [{ role: "user", content: "你好" }], max_tokens: 200, stream: true,
    });
  });

  it("解析 OpenAI delta 和结束事件", () => {
    expect(parseProviderSseEvent({ event: "message", data: JSON.stringify({ choices: [{ delta: { content: "你好" } }] }) })).toEqual({ text: "你好", done: false });
    expect(parseProviderSseEvent({ event: "message", data: "[DONE]" })).toEqual({ text: "", done: true });
  });

  it("解析 Claude content_block_delta 和 message_stop", () => {
    expect(parseProviderSseEvent({ event: "content_block_delta", data: JSON.stringify({ delta: { type: "text_delta", text: "你好" } }) })).toEqual({ text: "你好", done: false });
    expect(parseProviderSseEvent({ event: "message_stop", data: "{}" })).toEqual({ text: "", done: true });
  });

  it("拒绝非法流式 JSON", () => {
    expect(() => parseProviderSseEvent({ event: "message", data: "not-json" })).toThrow("AI 流式事件不是合法 JSON");
  });
});
