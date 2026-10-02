// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { rangeAroundReaderSentence } from './reader-sentence-geometry';
afterEach(()=>{document.body.innerHTML='';});
describe('原文句子的避让几何来源',()=>{
 it('跨行、嵌套关键词按完整当前句子避让，不包含前后句',()=>{
  document.body.innerHTML='<p data-paragraph-id="p">前句。当前<em>关键词</em>需要读完，后半句不能被遮住。下一句。</p>';
  const term=document.querySelector('em')!, target=document.createRange(); target.selectNodeContents(term);
  const html=document.body.innerHTML;
  expect(rangeAroundReaderSentence(target).toString()).toBe('当前关键词需要读完，后半句不能被遮住。');
  expect(target.toString()).toBe('关键词');expect(document.body.innerHTML).toBe(html);
 });
 it('相同关键词不同句子各自定位，跳过句读装饰文字',()=>{
  document.body.innerHTML='<p>第一句关键词。<span data-reader-decoration>历史入口</span>第二句<strong>关键词</strong>！第三句。</p>';
  const target=document.createRange();target.selectNodeContents(document.querySelector('strong')!);
  expect(rangeAroundReaderSentence(target).toString()).toBe('第二句关键词！');
 });
 it('跨节点长句及英文缩写保持原文，选区不改变',()=>{
  document.body.innerHTML='<p>Before. This is <span>the term</span> in the sentence. After.</p>';
  const target=document.createRange();target.selectNodeContents(document.querySelector('span')!);
  const selection=document.getSelection()!;selection.addRange(target);
  expect(rangeAroundReaderSentence(target).toString().trim()).toBe('This is the term in the sentence.');
  expect(selection.toString()).toBe('the term');selection.removeAllRanges();
 });
});
