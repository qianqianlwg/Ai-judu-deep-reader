import { describe, expect, it } from 'vitest';
import { interruptSemanticReading, readReadingStyle, resolveSemanticPlan } from './semantic-reading';
const source = [{paragraphId:'p',startOffset:4,endOffset:12,selectedText:'甲的意思。乙句。'}];
const unit = (text:string, action:'read'|'skip'='read',reason='') => ({ sourceEmphasis: "无",label:'语义',action,reason,fragments:[{paragraphId:'p',text}]});
describe('Agent 原文语义划分',()=>{
 it('默认细读，保留整体模式',()=>{expect(readReadingStyle(null)).toBe('semantic');expect(readReadingStyle('whole')).toBe('whole');});
 it('同段多块精确定位且允许短句',()=>{let n=0;const r=resolveSemanticPlan({units:[unit('甲的意思。'),unit('乙句。')]},source,()=>String(++n));expect(r.map(u=>[u.anchor.startOffset,u.anchor.endOffset])).toEqual([[4,9],[9,12]]);});
 it('允许略过，但原因及原文必须完整',()=>{expect(resolveSemanticPlan({units:[unit(source[0].selectedText,'skip','内容直白，无需额外解释')]},source,()=> 'id')[0].status).toBe('skipped');expect(()=>resolveSemanticPlan({units:[unit(source[0].selectedText,'skip')]},source,()=> 'id')).toThrow('原因');});
 it.each(['甲的意思。','乙句。甲的意思。','甲的含义。乙句。'])('拒绝遗漏/乱序/改写 %s',text=>{expect(()=>resolveSemanticPlan({units:[unit(text)]},source,()=> 'id')).toThrow();});
 it('不改写空白或猜重复命中',()=>{const s=[{paragraphId:'p',startOffset:0,endOffset:6,selectedText:'同句。同句。'}];expect(resolveSemanticPlan({units:[unit('同句。'),unit('同句。')]},s,()=> 'id')[1].anchor.startOffset).toBe(3);});
 it('同单元同段 fragments 合并',()=>{const u=unit('甲的意思。');u.fragments.push({paragraphId:'p',text:'乙句。'});expect(resolveSemanticPlan({units:[u]},source,()=> 'id')[0].anchor.fragments).toBeUndefined();});
 it('连续跨段和部分选文偏移保持一致',()=>{const sources=[{paragraphId:'p',startOffset:2,endOffset:4,selectedText:'甲。'},{paragraphId:'q',startOffset:0,endOffset:2,selectedText:'乙。'}];const u=unit('甲。');u.fragments.push({paragraphId:'q',text:'乙。'});expect(resolveSemanticPlan({units:[u]},sources,()=> 'id')[0].anchor.fragments).toHaveLength(2);});
 it('拒绝拆开 emoji',()=>{const s=[{paragraphId:'p',startOffset:0,endOffset:3,selectedText:'😀。'}];expect(()=>resolveSemanticPlan({units:[unit('\ud83d'),unit('\ude00。')]},s,()=> 'id')).toThrow('Unicode');});
});

it('短终点定位可精确划分，不需模型抄写全文',()=>{let n=0;const result=resolveSemanticPlan({units:[{ sourceEmphasis: "无",label:'甲',action:'read',reason:'',endParagraphId:'p',endQuote:'甲的意思。'},{ sourceEmphasis: "无",label:'乙',action:'skip',reason:'直白',endParagraphId:'p',endQuote:'乙句。'}]},source,()=>String(++n));expect(result.map(u=>u.anchor.selectedText)).toEqual(['甲的意思。','乙句。']);});
it('终点同文不唯一时要求Agent消歧，不猜首个命中',()=>{const sources=[{paragraphId:'p',startOffset:0,endOffset:6,selectedText:'同句。同句。'}];expect(()=>resolveSemanticPlan({units:[{ sourceEmphasis: "无",label:'甲',action:'read',reason:'',endParagraphId:'p',endQuote:'同句。'}]},sources,()=> 'u')).toThrow('不唯一');});
it('跨段终点自动生成连续来源，不能漏中间原文',()=>{const sources=[{paragraphId:'p',startOffset:0,endOffset:2,selectedText:'甲。'},{paragraphId:'q',startOffset:0,endOffset:2,selectedText:'乙。'}];expect(resolveSemanticPlan({units:[{ sourceEmphasis: "无",label:'甲乙',action:'read',reason:'',endParagraphId:'q',endQuote:'乙。'}]},sources,()=> 'u')[0].anchor.fragments).toHaveLength(2);});

it('停止时只中断活动块，不改变已完成及略过状态',()=>{const units=resolveSemanticPlan({units:[unit('甲的意思。'),unit('乙句。')]},source,()=> 'id');units[0].status='completed';units[1].status='streaming';const saved=interruptSemanticReading({version:1,phase:'reading',units},'已停止');expect(saved?.phase).toBe('interrupted');expect(saved?.units.map(u=>u.status)).toEqual(['completed','error']);expect(units[1].status).toBe('streaming');});

it('历史重点数据格式损坏不进入可渲染结果',async()=>{const {isSemanticReading}=await import('./semantic-reading');const units=resolveSemanticPlan({units:[unit(source[0].selectedText)]},source,()=> 'u');expect(isSemanticReading({version:1,phase:'completed',units})).toBe(true);expect(isSemanticReading({version:1,phase:'completed',units:[{...units[0],sourceEmphasis:'invalid'}]})).toBe(false);});

it("原文标注必填，有明确无才允许不显示，失配交回Agent修正", () => {
  const proposal=unit(source[0].selectedText);
  const {sourceEmphasis: marker,...missing}=proposal;
  expect(marker).toBe("无");
  expect(()=>resolveSemanticPlan({units:[missing]},source,()=>"u")).toThrow();
  expect(()=>resolveSemanticPlan({units:[{...proposal,sourceEmphasis:[]}]},source,()=>"u")).toThrow();
  expect(resolveSemanticPlan({units:[proposal]},source,()=>"u")[0].sourceEmphasis).toEqual([]);
  expect(()=>resolveSemanticPlan({units:[{...proposal,sourceEmphasis:[{paragraphId:"p",kind:"term",quote:"不存在",occurrence:1}]}]},source,()=>"u")).toThrow("原文标注没有全部精确匹配");
});

it('小结字段兼容历史并校验状态与正文类型',async()=>{
 const {isSemanticReading}=await import('./semantic-reading');const state={version:1,phase:'completed',units:[]};
 expect(isSemanticReading(state)).toBe(true);expect(isSemanticReading({...state,conclusion:{status:'completed',content:'AI总述'}})).toBe(true);
 for(const conclusion of [{status:'invalid',content:'正文'},{status:'completed',content:''},{status:'streaming',content:1},{status:'error',content:'',error:42}])expect(isSemanticReading({...state,conclusion})).toBe(false);
});
it('停止保留小结片段并显式中断，不修改已完成句读',()=>{
 const state={version:1 as const,phase:'reading' as const,units:[],conclusion:{status:'streaming' as const,content:'部分小结'}};
 expect(interruptSemanticReading(state,'用户停止')?.conclusion).toEqual({status:'error',content:'部分小结',error:'用户停止'});expect(state.conclusion.status).toBe('streaming');
});
it('会话记录追加真实AI小结，没有小结时不编造总结',async()=>{
 const {semanticSummary}=await import('./semantic-reading');const state={version:1 as const,phase:'completed' as const,units:[]};
 expect(semanticSummary(state)).not.toContain('小结');expect(semanticSummary({...state,conclusion:{status:'completed',content:'AI总结'}})).toContain('### 本次细读小结\n\nAI总结');
});
