import type { getDb } from '../db';
import type { ProviderConfig,ProviderMessage } from '../ai-provider';
import type { ContextSettings } from '../context-compaction';
import type { ChatEvent } from '../chat-stream';
import type { ReadingAnchorPart } from '../reading-anchors';
import type { SemanticReading,SemanticUnit } from '../semantic-reading';
import { estimatedUsage,type TokenUsage } from '../token-usage';
import type { BookSource,ReadingToolDependencies } from './tools';
import type { ReadingDetail } from '../reading-detail';
import type { ReadingDifficulty } from '../reading-preferences';
import type { ReadingAgentOptions,ToolRun } from './runtime';
import { runIncrementalReading, streamSentence } from './semantic-incremental';
export function addSemanticUsage(base:TokenUsage|undefined,next:TokenUsage):TokenUsage{return {...next,inputTokens:(base?.inputTokens??0)+next.inputTokens,outputTokens:(base?.outputTokens??0)+next.outputTokens,totalTokens:(base?.totalTokens??0)+next.totalTokens,cachedInputTokens:(base?.cachedInputTokens??0)+(next.cachedInputTokens??0),source:base?.source==='estimated'||next.source==='estimated'?'estimated':'provider'};}
export type SemanticFlowOptions={readingStyle?:'semantic'|'whole';db:ReturnType<typeof getDb>;editionId:string;config:ProviderConfig;settings:ContextSettings;sources:ReadingAnchorPart[];providedSources?:BookSource[];context:string;messages:ProviderMessage[];detail:ReadingDetail;difficulty:ReadingDifficulty;forceRead:boolean;previous?:SemanticReading;initialUsage?:TokenUsage;signal:AbortSignal;search:ReadingToolDependencies['search'];external?:ReadingAgentOptions['external'];publish:(s:SemanticReading,content:string)=>void;commit:(u:SemanticUnit,s:SemanticReading)=>void;emit:(event:ChatEvent)=>void;audit:(run:ToolRun)=>Promise<void>};
export async function executeSemanticFlow(o:SemanticFlowOptions){
  let usage=o.initialUsage;
  // WHY：逐句工具每次直接提交完整结果；不再先等待整份规划，也不以累计 Token 预算取消细读。
  const state=await runIncrementalReading({...o,step:(messages,onStart)=>streamSentence(o.config,messages,o.signal,o.settings.maxInputTokens+o.settings.maxOutputTokens,onStart),contextWindow:o.settings.maxInputTokens+o.settings.maxOutputTokens,onUsage(next){usage=addSemanticUsage(usage,next);o.emit({type:'usage',usage});}});
  return {state,usage:usage??estimatedUsage('','',o.settings.maxInputTokens+o.settings.maxOutputTokens)};
}
