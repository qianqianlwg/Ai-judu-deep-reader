export type TokenUsage = {
  inputTokens: number; outputTokens: number; totalTokens: number;
  cachedInputTokens?: number; contextTokens: number; contextWindow: number;
  source: "provider" | "estimated";
};
export function isTokenUsage(value: unknown): value is TokenUsage {
  if(!value || typeof value !== "object") return false;
  const r=value as Record<string,unknown>;
  return ["inputTokens","outputTokens","totalTokens","contextTokens","contextWindow"].every(k=>typeof r[k]==="number"&&Number.isFinite(r[k])&&r[k]>=0) && (r.source==="provider"||r.source==="estimated") && (r.cachedInputTokens===undefined || typeof r.cachedInputTokens==="number"&&Number.isFinite(r.cachedInputTokens)&&r.cachedInputTokens>=0);
}
export function estimateTextTokens(text:string):number { return Math.ceil(new TextEncoder().encode(text).length / 3); }
export function estimatedUsage(input:string,output:string,contextWindow:number):TokenUsage {
  const inputTokens=estimateTextTokens(input),outputTokens=estimateTextTokens(output);
  return {inputTokens,outputTokens,totalTokens:inputTokens+outputTokens,contextTokens:inputTokens+outputTokens,contextWindow,source:"estimated"};
}
// WHY：多步 agent 的本轮消耗相加；窗口占用只取最后一次模型上下文，不能误用累计账单数字。
export function accumulateUsage(previous:TokenUsage|undefined,usage: {input_tokens:number;output_tokens:number;total_tokens:number;input_token_details?:{cache_read?:number}},window:number):TokenUsage{
  return {inputTokens:(previous?.inputTokens??0)+usage.input_tokens,outputTokens:(previous?.outputTokens??0)+usage.output_tokens,totalTokens:(previous?.totalTokens??0)+usage.total_tokens,cachedInputTokens:usage.input_token_details?.cache_read===undefined?previous?.cachedInputTokens:(previous?.cachedInputTokens??0)+usage.input_token_details.cache_read,contextTokens:usage.input_tokens+usage.output_tokens,contextWindow:window,source:previous?.source === "estimated" ? "estimated" : "provider"};
}
