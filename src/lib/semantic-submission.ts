import { z } from 'zod';
import { anchorParts, makeReadingAnchor, readReadingAnchor, splitsReadingCharacter, type ReadingAnchorPart } from './reading-anchors';
import { answerEmphasisInputSchema, EMPTY_ANSWER_EMPHASIS, readAnswerEmphasis } from './answer-emphasis';
import { resolveSourceEmphasis, sourceMarkProposalSchema } from './source-enhancement';
import type { SemanticUnit } from './semantic-reading';

const quote = z.string().min(1).refine(s => Array.from(s).length <= 5, '原文首尾各取5个字符；不足5字的短句使用全文');
const mark = sourceMarkProposalSchema.omit({ kind: true });
const marks = z.union([z.literal('无'), z.array(mark).min(1)]);
export const semanticSubmissionSchema = z.object({
  listTitle: z.string().trim().min(1).max(120).describe('整组句读的总标题，每次保持一致；必须由你命名'),
  sourceStart: quote.describe('当前句原文首5个字符，包含原有标点与空白；不足5字用全文'),
  sourceEnd: quote.describe('当前句原文尾5个字符，包含原有标点与空白；不足5字用全文'),
  title: z.string().trim().min(1).max(120).describe('当前句的小标题'),
  content: z.string().trim().min(1).describe('当前句完整的句读结果正文，Markdown，不输出思考过程'),
  keywords: marks.describe('当前句原文关键词，逐字quote、paragraphId和从1开始的occurrence；没有填“无”'),
  keySentences: marks.describe('当前句原文关键句段，定位字段同上；没有填“无”'),
  concepts: z.union([z.literal('无'),z.array(z.object({name:z.string().min(1),text:z.string().min(1)}).strict()).min(1)]).describe('概念及解释，概念名称必须出现在当前原文；没有填“无”'),
  answerEmphasis: answerEmphasisInputSchema.describe('正文普通段落中的逐字重点；不标记Markdown标题、加粗、链接或代码内部文本；无法标注明确填“无”'),
}).strict();
export type SemanticSubmission = z.infer<typeof semanticSubmissionSchema>;
export function sourceLength(sources: readonly ReadingAnchorPart[]): number { return sources.reduce((n,p)=>n+Array.from(p.selectedText).length,0); }
export function coveredOffset(units: readonly SemanticUnit[], sources: readonly ReadingAnchorPart[]): number {
  let offset = 0;
  const original = sources.map(p=>p.selectedText).join('');
  for (const unit of units) {
    if(!readReadingAnchor(unit.anchor))throw new Error("已保留句读的来源或位置不正确");
    const text = anchorParts(unit.anchor).map(p=>p.selectedText).join('');
    if (!original.startsWith(text,offset)) throw new Error('已保留句读与当前原文不连续，不能继续');
    // WHY：恢复不能只比文字；还要校验段落身份和绝对偏移，避免重复文本指向其他位置。
    let at = offset, consumed = 0;
    for (const source of sources) {
      const next = consumed + source.selectedText.length;
      if (offset < next && offset + text.length > consumed) {
        const part = anchorParts(unit.anchor).find(p=>p.paragraphId===source.paragraphId && p.startOffset===source.startOffset+Math.max(0,at-consumed));
        const expected = source.selectedText.slice(Math.max(0,at-consumed),Math.min(source.selectedText.length,offset+text.length-consumed));
        if (!part || part.selectedText!==expected || part.endOffset!==part.startOffset+expected.length) throw new Error('已保留句读的来源或位置不正确');
        at += expected.length;
      }
      consumed = next;
    }
    offset += text.length;
  }
  return offset;
}
export function resolveSemanticSubmission(value: unknown, sources: readonly ReadingAnchorPart[], offset: number, makeId:()=>string): {unit:SemanticUnit;end:number;title:string} {
  const input=semanticSubmissionSchema.parse(value), original=sources.map(p=>p.selectedText).join('');
  if (!sources.length || offset>=original.length || !original.startsWith(input.sourceStart,offset)) throw new Error('找不到对应语句，请准确反映未处理原文的原文首或原文尾，再重试。');
  // WHY：只在未处理范围顺序匹配最近结尾，不按句号分句，不跳过正文，也不使用模糊匹配。
  let tail=original.indexOf(input.sourceEnd,offset);
  while(tail>=0 && tail+input.sourceEnd.length<offset+input.sourceStart.length) tail=original.indexOf(input.sourceEnd,tail+1);
  if(tail<0) throw new Error('找不到对应语句，请准确反映原文首或原文尾，再重试。');
  const end=tail+input.sourceEnd.length, text=original.slice(offset,end), characters=Array.from(text);
  if(characters.slice(0,5).join('')!==input.sourceStart || characters.slice(-5).join('')!==input.sourceEnd) throw new Error('原文首尾必须各取5个字符；不足5字用整句全文，请准确重试。');
  if(!text.trim()) throw new Error('不能把纯空白作为一句，请并入相邻原文。');
  const parts:ReadingAnchorPart[]=[];let consumed=0;
  for(const source of sources){
    const from=Math.max(0,offset-consumed),to=Math.min(source.selectedText.length,end-consumed);
    if(to>from){
      const boundaries=new Set([source.selectedText.length,...Array.from(new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(source.selectedText),p=>p.index)]);
      if(!boundaries.has(from)||!boundaries.has(to)||splitsReadingCharacter(source.selectedText,from)||splitsReadingCharacter(source.selectedText,to)) throw new Error('原文首尾不能拆开 Unicode 字符，请修正。');
      parts.push({...source,startOffset:source.startOffset+from,endOffset:source.startOffset+to,selectedText:source.selectedText.slice(from,to)});
    }
    consumed+=source.selectedText.length;
  }
  if(parts.some(p=>!p.selectedText.trim()))throw new Error("不能创建纯空白来源片段，请将空白并入相邻的原文内容。");
  if(original.slice(end).length && !original.slice(end).trim())throw new Error('原文末尾还有空白，请把空白包含在本句，原文尾取完整末尾5个字符后重试。');
  const proposals=[...(input.keywords==='无'?[]:input.keywords.map(m=>({...m,kind:'term' as const}))),...(input.keySentences==='无'?[]:input.keySentences.map(m=>({...m,kind:'key_sentence' as const})))];
  const sourceEmphasis=resolveSourceEmphasis(proposals,parts);
  if(sourceEmphasis.length!==proposals.length) throw new Error('关键词或关键句未逐字匹配当前原文，或标注重叠，请修正；没有重点明确填“无”。');
  const concepts=input.concepts==='无'?[]:input.concepts;
  if(concepts.some(c=>!text.includes(c.name))) throw new Error('概念名称未逐字出现在当前原文，请修正。');
  const emphasis=input.answerEmphasis==='无'?EMPTY_ANSWER_EMPHASIS:readAnswerEmphasis(input.content,input.answerEmphasis);
  if(!emphasis || (input.answerEmphasis!=='无'&&emphasis.marks.length!==input.answerEmphasis.marks.length)) throw new Error('正文标注未逐字匹配，请修正或明确填“无”。');
  // WHY：旧存储的摘要直接使用 Agent 提交正文，概念与标注来自必填工具字段；不本地生成任何补充内容。
  const unit:SemanticUnit={id:makeId(),label:input.title,action:'read',reason:'',anchor:makeReadingAnchor(parts),status:'completed',content:input.content,sourceEmphasis,analysis:{summary:input.content,readingText:input.content,provenanceVersion:1,breakdown:[],concepts,context:'',uncertainty:'',emphasisSource:'agent',emphasis}};
  return {unit,end,title:input.listTitle};
}
