import type { ContextMessage, ContextSettings, StructuredCompressionState, CompactionSnapshot, CompactedContext } from "./context-compaction";
import { estimateTextTokens } from "./token-usage";
export type SummaryInput = { previous: StructuredCompressionState; messages: ContextMessage[]; targetTokens: number; inputBudgetTokens: number; outputBudgetTokens: number; signal?: AbortSignal };
export type MemoryDependencies = {
  summarize: (input: SummaryInput) => Promise<StructuredCompressionState>;
  measureInput?: (input: SummaryInput) => number;
  checkpoint?: (snapshot: CompactionSnapshot) => Promise<void>;
  onProgress?: (completed: number, total: number) => void;
  signal?: AbortSignal;
};
export class ContextCompactionError extends Error { constructor(message: string) { super(message); this.name = "ContextCompactionError"; } }
export const emptyMemory = (): StructuredCompressionState => ({ task: "", decisions: [], conclusions: [], openQuestions: [], constraints: [], evidence: [] });
export function renderMemory(state: StructuredCompressionState): string {
  const groups: [string,string[]][] = [["用户约定",state.constraints],["已确定的决定",state.decisions],["概念与结论",state.conclusions],["未解问题",state.openQuestions],["证据标识",state.evidence]];
  return ["阅读记忆摘要（不是权威原文）：", "目标："+state.task, ...groups.filter(([,items])=>items.length).map(([label,items])=>label+"："+items.join("；"))].join("\n");
}
export async function memoryChecksum(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value,(_key,item)=>item && typeof item==="object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))) : item)));
  return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,"0")).join("");
}
const tokens = (messages: ContextMessage[]) => estimateTextTokens(JSON.stringify(messages));
export async function compactMemory(messages: ContextMessage[], settings: ContextSettings, fixedContext: string, previous: CompactionSnapshot | undefined, deps: MemoryDependencies): Promise<CompactedContext> {
  deps.signal?.throwIfAborted();
  const fixedTokens=estimateTextTokens(fixedContext)+512, room=Math.floor(settings.maxInputTokens-fixedTokens-256);
  if(room<128)throw new ContextCompactionError("本轮原文和工具定义已占满输入预算，请提高预算后重试，或缩小选文重新提问");
  let state=emptyMemory(),summary="",covered=0,checkpoint:CompactionSnapshot|undefined;
  if(previous?.sourceChecksum && previous.sourceMessageIds.length<=messages.length && previous.sourceMessageIds.every((id,i)=>id===(messages[i].id??"message-"+i)) && await memoryChecksum(messages.slice(0,previous.sourceMessageIds.length))===previous.sourceChecksum){checkpoint=previous;state=previous.state;summary=previous.summary;covered=previous.sourceMessageIds.length;}
  const makeResult=async(trigger:"none"|"threshold"):Promise<CompactedContext>=>({summary,messages:messages.slice(covered),estimatedTokens:fixedTokens+estimateTextTokens(summary)+tokens(messages.slice(covered)),compacted:!!checkpoint,trigger,snapshot:checkpoint,version:checkpoint?.version??0,previousVersion:checkpoint?.previousVersion??null,sourceMessageIds:checkpoint?.sourceMessageIds??[],state,checksum:checkpoint?.checksum??await memoryChecksum(messages)});
  const active=fixedTokens+estimateTextTokens(summary)+tokens(messages.slice(covered));
  const threshold=settings.maxInputTokens*(settings.compressionStrategy==="conservative"?.85:settings.compressionStrategy==="aggressive"?.65:.75);
  if(active<=settings.maxInputTokens-128 && (active<=threshold || tokens(messages.slice(covered))<256))return makeResult("none");
  const target=Math.max(128,Math.min(2048,Math.floor(room*.4),Math.floor(settings.maxOutputTokens*.5)));
  const input=(prior:StructuredCompressionState,batch:ContextMessage[],goal=target):SummaryInput=>({previous:prior,messages:batch,targetTokens:goal,inputBudgetTokens:settings.maxInputTokens,outputBudgetTokens:settings.maxOutputTokens,signal:deps.signal});
  const measure=deps.measureInput??((value:SummaryInput)=>estimateTextTokens(JSON.stringify({previous:value.previous,messages:value.messages}))+1024);
  const fits=(prior:StructuredCompressionState,batch:ContextMessage[],goal=target)=>measure(input(prior,batch,goal))<=settings.maxInputTokens;
  type Work={message:ContextMessage;covered:number};
  const queue:Work[]=[];
  // WHY：降低预算时先把旧摘要本身当成待整理材料；不能拿“目标大小”假装旧摘要已变小。
  if(summary && (estimateTextTokens(summary)>target || !fits(state,[]))){queue.push({message:{role:"user",content:"已有阅读记忆，重要约定必须保留：\n"+summary},covered});state=emptyMemory();summary="";}
  for(let i=covered;i<messages.length;i++)queue.push({message:messages[i],covered:i+1});
  if(!queue.length && summary)queue.push({message:{role:"user",content:summary},covered});
  let calls=0;
  const invoke=async(prior:StructuredCompressionState,batch:ContextMessage[],goal=target)=>{
    deps.signal?.throwIfAborted();
    if(++calls>128)throw new ContextCompactionError("单次记忆整理次数达到上限，已完成的检查点已保留；可提高预算后重试");
    if(!fits(prior,batch,goal))throw new ContextCompactionError("记忆整理输入仍超预算，请提高预算后重试");
    return deps.summarize(input(prior,batch,goal));
  };
  deps.onProgress?.(covered,messages.length);
  while(queue.length){
    deps.signal?.throwIfAborted();
    const batch:ContextMessage[]=[];let end=covered,boundary=true;
    while(queue.length){
      const work=queue[0];
      // WHY：按实际旧记忆＋实际JSON序列化输入装箱，转义引号/反斜线也纳入预算。
      if(fits(state,[...batch,work.message])){batch.push(work.message);end=work.covered;queue.shift();continue;}
      if(batch.length)break;
      const points=Array.from(work.message.content);let low=1,high=points.length,length=0;
      while(low<=high){const mid=Math.floor((low+high)/2);const part={...work.message,content:points.slice(0,mid).join("")};if(fits(state,[part])){length=mid;low=mid+1;}else high=mid-1;}
      if(!length)throw new ContextCompactionError("当前记忆已占满整理输入预算，请提高预算后重试");
      batch.push({...work.message,content:points.slice(0,length).join("")});queue[0]={...work,message:{...work.message,content:points.slice(length).join("")}};boundary=false;break;
    }
    state=await invoke(state,batch);summary=renderMemory(state);
    for(let retry=0;estimateTextTokens(summary)>target && retry<2;retry++){state=await invoke(state,[],Math.max(64,Math.floor(target*.7)));summary=renderMemory(state);}
    if(estimateTextTokens(summary)>target)throw new ContextCompactionError("模型未将阅读记忆收敛到预算，请提高预算后重试");
    if(boundary){
      // WHY：中途碎片不能被计为整条消息已覆盖；完整边界才允许取消后复用。
      const ids=messages.slice(0,end).map((m,i)=>m.id??"message-"+i);
      const next={version:(checkpoint?.version??0)+1,previousVersion:checkpoint?.version??null,sourceMessageIds:ids,summary,state,sourceChecksum:await memoryChecksum(messages.slice(0,end)),checksum:await memoryChecksum({summary,state,ids}),createdAt:new Date().toISOString()};
      await deps.checkpoint?.(next);checkpoint=next;covered=end;
    }
    deps.onProgress?.(covered,messages.length);
  }
  const result=await makeResult("threshold");
  if(result.estimatedTokens>settings.maxInputTokens-128)throw new ContextCompactionError("阅读记忆仍超出预算，请提高预算后重试");
  return result;
}
