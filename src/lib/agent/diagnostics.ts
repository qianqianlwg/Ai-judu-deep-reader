import { readSourceSchema, saveAnalysisSchema, searchBookSchema } from "./schemas";
const MESSAGES = {
  missing_selection: "本轮没有选文，不能保存句读。",
  unknown_source: "来源未在本轮检索中登记，请先检索再读取。",
  invalid_concepts: "概念名称没有逐字出现在选文中，请删除或修正这些概念后保存。",
  invalid_citation: "引用不是本轮真实原文片段，请核对来源和引文后保存。",
  analysis_length_limit: "工具内容超过本次句读字数预算，请删除重复解释和非必要栏目。",
  tool_schema_invalid: "工具参数格式不符，请按所需字段修正后重试。",
  tool_execution_failed: "工具执行发生异常，诊断记录已保留，请重试。",
} as const;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export function publicToolFailure(value: unknown): { ok: false; code: string; message: string } | undefined {
  if (!record(value)) return;
  let code = typeof value.code === "string" ? value.code : "";
  // WHY：兼容已保存的可识别旧错误，但绝不把任意供应商/数据库异常或审计输入下发到页面。
  if (!code && value.error === "以下概念未逐字出现在选文中，请修正") code="invalid_concepts";
  if (!code && value.error === "引用不是本轮真实来源中的逐字原文，请检索或修正") code="invalid_citation";
  if (!Object.hasOwn(MESSAGES, code)) return;
  return { ok: false, code, message: MESSAGES[code as keyof typeof MESSAGES] };
}
export function diagnoseToolException(name: string, input: unknown) {
  const schema = name === "save_reading_analysis" ? saveAnalysisSchema : name === "read_source" ? readSourceSchema : name === "search_book" ? searchBookSchema : undefined;
  const result = schema?.safeParse(input);
  const fields = result && !result.success ? [...new Set(result.error.issues.flatMap(issue => typeof issue.path[0] === "string" ? [issue.path[0]] : []))] : [];
  const code = result && !result.success ? "tool_schema_invalid" : "tool_execution_failed";
  return { ...publicToolFailure({code})!, error: MESSAGES[code], fields };
}
