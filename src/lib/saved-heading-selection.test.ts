import { expect, it } from 'vitest';
import { savedSelectionMatchesSource } from './saved-heading-selection';
import { selectionFromParts, selectionMatchesParagraphs } from './reader-selection';
const sources = [{ id: 'a', text: '旧正文' }, { id: 'h', text: '新增标题', kind: 'heading' as const, headingLevel: 2 as const, sourceOrdinal: 1 }, { id: 'b', text: '另一段' }];
it('旧跨标题历史仍按原来的引文核验，但新选区不得省略中间标题', () => { const old = selectionFromParts([{ paragraphId: 'a', text: '旧正文', startOffset: 0, endOffset: 3 }, { paragraphId: 'b', text: '另一段', startOffset: 0, endOffset: 3 }]); expect(savedSelectionMatchesSource(old, sources)).toBe(true); expect(selectionMatchesParagraphs(old, sources)).toBe(false); expect(old.text).toBe('旧正文\n\n另一段'); });
it('仍拒绝正文缺段、错位或篡改，不能用标题兼容补齐不合法来源', () => { const bad = selectionFromParts([{ paragraphId: 'a', text: '旧正文', startOffset: 0, endOffset: 3 }, { paragraphId: 'b', text: '错误字', startOffset: 0, endOffset: 3 }]); expect(savedSelectionMatchesSource(bad, sources)).toBe(false); expect(savedSelectionMatchesSource(selectionFromParts([{ paragraphId: 'a', text: '旧正文', startOffset: 0, endOffset: 3 }, { paragraphId: 'b', text: '另一段', startOffset: 0, endOffset: 3 }]), [sources[0], { id: 'missed', text: '被漏掉正文' }, ...sources.slice(1)])).toBe(false); });

it('升级新增的非标准div来源不拼入旧历史引文，遗漏原有正文依然拒绝',()=>{
 const before=[{id:'a',text:'旧正文'},{id:'b',text:'后段'}];
 const after=[before[0],{id:'epub-block-added',text:'非标准小标题',kind:'paragraph' as const,sourceOrdinal:1},before[1]];
 const saved=selectionFromParts([{paragraphId:'a',startOffset:0,endOffset:3,text:'旧正文'},{paragraphId:'b',startOffset:0,endOffset:2,text:'后段'}]);
 expect(savedSelectionMatchesSource(saved,after)).toBe(true);expect(selectionMatchesParagraphs(saved,after)).toBe(false);
 expect(savedSelectionMatchesSource(saved,[before[0],{id:'old-missing',text:'原有正文'},before[1]])).toBe(false);
});
