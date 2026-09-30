import {z} from 'zod';
import {splitsReadingCharacter,type ReadingAnchorPart} from './reading-anchors';
export const sourceMarkProposalSchema=z.object({paragraphId:z.string().min(1),kind:z.enum(['term','key_sentence']),quote:z.string().min(1).max(1000),occurrence:z.number().int().min(1).max(99)}).strict();
export const sourceEmphasisSchema=z.object({paragraphId:z.string(),startOffset:z.number().int().min(0),endOffset:z.number().int().positive(),quote:z.string().min(1),kind:z.enum(['term','key_sentence'])}).strict().refine(m=>m.endOffset>m.startOffset,'重点范围无效');
export type SourceEmphasis=z.infer<typeof sourceEmphasisSchema>;
export type SourceEmphasisRange={start:number;end:number;kind:SourceEmphasis['kind']};
// WHY：重点只来自 Agent 的逐字引文，不以本地评分猜作者重点；范围只在本轮可信来源中解析。
export function resolveSourceEmphasis(proposals:readonly z.infer<typeof sourceMarkProposalSchema>[],sources:readonly ReadingAnchorPart[]):SourceEmphasis[]{
 const result:SourceEmphasis[]=[];
 for(const mark of proposals){const source=sources.find(p=>p.paragraphId===mark.paragraphId);if(!source)continue;let from=0,at=-1;for(let n=0;n<mark.occurrence;n++){at=source.selectedText.indexOf(mark.quote,from);if(at<0)break;from=at+mark.quote.length;}if(at<0)continue;
  if(splitsReadingCharacter(source.selectedText,at)||splitsReadingCharacter(source.selectedText,at+mark.quote.length))continue;
  const startOffset=source.startOffset+at,endOffset=startOffset+mark.quote.length;
  if(result.some(r=>r.paragraphId===mark.paragraphId&&startOffset<r.endOffset&&endOffset>r.startOffset))continue;
  result.push({paragraphId:mark.paragraphId,kind:mark.kind,quote:mark.quote,startOffset,endOffset});
 }return result;
}
export function sourceEmphasisRanges(text:string,paragraphId:string,marks:readonly SourceEmphasis[]=[]):SourceEmphasisRange[]{return marks.filter(m=>m.paragraphId===paragraphId&&text.slice(m.startOffset,m.endOffset)===m.quote).map(m=>({start:m.startOffset,end:m.endOffset,kind:m.kind})).sort((a,b)=>a.start-b.start);}
export function sourceEmphasisSegments(text:string,start:number,ranges:readonly SourceEmphasisRange[]){
 const end=start+text.length,parts:{text:string;kind?:SourceEmphasisRange['kind']}[]=[];let cursor=start;
 for(const range of ranges){const low=Math.max(start,range.start,cursor),high=Math.min(end,range.end);if(high<=low)continue;if(low>cursor)parts.push({text:text.slice(cursor-start,low-start)});parts.push({text:text.slice(low-start,high-start),kind:range.kind});cursor=high;}
 if(cursor<end)parts.push({text:text.slice(cursor-start)});return parts;
}
