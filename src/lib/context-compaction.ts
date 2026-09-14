import { compactMemory, type MemoryDependencies } from "./context-memory";
import { estimateTextTokens } from "./token-usage";
export type ContextMessage = { role: "user" | "assistant"; content: string; id?: string };
export type ContextSettings = { maxInputTokens: number; maxOutputTokens: number; compressionStrategy: "conservative" | "balanced" | "aggressive" };
export type StructuredCompressionState = { task: string; decisions: string[]; conclusions: string[]; openQuestions: string[]; constraints: string[]; evidence: string[] };
export type CompactionSnapshot = { version: number; previousVersion: number | null; sourceMessageIds: string[]; summary: string; state: StructuredCompressionState; sourceChecksum?: string; checksum: string; createdAt: string };
export type CompactedContext = { summary: string; messages: ContextMessage[]; estimatedTokens: number; compacted: boolean; trigger: "none" | "threshold"; snapshot?: CompactionSnapshot; version: number; previousVersion: number | null; sourceMessageIds: string[]; state: StructuredCompressionState; checksum: string };
export const DEFAULT_CONTEXT_SETTINGS: ContextSettings = { maxInputTokens: 32768, maxOutputTokens: 4096, compressionStrategy: "balanced" };
export function estimateTokens(value: string): number { return Math.max(1,estimateTextTokens(value)); }
export async function compactContext(messages:ContextMessage[],settings:ContextSettings=DEFAULT_CONTEXT_SETTINGS,fixedContext="",previous?:CompactionSnapshot,deps?:MemoryDependencies):Promise<CompactedContext>{
  return compactMemory(messages,settings,fixedContext,previous,deps??{summarize:async()=>{throw new Error("未配置阅读记忆整理模型");}});
}
export function validateCompactedContext(value: unknown): value is CompactedContext {
  if(!value || typeof value!=="object")return false;const x=value as Partial<CompactedContext>;
  return typeof x.summary==="string" && Array.isArray(x.messages) && typeof x.estimatedTokens==="number" && Number.isFinite(x.estimatedTokens) && typeof x.version==="number" && (x.previousVersion===null || typeof x.previousVersion==="number") && Array.isArray(x.sourceMessageIds) && typeof x.checksum==="string" && !!x.state && typeof x.state==="object";
}
