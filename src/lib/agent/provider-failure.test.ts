import { expect, it } from "vitest";
import { readProviderFailure } from "./provider-failure";
import { readingAgentFailure } from "./runtime";

it("原样保留 API 错误字段与内容，穿透 SDK 包装，不翻译或脱敏", () => {
  const detail = { message: "当前 API Key 分组下模型 claude-opus-5-5 无可用渠道 test-key", type: "permission_error", code: "channel_unavailable", param: "model", extra: { request_id: "request-1" } };
  const error = Object.assign(new Error("SDK 包装消息"), { status: 403, error: detail });
  const failure = { code: "upstream_failed", httpStatus: 403, message: JSON.stringify(detail, null, 2) };
  expect(readProviderFailure(error)).toEqual(failure);
  expect(readingAgentFailure(new Error("LangChain 包装消息", { cause: error }))).toEqual(failure);
});

it.each([400, 401, 403, 429, 502])("HTTP %i 没有结构化错误时直接使用 SDK 原始消息", status => {
  const error = Object.assign(new Error("原始 API 返回：test-key / body=原文"), { status });
  expect(readProviderFailure(error)).toEqual({ code: "upstream_failed", httpStatus: status, message: error.message });
});

it("字符串错误原样显示；流内错误没有 HTTP status 也保留原始对象", () => {
  expect(readProviderFailure(Object.assign(new Error("SDK 包装消息"), { status: 403, error: "供应商原始正文" }))?.message).toBe("供应商原始正文");
  const detail = { message: "流内错误", code: "stream_error", type: "error" };
  expect(readProviderFailure(Object.assign(new Error("SDK 包装消息"), { error: detail }))).toEqual({ code: "upstream_failed", message: JSON.stringify(detail, null, 2) });
});

it("非供应商异常不被误分类", () => {
  expect(readProviderFailure(new Error("本地异常"))).toBeUndefined();
});

it.each(["APIConnectionTimeoutError", "APIConnectionError"])("连接类错误 %s 使用 SDK 原始消息", name => {
  const error = Object.assign(new Error("原始连接错误 test-key"), { name });
  expect(readProviderFailure(error)).toEqual({ code: "upstream_failed", message: error.message });
});
