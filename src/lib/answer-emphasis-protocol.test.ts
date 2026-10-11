import { describe, it, expect } from 'vitest';
import { answerEmphasisProtocolSchema, resolveAnswerEmphasis } from './answer-emphasis-protocol';
describe('统一正文标注协议', () => {
  it('支持16个关键词和16条关键句，不再存在3+1的隐藏限制', () => {
    const keywords = Array.from({length:16}, (_,i) => '术语' + i + '号');
    const keySentences = Array.from({length:16}, (_,i) => '第' + i + '条完整论述。');
    const markdown = [...keywords, ...keySentences].join(' ');
    expect(resolveAnswerEmphasis(markdown, {keywords,keySentences}).marks).toHaveLength(32);
  });
  it('字段长度与Schema一致，短句和较长完整术语都可提交', () => {
    expect(resolveAnswerEmphasis('甲。很长而完整的一个专业术语名称。', {keywords:['很长而完整的一个专业术语名称'],keySentences:['甲。']}).marks).toHaveLength(2);
  });
  it('明确none，不接受旧字段、空数组和虚构引文', () => {
    expect(resolveAnswerEmphasis('正文', {keywords:'none',keySentences:'none'}).marks).toEqual([]);
    expect(answerEmphasisProtocolSchema.safeParse({keywords:[],keySentences:'none'}).success).toBe(false);
    expect(answerEmphasisProtocolSchema.safeParse({version:1,marks:[]}).success).toBe(false);
    expect(()=>resolveAnswerEmphasis('正文', {keywords:['虚构'],keySentences:'none'})).toThrow('逐字匹配');
  });
});

it('关键词与包含它的关键句可以叠加，同类重叠或超过16项仍返回精确错误',()=>{
 expect(resolveAnswerEmphasis('劳动形成价值。',{keywords:['劳动'],keySentences:['劳动形成价值。']}).marks).toHaveLength(2);
 expect(()=>resolveAnswerEmphasis('劳动形成价值。',{keywords:['劳动','劳动形成'],keySentences:'none'})).toThrow('answerEmphasis.keywords[1]');
 expect(answerEmphasisProtocolSchema.safeParse({keywords:Array.from({length:17},(_,i)=>'词'+i),keySentences:'none'}).success).toBe(false);
});
