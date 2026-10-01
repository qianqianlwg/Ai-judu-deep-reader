import { describe,it,expect,vi } from 'vitest';
import { AIMessageChunk,type BaseMessageLike } from '@langchain/core/messages';
import { runIncrementalReading,SENTENCE_TOOL,type IncrementalOptions,type SentenceStep } from './semantic-incremental';
import type { SemanticReading } from '../semantic-reading';
const sentences=['商品具有使用价值。','价值体现社会关系。'];const text=sentences.join('');
const submit=(t:string)=>({sourceStart:Array.from(t).slice(0,Math.min(8,Array.from(t).length)).join(''),sourceEnd:Array.from(t).slice(-Math.min(8,Array.from(t).length)).join(''),title:t,content:'对应的解释',sourceAnnotations:{keywords:'none',keySentences:'none',concepts:'none'},answerEmphasis:{keywords:'none',keySentences:'none'}});
const result=(args:Record<string,unknown>):SentenceStep=>({chunk:new AIMessageChunk({content:'',tool_calls:[{id:crypto.randomUUID(),name:SENTENCE_TOOL,args,type:'tool_call'}]}),usage:{inputTokens:20000,outputTokens:18000,totalTokens:38000,contextTokens:38000,contextWindow:200000,source:'provider'}});
function setup(responses:Record<string,unknown>[]){const states:SemanticReading[]=[];const prompts:BaseMessageLike[][]=[];const o:IncrementalOptions={config:{provider:'openai',model:'mock',apiKey:'test',baseUrl:'https://model.test'},sources:[{paragraphId:'p',startOffset:0,endOffset:text.length,selectedText:text}],context:'',messages:[],detail:'brief',difficulty:'beginner',signal:new AbortController().signal,contextWindow:200000,publish:s=>states.push(s),commit:vi.fn(),audit:vi.fn(async()=>{}),onUsage:vi.fn(),conclude:vi.fn(async()=>({content:'整体主旨与句间关系。',usage:result({}).usage})),step:vi.fn(async(messages,onStart)=>{prompts.push(structuredClone(messages));onStart();return result(responses.shift()!);})};return {o,states,prompts};}
describe('单工具增量句读',()=>{
 it('第一句已提交时第二句尚未生成，累计Token大于旧预算也不停止',async()=>{const {o,states}=setup(sentences.map(submit));const state=await runIncrementalReading(o);expect(state.phase).toBe('completed');expect(o.commit).toHaveBeenCalledTimes(2);expect(states.some(s=>s.units.length===1&&s.phase==='reading')).toBe(true);expect(states[0]).toMatchObject({phase:'planning',thinkingCompleted:false});expect(states.some(s=>s.phase==='reading'&&s.pending?.index===1&&s.thinkingCompleted)).toBe(true);});
 it('来源失败交给Agent修正，不发布伪标注，已完成句不重做',async()=>{const {o,states,prompts}=setup([submit(sentences[0]),{...submit(sentences[1]),sourceStart:'不存在的字'},submit(sentences[1])]);await runIncrementalReading(o);expect(o.commit).toHaveBeenCalledTimes(2);expect(o.audit).toHaveBeenCalledWith(expect.objectContaining({status:'error'}));expect(states.some(s=>s.pending?.error?.includes('找不到对应语句'))).toBe(true);expect(JSON.stringify(prompts.at(-1))).toContain('找不到对应语句');});
 it('兼容旧计划：未来略过块不能跨越待处理原文，完成结果仍保留',async()=>{const first=setup(sentences.map(submit));const saved=await runIncrementalReading(first.o);const next=setup([submit(sentences[1]),submit('图。')]);const extra='图。';next.o.sources[0]={...next.o.sources[0],selectedText:text+extra,endOffset:text.length+extra.length};next.o.previous={...saved,phase:'interrupted',units:[saved.units[0],{...saved.units[1],status:'pending',content:''},{...saved.units[1],id:'skip',action:'skip',status:'skipped',anchor:{paragraphId:'p',startOffset:text.length,endOffset:text.length+extra.length,selectedText:extra}}]};expect((await runIncrementalReading(next.o)).units).toHaveLength(3);expect(next.o.commit).toHaveBeenCalledTimes(2);});
 it('中断保留完成块，重试只继续未处理原文',async()=>{const first=setup(sentences.map(submit));const controller=new AbortController();first.o.signal=controller.signal;first.o.commit=vi.fn(()=>controller.abort());await expect(runIncrementalReading(first.o)).rejects.toThrow();const saved=first.states.at(-1)!;expect(saved.phase).toBe('interrupted');expect(saved.units).toHaveLength(1);const next=setup([submit(sentences[1])]);next.o.previous=saved;const done=await runIncrementalReading(next.o);expect(done.units).toHaveLength(2);expect(next.o.commit).toHaveBeenCalledOnce();});
 it('三次失败明确报错，不吞异常、不修改已完成记录',async()=>{const {o,states}=setup(Array.from({length:3},()=>({...submit(text),sourceAnnotations:{keywords:undefined,keySentences:'none',concepts:'none'}})));await expect(runIncrementalReading(o)).rejects.toThrow('三次未通过');expect(o.commit).not.toHaveBeenCalled();expect(states.at(-1)?.phase).toBe('interrupted');});
 it('保留完整任务与最近工具闭环，逐句历史不会无限增长',async()=>{const {o,prompts}=setup(Array.from({length:3},()=>submit('甲。')));o.sources=[{paragraphId:'p',startOffset:0,endOffset:6,selectedText:'甲。甲。甲。'}];await runIncrementalReading(o);expect(prompts.map(p=>p.length)).toEqual([2,4,4]);expect(JSON.stringify(prompts[2])).toContain('甲。甲。甲。');});
 it('事务或审计失败上抛，不假装工具成功',async()=>{const {o,states}=setup(sentences.map(submit));o.commit=()=>{throw new Error('数据库失败');};await expect(runIncrementalReading(o)).rejects.toThrow('数据库失败');expect(states.at(-1)?.units).toEqual([]);});
});

it('小结严格在最后一次工具提交与审计后生成，且流式正文先于完成发布',async()=>{
 const {o,states}=setup(sentences.map(submit));const order:string[]=[];
 o.commit=()=>{order.push('commit');};o.audit=async()=>{order.push('audit');};
 o.conclude=vi.fn(async(state,onText)=>{order.push('conclude');expect(state.units).toHaveLength(2);expect(state.pending).toBeUndefined();onText('小结片段');return {content:'AI总体解释',usage:result({}).usage};});
 const done=await runIncrementalReading(o);
 expect(order).toEqual(['commit','audit','commit','audit','conclude']);expect(states.some(s=>s.phase==='reading'&&s.conclusion?.content==='小结片段')).toBe(true);expect(done.conclusion).toEqual({status:'completed',content:'AI总体解释'});
});
it('小结失败后重试仅再次生成小结，句读身份不变、不重写工具结果',async()=>{
 const first=setup(sentences.map(submit));first.o.conclude=async(_state,onText)=>{onText('部分小结');throw new Error('上游原始403');};
 await expect(runIncrementalReading(first.o)).rejects.toThrow('上游原始403');const saved=first.states.at(-1)!;
 expect(saved.conclusion).toEqual({status:'error',content:'部分小结',error:'上游原始403'});expect(saved.units.every(u=>u.status==='completed')).toBe(true);
 const retry=setup([]);retry.o.previous=saved;const done=await runIncrementalReading(retry.o);
 expect(retry.o.step).not.toHaveBeenCalled();expect(retry.o.commit).not.toHaveBeenCalled();expect(retry.o.conclude).toHaveBeenCalledOnce();expect(done.units.map(u=>u.id)).toEqual(saved.units.map(u=>u.id));
});
it('原文工具核验失败不能提前生成小结',async()=>{
 const {o}=setup(Array.from({length:3},()=>({...submit(text),sourceStart:'不存在'})));await expect(runIncrementalReading(o)).rejects.toThrow();expect(o.conclude).not.toHaveBeenCalled();
});
