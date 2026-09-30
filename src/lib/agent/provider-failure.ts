import { isRecord } from "../chat-stream";

export type ProviderFailure = { code: string; message: string; httpStatus?: number };

export function readProviderFailure(error: Error): ProviderFailure | undefined {
  const value: unknown = error;
  if (!isRecord(value)) return;
  const status = typeof value.status === "number" && Number.isInteger(value.status) ? value.status : undefined;
  if (status === undefined && value.error === undefined && !["APIConnectionError", "APIConnectionTimeoutError"].includes(error.name)) return;
  // WHY：直接显示 SDK 保留的 API 错误内容，不分类改写、不加模型前缀，也不脱敏或裁剪上游字段。
  const detail = value.error;
  const message = detail == null ? error.message : typeof detail === "string" ? detail : JSON.stringify(detail, null, 2);
  return { code: "upstream_failed", message: message ?? error.message, ...(status === undefined ? {} : { httpStatus: status }) };
}
