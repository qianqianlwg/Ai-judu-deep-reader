import { describe,it,expect } from 'vitest';
import { semanticProgress } from './semantic-progress';
import type { SemanticReading,SemanticUnit } from './semantic-reading';
const unit:SemanticUnit={id:'u',label:'句',action:'read',reason:'',anchor:{paragraphId:'p',startOffset:0,endOffset:4,selectedText:'😀商品。'},status:'completed',content:'正文'};
const state:SemanticReading={version:1,phase:'planning',units:[],totalCharacters:8,thinkingCompleted:false};
describe('10%思考＋90%原文字数进度',()=>{
 it('思考时0，完成思考10，完成一半原文55，全部100',()=>{expect(semanticProgress(state).percent).toBe(0);expect(semanticProgress({...state,phase:'reading',thinkingCompleted:true}).percent).toBe(10);expect(semanticProgress({...state,phase:'reading',thinkingCompleted:true,units:[unit]})).toMatchObject({percent:55,processed:4,completed:1});expect(semanticProgress({...state,phase:'completed',thinkingCompleted:true,units:[unit,{...unit,id:'v'}]}).percent).toBe(100);});
 it('pending、错误、中断不会冒充完成，恢复保留真实进度',()=>{expect(semanticProgress({...state,phase:'interrupted',thinkingCompleted:true,units:[unit,{...unit,id:'v',status:'error'}]}).percent).toBe(55);expect(semanticProgress({...state,pending:{index:1},units:[{...unit,status:'streaming'}]}).percent).toBe(0);});
 it('兼容旧历史但不把新协议略过字数算成已句读',()=>{expect(semanticProgress({version:1,phase:'completed',units:[unit]}).percent).toBe(100);expect(semanticProgress({...state,phase:'reading',thinkingCompleted:true,units:[{...unit,status:'skipped',action:'skip'}]}).percent).toBe(10);});
});
