import { describe, expect, it } from "vitest";
import { createReadingModel, normalizeModelBaseUrl } from "./model";
import type { ProviderConfig } from "../ai-provider";
const config: ProviderConfig = { provider: "openai", baseUrl: "https://gateway.test/api/v1/chat/completions", apiKey: "test-key", model: "test-model" };
describe("Agent SDK 模型装配", () => {
  it("句读请求不设置应用输出Token上限，SDK仍遵守Claude必填协议",()=>{
    const model=createReadingModel(config);expect(model.maxTokens).toBeUndefined();
    expect(createReadingModel({...config,provider:'claude'}).maxTokens).toBeGreaterThan(0);
  });
  it("OpenAI 保留网关前缀并移除端点", () => expect(normalizeModelBaseUrl(config)).toBe("https://gateway.test/api/v1"));
  it("Claude 不重复追加 v1/messages", () => expect(normalizeModelBaseUrl({ ...config, provider: "claude", baseUrl: "https://gateway.test/api/v1/messages" })).toBe("https://gateway.test/api"));
  it("拒绝危险协议和包含认证信息的 URL", () => { expect(() => normalizeModelBaseUrl({ ...config, baseUrl: "file:///secret" })).toThrow(); expect(() => normalizeModelBaseUrl({ ...config, baseUrl: "https://user:pass@example.com" })).toThrow(); });
  it("装配的确实是双协议 LangChain 模型", () => { expect(createReadingModel(config, 100)._llmType()).toBe("openai"); expect(createReadingModel({ ...config, provider: "claude" }, 100)._llmType()).toBe("anthropic"); });
});
