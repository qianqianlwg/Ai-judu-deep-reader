import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { normalizeProviderBaseUrl, type ProviderConfig } from "../ai-provider";

export const normalizeModelBaseUrl = normalizeProviderBaseUrl;
export function createReadingModel(config: ProviderConfig, maxTokens?: number) {
  if (!config.apiKey.trim() || !config.model.trim()) throw new Error("请先配置模型名称和 API Key");
  const baseURL = normalizeModelBaseUrl(config);
  // WHY：句读不主动设置输出 Token 上限；Claude 协议必填上限由 SDK 根据模型能力填入，不能宣称突破服务端限制。
  const common = { model: config.model, apiKey: config.apiKey, ...(maxTokens===undefined?{}:{maxTokens}), streaming: true, streamUsage: true, maxRetries: 0, timeout: 240_000 };
  // WHY：不用 response_format 强迫正文变成 JSON；结构化数据只通过 typed tool calls 传递。
  return config.provider === "claude"
    ? new ChatAnthropic({ ...common, clientOptions: { baseURL } })
    : new ChatOpenAI({ ...common, useResponsesApi: false, configuration: { baseURL } });
}
