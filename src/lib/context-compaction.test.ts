import { describe, expect, it, vi } from "vitest";
import { compactContext, estimateTokens, normalizeContextInputTokens, validateCompactedContext, type ContextMessage } from "./context-compaction";
import { emptyMemory, type SummaryInput } from "./context-memory";
const settings={maxInputTokens:4096,maxOutputTokens:1024,compressionStrategy:"balanced" as const};
const messages:ContextMessage[]=Array.from({length:100},(_,i)=>({id:"m"+i,role:i%2?"assistant":"user",content:(i===0?"必须使用中文，只引用贺麟译本，不要摘要代替原著。":"阅读论证与概念讨论。").repeat(100)}));
const summarize=vi.fn(async(input:SummaryInput)=>({...emptyMemory(),task:"理解原著",constraints:["使用中文，只引用贺麟译本，不用摘要代替原著"],conclusions:input.previous.conclusions}));
describe("预算驱动语义压缩",()=>{
  it("预算内原样保留历史，不调用整理模型",async()=>{const model=vi.fn(summarize);const input=[{role:"user" as const,content:"你好",id:"m1"}];const result=await compactContext(input,settings,"",undefined,{summarize:model});expect(result.messages).toEqual(input);expect(result.compacted).toBe(false);expect(model).not.toHaveBeenCalled();});
  it("100条长中文历史最终收敛4096预算，不保留35条历史",async()=>{const result=await compactContext(messages,settings,"",undefined,{summarize});expect(result.estimatedTokens).toBeLessThanOrEqual(4096);expect(result.messages).toEqual([]);expect(result.sourceMessageIds).toHaveLength(100);expect(result.state.constraints.join()).toContain("贺麟译本");expect(validateCompactedContext(result)).toBe(true);});
  it("有检查点后只追加新消息，摘要前缀不随每轮改变",async()=>{const first=await compactContext(messages.slice(0,10),settings,"",undefined,{summarize});const model=vi.fn(summarize);const added={id:"new",role:"user" as const,content:"继续刚才问题"};const next=await compactContext([...messages.slice(0,10),added],settings,"",first.snapshot,{summarize:model});expect(next.summary).toBe(first.summary);expect(next.messages).toEqual([added]);expect(model).not.toHaveBeenCalled();expect(next.version).toBe(first.version);});
  it("旧消息改变则不能复用摘要",async()=>{const first=await compactContext(messages.slice(0,5),settings,"",undefined,{summarize});const changed=messages.slice(0,5).map((m,i)=>i?m:{...m,content:m.content+"不同版本"});const model=vi.fn(summarize);await compactContext(changed,settings,"",first.snapshot,{summarize:model});expect(model).toHaveBeenCalled();});
  it("原文已占满预算时不私自截断原文",async()=>{await expect(compactContext([],settings,"原文".repeat(4000),undefined,{summarize})).rejects.toThrow("原文和工具");});
  it("上下文设置只向用户暴露200K、400K、1M三档，旧值回退默认档",()=>{expect(normalizeContextInputTokens("200000")).toBe(200000);expect(normalizeContextInputTokens(400000)).toBe(400000);expect(normalizeContextInputTokens("1000000")).toBe(1000000);expect(normalizeContextInputTokens("131072")).toBe(200000);});
  it("估算空文本安全、损坏摘要不合法",()=>{expect(estimateTokens("")).toBe(1);expect(validateCompactedContext({summary:"x"})).toBe(false);});
});
