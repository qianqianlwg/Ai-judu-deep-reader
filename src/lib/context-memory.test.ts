import { describe, expect, it, vi } from "vitest";
import { compactMemory, emptyMemory, memoryChecksum, type SummaryInput } from "./context-memory";
import { summaryInputTokens } from "./agent/context-summary";
import type { CompactionSnapshot, ContextMessage } from "./context-compaction";
const settings={maxInputTokens:4096,maxOutputTokens:1024,compressionStrategy:"balanced" as const};
const brief=async()=>({...emptyMemory(),task:"原著阅读",constraints:["必须保留中文约定"]});
describe("记忆检查点与超长消息",()=>{
  it("对象键顺序不影响SHA256，正文变化一定改变校验",async()=>{expect(await memoryChecksum({a:1,b:2})).toBe(await memoryChecksum({b:2,a:1}));expect(await memoryChecksum({a:2})).not.toBe(await memoryChecksum({a:1}));});
  it("每次摘要调用都按预算切分，超长单条不按字符截掉尾部",async()=>{const received:string[]=[];const messages:ContextMessage[]=[{id:"long",role:"user",content:"开始😀"+"中文观点".repeat(3000)+"尾部重要约定"}];const result=await compactMemory(messages,settings,"",undefined,{summarize:async input=>{expect(Math.ceil(new TextEncoder().encode(JSON.stringify(input.messages)).length/3)).toBeLessThan(input.inputBudgetTokens);received.push(...input.messages.map(m=>m.content));return brief();}});expect(received.join("")).toBe(messages[0].content);expect(result.sourceMessageIds).toEqual(["long"]);expect(result.messages).toHaveLength(0);});
  it("取消后复用已完成的完整消息检查点，不重复处理前缀",async()=>{const messages:ContextMessage[]=Array.from({length:15},(_,i)=>({id:"m"+i,role:"user",content:"中文约定".repeat(200)}));let saved:CompactionSnapshot|undefined;const abort=new AbortController();await expect(compactMemory(messages,settings,"",undefined,{signal:abort.signal,summarize:brief,checkpoint:async snapshot=>{saved=snapshot;abort.abort();}})).rejects.toThrow();expect(saved?.sourceMessageIds.length).toBeGreaterThan(0);const seen:string[]=[];await compactMemory(messages,settings,"",saved,{summarize:async input=>{seen.push(...input.messages.map(m=>m.id!));return brief();}});expect(seen).not.toContain(messages[0].id);});
  it("过大的模型摘要必须再次压缩，不用字符串裁剪假装成功",async()=>{const model=vi.fn(async(input:SummaryInput)=>({...emptyMemory(),task:input.messages.length?"过长".repeat(1000):"简短目标"}));const result=await compactMemory([{id:"m",role:"user",content:"原文".repeat(2000)}],settings,"",undefined,{summarize:model});expect(model.mock.calls.some(([input])=>!input.messages.length)).toBe(true);expect(result.estimatedTokens).toBeLessThanOrEqual(4096);});
});

it("8192降至4096时先缩小带转义字符的旧摘要，再处理新增历史",async()=>{
 const original:ContextMessage[]=[{id:"old",role:"user",content:"旧阅读历史".repeat(1800)}];
 const quoted={...emptyMemory(),task:"必须保留中文阅读约定",constraints:Array.from({length:8},()=>('保留\"术语\"与\\引用 ').repeat(28))};
 const first=await compactMemory(original,{...settings,maxInputTokens:8192,maxOutputTokens:4096},"",undefined,{summarize:async()=>quoted,measureInput:summaryInputTokens});
 expect(summaryInputTokens({previous:quoted,messages:[{id:"new",role:"user",content:"新增历史".repeat(375)}],targetTokens:512,inputBudgetTokens:4096,outputBudgetTokens:1024})).toBeGreaterThan(4096);
 const seen:SummaryInput[]=[];
 const next=await compactMemory([...original,{id:"new",role:"user",content:"新增历史".repeat(375)}],settings,"",first.snapshot,{measureInput:summaryInputTokens,summarize:async value=>{expect(summaryInputTokens(value)).toBeLessThanOrEqual(4096);seen.push(value);return {...emptyMemory(),task:"继续阅读",constraints:["必须保留中文阅读约定"]};}});
 expect(seen.length).toBeGreaterThan(0);expect(next.estimatedTokens).toBeLessThanOrEqual(4096);expect(next.sourceMessageIds).toEqual(["old","new"]);expect(next.state.constraints).toContain("必须保留中文阅读约定");
});
