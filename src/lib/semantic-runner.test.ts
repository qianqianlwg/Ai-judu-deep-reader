import { describe, expect, it, vi } from 'vitest';
import { resolveSemanticPlan, type SemanticReading } from './semantic-reading';
import { runSemanticUnits } from './semantic-runner';
const source=[{paragraphId:'p',startOffset:0,endOffset:4,selectedText:'甲。乙。'}];
function plan(){let n=0;return resolveSemanticPlan({units:['甲。','乙。'].map(text=>({label:text,action:'read',reason:'',fragments:[{paragraphId:'p',text}]}))},source,()=>String(++n));}
const answer={text:'解释',analysis:{readingText:'解释',summary:'',breakdown:[],concepts:[],context:'',uncertainty:''}};
describe('语义任务续跑',()=>{
 it('失败只留下未完成块，继续时不重跑成功块',async()=>{let saved:SemanticReading|undefined;const read=vi.fn().mockResolvedValueOnce(answer).mockRejectedValueOnce(new Error('断流'));const commit=vi.fn();const d={signal:new AbortController().signal,plan:async()=>plan(),read,publish:(s:SemanticReading)=>{saved=s;},commit};await expect(runSemanticUnits(d)).rejects.toThrow('断流');expect(saved?.units.map(u=>u.status)).toEqual(['completed','error']);const next=vi.fn().mockResolvedValue(answer);const result=await runSemanticUnits({...d,previous:saved,plan:vi.fn(),read:next});expect(next).toHaveBeenCalledTimes(1);expect(result.phase).toBe('completed');expect(commit).toHaveBeenCalledTimes(2);});
 it('全略过是有明确说明的完成，不调用解释模型',async()=>{const units=plan().map(u=>({...u,action:'skip' as const,status:'skipped' as const,reason:'原文直白'}));const read=vi.fn();const result=await runSemanticUnits({signal:new AbortController().signal,plan:async()=>units,read,publish:vi.fn(),commit:vi.fn()});expect(read).not.toHaveBeenCalled();expect(result.units.every(u=>u.status==='skipped')).toBe(true);});
 it('提交失败不能误报完成',async()=>{let saved:SemanticReading|undefined;await expect(runSemanticUnits({signal:new AbortController().signal,plan:async()=>plan(),read:async()=>answer,publish:s=>{saved=s;},commit:()=>{throw new Error('写入失败');}})).rejects.toThrow('写入失败');expect(saved?.units[0].status).toBe('error');});
 it('取消不提交正在生成的块',async()=>{const abort=new AbortController();const commit=vi.fn();await expect(runSemanticUnits({signal:abort.signal,plan:async()=>plan(),read:async()=>{abort.abort();return answer;},publish:vi.fn(),commit})).rejects.toThrow();expect(commit).not.toHaveBeenCalled();});
});
