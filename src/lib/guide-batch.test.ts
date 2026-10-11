import { expect, it } from 'vitest';
import { guideBatchInputTokens, selectGuideBatch } from './guide-batch';
import type { GuideSource } from './guide-sources';
const source = (id: string, text = '完整句读') : GuideSource => ({ id, bookId: 'b', editionId: 'e', threadId: 't', messageId: id, anchor: { paragraphId: 'p', startOffset: 0, endOffset: 2, selectedText: '原文' }, chapterTitle: '', chapterId: 'c', createdAt: '', analysisText: text });
const capacity = { maxInputTokens: 4096, fixedPrompt: '真实提示词', toolSchema: '真实工具Schema' };
it('独立历史来源一起入批，不截取分析正文', () => { const candidates = [source('a'), source('b'), source('c')]; expect(selectGuideBatch([], candidates, capacity)).toEqual(candidates); expect(selectGuideBatch([], candidates, { ...capacity, maxSources: 2 }).map(s => s.id)).toEqual(['a','b']); });
it('现有节点、工具Schema、正文一起计入真实容量，不容纳则留待后续', () => { const candidates = [source('a'), source('b', '字'.repeat(6000))]; const budget = guideBatchInputTokens([], [candidates[0]], capacity); expect(selectGuideBatch([], candidates, { ...capacity, maxInputTokens: budget }).map(s => s.id)).toEqual(['a']); expect(selectGuideBatch([], candidates, { ...capacity, maxInputTokens: 10 })).toEqual([]); });

it('大图只将真实层级投影计入注入，深层可查，预算为工具预留空间',()=>{
 const nodes=Array.from({length:800},(_,i)=>({id:'n'+i,parentId:i?'n'+(i-1):null,title:'已有节点',summary:'完整摘要'.repeat(30),sourceIds:['a']}));
 const tokens=guideBatchInputTokens(nodes,[source('a')],{...capacity,maxInputTokens:12000});expect(tokens).toBeLessThan(12000);
 expect(selectGuideBatch(nodes,[source('a'),source('b')],{...capacity,maxInputTokens:12000})).toHaveLength(2);
});
