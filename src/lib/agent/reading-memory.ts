import { randomUUID } from "node:crypto";
import type { getDb } from "../db";
import type { ProviderConfig } from "../ai-provider";
import { compactContext, type ContextMessage, type ContextSettings, type CompactionSnapshot } from "../context-compaction";
import { memoryChecksum, renderMemory } from "../context-memory";
import { isRecord } from "../chat-stream";
import type { TokenUsage } from "../token-usage";
import { createContextSummarizer, memorySchema, summaryInputTokens } from "./context-summary";
export type ReadingMemoryOptions = { db:ReturnType<typeof getDb>; threadId:string; editionId:string; bookId:string|null; history:ContextMessage[]; settings:ContextSettings; fixedContext:string; config:ProviderConfig; signal:AbortSignal; assertCurrent:()=>void; onUsage:(usage:TokenUsage)=>void; onProgress:(completed:number,total:number)=>void };
export async function decodeMemoryCheckpoint(value:unknown):Promise<CompactionSnapshot|undefined>{
  if(typeof value!=="string")return;
  try{
    const parsed:unknown=JSON.parse(value);
    if(!isRecord(parsed)||!Number.isSafeInteger(parsed.version)||(parsed.version as number)<1||!(parsed.previousVersion===null||Number.isSafeInteger(parsed.previousVersion))||typeof parsed.summary!=="string"||typeof parsed.createdAt!=="string"||typeof parsed.checksum!=="string"||typeof parsed.sourceChecksum!=="string"||!Array.isArray(parsed.sourceMessageIds)||!parsed.sourceMessageIds.every(id=>typeof id==="string"))throw new Error("记忆元数据格式错误");
    if(parsed.promptVersion!==undefined && parsed.promptVersion!=="memory-v2")return;
    const state=memorySchema.parse(parsed.state);
    if(renderMemory(state)!==parsed.summary || await memoryChecksum({summary:parsed.summary,state,ids:parsed.sourceMessageIds})!==parsed.checksum)throw new Error("记忆摘要校验失败");
    return {version:parsed.version as number,previousVersion:parsed.previousVersion as number|null,summary:parsed.summary,state,sourceMessageIds:parsed.sourceMessageIds,sourceChecksum:parsed.sourceChecksum,checksum:parsed.checksum,createdAt:parsed.createdAt};
  }catch(error:unknown){console.warn("阅读记忆检查点不可用，将从原对话重新整理",{name:error instanceof Error?error.name:"UnknownError"});return;}
}
export async function prepareReadingMemory(options:ReadingMemoryOptions){
  const {db,signal}=options;
  const rows=db.prepare("SELECT checkpoint_json FROM context_snapshots WHERE thread_id=? AND edition_id=? AND checkpoint_json IS NOT NULL ORDER BY created_at DESC LIMIT 20").all(options.threadId,options.editionId) as {checkpoint_json:string|null}[];
  let previous:CompactionSnapshot|undefined;
  for(const row of rows){const candidate=await decodeMemoryCheckpoint(row.checkpoint_json);if(candidate && candidate.sourceMessageIds.length<=options.history.length && candidate.sourceMessageIds.every((id,i)=>id===(options.history[i].id??"message-"+i)) && candidate.sourceChecksum===await memoryChecksum(options.history.slice(0,candidate.sourceMessageIds.length))){previous=candidate;break;}}
  const summarize=createContextSummarizer(options.config,options.onUsage);
  return compactContext(options.history,options.settings,options.fixedContext,previous,{
    signal,summarize,measureInput:summaryInputTokens,onProgress:options.onProgress,
    async checkpoint(snapshot){
      signal.throwIfAborted();options.assertCurrent();
      // WHY：每批完整消息保存可复用检查点，取消或超时后重试不必从头付费整理历史。
      db.prepare("INSERT INTO context_snapshots (id,thread_id,book_id,edition_id,summary,recent_messages,token_count,version,created_at,checkpoint_json) VALUES (?,?,?,?,?,?,?,?,?,?)").run(randomUUID(),options.threadId,options.bookId,options.editionId,snapshot.summary,"[]",Math.ceil(new TextEncoder().encode(snapshot.summary).length/3),snapshot.version,snapshot.createdAt,JSON.stringify({...snapshot,modelName:options.config.model,promptVersion:"memory-v2"}));
    },
  });
}
