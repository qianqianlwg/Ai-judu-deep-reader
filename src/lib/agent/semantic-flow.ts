import { randomUUID } from 'node:crypto';
import type { getDb } from '../db';
import type { ProviderConfig,ProviderMessage } from '../ai-provider';
import type { ContextSettings } from '../context-compaction';
import type { ChatEvent,Analysis } from '../chat-stream';
import { anchorParts, type ReadingAnchorPart } from '../reading-anchors';
import { type SemanticReading, type SemanticUnit } from '../semantic-reading';
import { runSemanticUnits, semanticUnitText } from '../semantic-runner';
import { planSemanticReading } from './semantic-planner';
import { createBookSources } from './book-sources';
import { sourceIdForParagraph } from '../citation-validation';
import { runReadingAgent,type ToolRun } from './runtime';
import { readingSystemPrompt } from './prompt';
import { estimatedUsage, type TokenUsage } from '../token-usage';
import { inferAnswerEmphasis } from '../answer-emphasis';
import type { BookSource, ReadingToolDependencies } from './tools';
import type { ReadingDetail } from '../reading-detail';
import type { ReadingDifficulty } from '../reading-preferences';
import type { ReadingAgentOptions } from './runtime';
export function addSemanticUsage(base:TokenUsage|undefined,next:TokenUsage):TokenUsage{return {...next,inputTokens:(base?.inputTokens??0)+next.inputTokens,outputTokens:(base?.outputTokens??0)+next.outputTokens,totalTokens:(base?.totalTokens??0)+next.totalTokens,cachedInputTokens:(base?.cachedInputTokens??0)+(next.cachedInputTokens??0),source:base?.source==='estimated'||next.source==='estimated'?'estimated':'provider'};}
export type SemanticFlowOptions={db:ReturnType<typeof getDb>;editionId:string;config:ProviderConfig;settings:ContextSettings;sources:ReadingAnchorPart[];providedSources?:BookSource[];context:string;messages:ProviderMessage[];detail:ReadingDetail;difficulty:ReadingDifficulty;forceRead:boolean;previous?:SemanticReading;initialUsage?:TokenUsage;signal:AbortSignal;search:ReadingToolDependencies['search'];external?:ReadingAgentOptions['external'];publish:(s:SemanticReading,content:string)=>void;commit:(u:SemanticUnit,s:SemanticReading)=>void;emit:(event:ChatEvent)=>void;audit:(run:ToolRun)=>Promise<void>};
export async function executeSemanticFlow(o:SemanticFlowOptions){
 let usage=o.initialUsage;const planBase=usage;
 const sourceText=o.sources.map(p=>p.selectedText).join('\n\n');
 const taskBudget=Math.max(32000,Math.min(500000,o.settings.maxInputTokens*3));
 const onUsage=(next:TokenUsage)=>{usage=next;o.emit({type:'usage',usage:next});};
 let planUnits=o.previous?.units??[];
 const state=await runSemanticUnits({previous:o.previous,signal:o.signal,publish:o.publish,commit:o.commit,
  plan:async()=>{const units=await planSemanticReading({config:o.config,sources:o.sources,context:o.context,forceRead:o.forceRead,maxInputTokens:o.settings.maxInputTokens,maxOutputTokens:o.settings.maxOutputTokens,signal:o.signal,makeId:randomUUID,
   onUsage:next=>onUsage(addSemanticUsage(planBase,next)),
   audit:async(input,output,ok)=>o.audit({id:randomUUID(),name:'plan_reading_units',input,output,status:ok?'completed':'error'}),
  });planUnits=units;return units;},
  read:async(unit,onText)=>{
   if((usage?.totalTokens??0)>=taskBudget)throw new Error('本次细读达到任务 Token 安全预算，已完成内容保留；可继续未完成部分。');
   const repository=createBookSources(o.db,o.editionId),parts=anchorParts(unit.anchor);
   for(const source of o.providedSources??[])repository.registered.set(source.sourceId,source);
   repository.initial(parts[0].paragraphId,parts[0].startOffset);
   for(const part of parts){const row=o.db.prepare('SELECT p.chapter_id,c.title FROM paragraphs p JOIN chapters c ON c.id=p.chapter_id WHERE p.id=? AND c.edition_id=?').get(part.paragraphId,o.editionId) as {chapter_id:string;title:string}|undefined;if(!row)throw new Error('原文来源不存在');const id=sourceIdForParagraph(o.editionId,part.paragraphId);const old=repository.registered.get(id);repository.registered.set(id,{sourceId:id,paragraphId:part.paragraphId,chapterId:row.chapter_id,chapterTitle:row.title,text:part.selectedText,origin:'context',excerpts:[part.selectedText,...(old?[old.text]:[])]});}
   const text=semanticUnitText(unit),base=usage;let raw='',analysis:Analysis|undefined,last=0;
   const system=readingSystemPrompt('analyze',text,o.detail,o.difficulty)+'\n本轮是按句意细读中的一个独立语义块。只释读当前块，不输出序号、小标题或本节总评。上下文仅帮助解释指代；极短原文无需凑到40字，保持自然精简。';
   const result=await runReadingAgent({config:o.config,systemPrompt:system,
    messages:[...o.messages,{role:'user',content:JSON.stringify({task:'解释当前语义块',label:unit.label,selectedText:text,context:o.context,sources:[...repository.registered.values()],plan:planUnits.map(u=>({label:u.label,action:u.action})),scopeContext:sourceText.length<=6000?sourceText:undefined})}],
    maxOutputTokens:o.settings.maxOutputTokens,contextWindow:o.settings.maxInputTokens+o.settings.maxOutputTokens,signal:o.signal,
    external:o.external?{...o.external,selectedText:text}:undefined,
    tools:{messageId:unit.id,selectedText:text,anchor:unit.anchor,detail:o.detail,sources:repository.registered,search:o.search,read:repository.read,save:async value=>{analysis=value;}},
    audit:run=>o.audit({...run,id:unit.id+":"+run.id,input:{unitId:unit.id,arguments:run.input}}),
    emit:event=>{if(event.type==='raw_delta'){raw+=event.text;if(Date.now()-last>120){onText(raw);last=Date.now();}}else if(event.type==='usage')onUsage(addSemanticUsage(base,event.usage));else if(event.type==='tool')o.emit({...event,tool:{...event.tool,id:unit.id+':'+event.tool.id}});},
   });
   analysis={...(analysis??{summary:'',breakdown:[],concepts:[],context:'',uncertainty:'',citations:[]}),readingText:result.text,provenanceVersion:1,emphasis:analysis?.emphasis??inferAnswerEmphasis(result.text)};
   onUsage(addSemanticUsage(base,result.usage));return {text:result.text,analysis,usage:result.usage};
  },
 });
 return {state,usage:usage??estimatedUsage('','',o.settings.maxInputTokens+o.settings.maxOutputTokens)};
}
