import {sourceEmphasisSchema,sourceMarkProposalSchema,resolveSourceEmphasis,type SourceEmphasis} from "./source-enhancement";
import { z } from 'zod';
import { makeReadingAnchor, readReadingAnchor, splitsReadingCharacter, type ReadingAnchor, type ReadingAnchorPart } from './reading-anchors';
import type { Analysis } from './chat-stream';
import type { TokenUsage } from './token-usage';

export type ReadingStyle = 'semantic' | 'whole';
export const READING_STYLE_KEY = 'judu:reading-style';
export function readReadingStyle(value: unknown): ReadingStyle { return value === 'whole' ? 'whole' : 'semantic'; }
export const MAX_SECTION_CHARACTERS = 30000;
export const SEMANTIC_PROMPT_VERSION = 'semantic-v3-agent-units';
export type SemanticSource = ReadingAnchorPart;
export const semanticPlanSchema = z.object({ units: z.array(z.object({
  sourceEmphasis: z.array(sourceMarkProposalSchema).max(16).optional(),
  label: z.string().trim().min(1).max(80),
  action: z.enum(['read', 'skip']),
  reason: z.string().trim().max(300).describe('skip 时说明无需解释的原因；read 可为空'),
  endParagraphId: z.string().min(1).optional().describe('推荐：此块终点所在原文段落ID；起点自动沿用上一块终点'),
  endQuote: z.string().min(1).max(240).optional().describe('推荐：块末尾逐字原文，通常8至40字，必须在目标段落剩余部分唯一；不计算偏移'),
  fragments: z.array(z.object({ paragraphId: z.string().min(1), text: z.string().min(1) }).strict()).min(1).max(256).optional().describe('可选的完整逐字片段；与 endParagraphId/endQuote 二选一'),
}).strict()).min(1).max(128) }).strict();
export type SemanticPlan = z.infer<typeof semanticPlanSchema>;
export type SemanticUnit = { sourceEmphasis?:SourceEmphasis[]; id: string; label: string; action: 'read' | 'skip'; reason: string; anchor: ReadingAnchor; status: 'pending' | 'streaming' | 'completed' | 'skipped' | 'error'; content: string; analysis?: Analysis; error?: string; usage?: TokenUsage };
export type SemanticReading = { version: 1; readingStyle?: ReadingStyle; phase: 'planning' | 'reading' | 'completed' | 'interrupted'; units: SemanticUnit[] };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function isSemanticReading(v: unknown): v is SemanticReading {
  return record(v) && v.version === 1 && (v.readingStyle===undefined||v.readingStyle==='semantic'||v.readingStyle==='whole') && ['planning','reading','completed','interrupted'].includes(String(v.phase)) && Array.isArray(v.units) && v.units.length <= 128 && v.units.every(u => record(u) && typeof u.id === 'string' && typeof u.label === 'string' && typeof u.content === 'string' && typeof u.reason === 'string' && (u.sourceEmphasis===undefined||(Array.isArray(u.sourceEmphasis)&&u.sourceEmphasis.every(m=>sourceEmphasisSchema.safeParse(m).success))) && ['read','skip'].includes(String(u.action)) && ['pending','streaming','completed','skipped','error'].includes(String(u.status)) && !!readReadingAnchor(u.anchor));
}

// WHY：语义边界完全由 Agent 提交；程序仅逐字核验连续覆盖，不预切句子、不猜相似原文。
export function resolveSemanticPlan(value: unknown, sources: readonly SemanticSource[], makeId: () => string): SemanticUnit[] {
  const plan = semanticPlanSchema.parse(value);
  if (!sources.length) throw new Error('缺少已核验原文');
  const boundaries = sources.map(source=>new Set([0,source.selectedText.length,...Array.from(new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(source.selectedText),item=>item.index)]));
  let paragraph = 0, offset = 0;
  const units = plan.units.map((unit, index): SemanticUnit => {
    if (unit.action === 'skip' && !unit.reason) throw new Error(`第 ${index + 1} 块略过原因不能为空`);
    const parts: ReadingAnchorPart[] = [];
    let fragments=unit.fragments;
    if(unit.endParagraphId!==undefined||unit.endQuote!==undefined){
      if(fragments||!unit.endParagraphId||!unit.endQuote)throw new Error('请使用唯一的终点定位方案，不要混合完整片段和终点定位');
      const last=sources.findIndex((source,i)=>i>=paragraph&&source.paragraphId===unit.endParagraphId);
      if(last<0)throw new Error('终点段落不存在、已覆盖或顺序错误');
      const text=sources[last].selectedText,from=last===paragraph?offset:0;
      const at=text.indexOf(unit.endQuote,from);
      if(at<0||text.indexOf(unit.endQuote,at+1)>=0)throw new Error('终点原文不存在或不唯一，请返回更长的逐字结尾片段以消除歧义');
      let end=at+unit.endQuote.length;
      if(!text.slice(end).trim())end=text.length;
      fragments=sources.slice(paragraph,last+1).map((source,i)=>({paragraphId:source.paragraphId,text:source.selectedText.slice(i===0?offset:0,paragraph+i===last?end:undefined)}));
    }
    if(!fragments?.length)throw new Error('每个语义块需要可核验的原文终点或完整片段');
    for (const fragment of fragments) {
      const source = sources[paragraph];
      if (!source || fragment.paragraphId !== source.paragraphId || !source.selectedText.startsWith(fragment.text, offset)) throw new Error(`第 ${index + 1} 块原文不连续或被改写，请从未覆盖的位置逐字划分，不漏字、不重复`);
      const end = offset + fragment.text.length;
      if (!boundaries[paragraph].has(offset) || !boundaries[paragraph].has(end) || splitsReadingCharacter(source.selectedText, offset) || splitsReadingCharacter(source.selectedText, end)) throw new Error('分块边界不能拆开 Unicode 字符');
      const part = { paragraphId: source.paragraphId, startOffset: source.startOffset + offset, endOffset: source.startOffset + end, selectedText: fragment.text };
      const previous = parts.at(-1);
      if (previous?.paragraphId === part.paragraphId && previous.endOffset === part.startOffset) { previous.endOffset = part.endOffset; previous.selectedText += part.selectedText; } else parts.push(part);
      offset = end;
      if (end === source.selectedText.length) { paragraph++; offset = 0; }
    }
    if (parts.some(p => !p.selectedText.trim())) throw new Error('不能把纯空白作为独立句读片段，请并入相邻原文');
    return { sourceEmphasis:resolveSourceEmphasis(unit.sourceEmphasis??[],parts), id: makeId(), label: unit.label, action: unit.action, reason: unit.reason, anchor: makeReadingAnchor(parts), status: unit.action === 'skip' ? 'skipped' : 'pending', content: '' };
  });
  if (paragraph !== sources.length || offset !== 0) throw new Error('分块未覆盖原文末尾；无需解释的内容也应标为 skip，不能遗漏');
  return units;
}
export function semanticSummary(state: SemanticReading): string {
  return state.units.map((u, i) => `### ${i + 1}. ${u.label}\n\n${u.status === 'skipped' ? '略过：' + u.reason : u.content || (u.status === 'error' ? '本块未完成，可继续。' : '等待句读。')}`).join('\n\n');
}

// WHY：取消/断流后保留已提交块，把当前块显式标为中断，不让界面永久显示生成中。
export function interruptSemanticReading(value:SemanticReading|undefined,message:string):SemanticReading|undefined {
  if(!value)return;
  return {...value,phase:'interrupted',units:value.units.map(unit=>unit.status==='streaming'?{...unit,status:'error',error:message}:unit)};
}
