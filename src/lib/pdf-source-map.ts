import type {LibraryBookContent,LibraryParagraph} from "./library";
import {pdfPageNumber} from "./pdf-text";
import {capReadingSelection,selectionFromParts,selectionMatchesParagraphs,selectionParts,type ReadingSelection,type ReadingSelectionPart} from "./reader-selection";
export type PdfTextItem={str:string;transform:readonly number[];width:number;height:number;hasEOL?:boolean};
export type PdfSourceRun={itemIndex:number;itemStart:number;itemEnd:number;paragraphId:string;startOffset:number;endOffset:number};
export type PdfTextPage={pageNumber:number;reference?:{num:number;gen:number};items:PdfTextItem[];width:number;height:number;rotation:number;runs:PdfSourceRun[];mapped:boolean};
export type PdfDocumentIndex={pages:PdfTextPage[];paragraphs:LibraryParagraph[];complete:boolean};
export const pdfCompact=(text:string)=>text.replace(/\s/gu,"");
function mapPageRuns(page:PdfTextPage,paragraphs:readonly LibraryParagraph[],cursor:{paragraph:number;offset:number}):PdfSourceRun[]{
 const runs:PdfSourceRun[]=[];
 for(const [itemIndex,item]of page.items.entries())for(let index=0;index<item.str.length;index++){
  if(/\s/u.test(item.str[index]))continue;
  while(cursor.paragraph<paragraphs.length){const p=paragraphs[cursor.paragraph];while(cursor.offset<p.text.length&&/\s/u.test(p.text[cursor.offset]))cursor.offset++;if(cursor.offset<p.text.length)break;cursor.paragraph++;cursor.offset=0;}
  const paragraph=paragraphs[cursor.paragraph];if(!paragraph||paragraph.text[cursor.offset]!==item.str[index])throw new Error("PDF精确映射前置核验失效");
  const previous=runs.at(-1);
  if(previous&&previous.itemIndex===itemIndex&&previous.paragraphId===paragraph.id&&previous.itemEnd===index&&previous.endOffset===cursor.offset){previous.itemEnd++;previous.endOffset++;}
  else runs.push({itemIndex,itemStart:index,itemEnd:index+1,paragraphId:paragraph.id,startOffset:cursor.offset,endOffset:cursor.offset+1});
  cursor.offset++;
 }
 return runs;
}
export function mapPdfDocument(pages:readonly PdfTextPage[],book:LibraryBookContent):PdfDocumentIndex{
 const paragraphs=book.chapters.flatMap(c=>c.paragraphs),pageScoped=book.chapters.every(c=>pdfPageNumber(c.sourceHref)!==null);
 const legacyMatches=!pageScoped&&pdfCompact(paragraphs.map(p=>p.text).join(''))===pdfCompact(pages.flatMap(p=>p.items.map(i=>i.str)).join(''));
 const cursor={paragraph:0,offset:0};
 const mapped=pages.map(page=>{
  const expected=pageScoped?book.chapters.filter(c=>pdfPageNumber(c.sourceHref)===page.pageNumber).flatMap(c=>c.paragraphs):paragraphs;
  const matches=pageScoped?pdfCompact(expected.map(p=>p.text).join(''))===pdfCompact(page.items.map(i=>i.str).join('')):legacyMatches;
  // WHY：旧版仅在整本非空白字符序列完全相等时增建定位，不能用同文首个命中重写旧段落ID。
  return {...page,mapped:matches,runs:matches?mapPageRuns(page,expected,pageScoped?{paragraph:0,offset:0}:cursor):[]};
 });
 return {pages:mapped,paragraphs,complete:mapped.every(page=>page.mapped)};
}
export type PdfDomPoint={node:Text;offset:number;paragraphId:string;sourceOffset:number};
export type PdfDomPage={pageNumber:number;container:HTMLElement;points:PdfDomPoint[]};
export function bindPdfTextLayer(page:PdfTextPage,container:HTMLElement,divs:readonly HTMLElement[],strings:readonly string[]):PdfDomPage{
 const points:PdfDomPoint[]=[];
 if(!page.mapped||divs.length!==page.items.length||strings.length!==page.items.length||divs.some((div,index)=>page.items[index].str.length>0&&!container.contains(div)))return {pageNumber:page.pageNumber,container,points};
 const nodes=divs.map((div,index)=>{
  const text=div.textContent??'';if(text!==strings[index]||text!==page.items[index].str)throw new Error("PDF文字层与提取文本不一致，未启用句读");
  const list:{node:Text;start:number;end:number}[]=[];let offset=0;const walker=div.ownerDocument.createTreeWalker(div,4);
  for(let node=walker.nextNode();node;node=walker.nextNode()){const length=node.nodeValue?.length??0;list.push({node:node as Text,start:offset,end:offset+length});offset+=length;}return list;
 });
 for(const run of page.runs)for(let offset=run.itemStart;offset<run.itemEnd;offset++){
  const at=nodes[run.itemIndex].find(node=>node.start<=offset&&node.end>offset);if(at)points.push({node:at.node,offset:offset-at.start,paragraphId:run.paragraphId,sourceOffset:run.startOffset+offset-run.itemStart});
 }
 return {pageNumber:page.pageNumber,container,points};
}
export function pdfRangesForSource(pages:readonly PdfDomPage[],part:Pick<ReadingSelectionPart,'paragraphId'|'startOffset'|'endOffset'>):Range[]{
 return pages.flatMap(page=>{const points=page.points.filter(p=>p.paragraphId===part.paragraphId&&p.sourceOffset>=part.startOffset&&p.sourceOffset<part.endOffset);if(!points.length)return [];const first=points[0],last=points[points.length-1],range=first.node.ownerDocument.createRange();range.setStart(first.node,first.offset);range.setEnd(last.node,last.offset+1);return [range];});
}
export function selectionFromPdfRange(range:Range,pages:readonly PdfDomPage[],paragraphs:readonly LibraryParagraph[]):ReadingSelection|null{
 if(range.collapsed)return null;
 const registered=[...pages].sort((a,b)=>a.pageNumber-b.pageNumber);
 const touchedPages=registered.filter(page=>range.intersectsNode(page.container));
 if(!touchedPages.length)return null;
 for(let index=0;index<touchedPages.length;index++){
  const page=touchedPages[index],previous=touchedPages[index-1];
  if(page.points.some(point=>!page.container.contains(point.node)))return null;
  if(previous&&(page.pageNumber!==previous.pageNumber+1||!(previous.container.compareDocumentPosition(page.container)&Node.DOCUMENT_POSITION_FOLLOWING)))return null;
 }
 const selected=new Map<string,{start:number;end:number}>();
 for(const page of [...pages].sort((a,b)=>a.pageNumber-b.pageNumber))for(const point of page.points){
  const probe=point.node.ownerDocument.createRange();probe.setStart(point.node,point.offset);probe.setEnd(point.node,point.offset+1);
  if(range.compareBoundaryPoints(Range.END_TO_START,probe)>=0||range.compareBoundaryPoints(Range.START_TO_END,probe)<=0)continue;
  const previous=selected.get(point.paragraphId);selected.set(point.paragraphId,{start:Math.min(previous?.start??point.sourceOffset,point.sourceOffset),end:Math.max(previous?.end??0,point.sourceOffset+1)});
 }
 const entries=[...selected.entries()];if(!entries.length)return null;
 const parts=entries.flatMap(([id,bounds],index)=>{const paragraph=paragraphs.find(p=>p.id===id);if(!paragraph)return [];const startOffset=index===0?bounds.start:0,endOffset=index===entries.length-1?bounds.end:paragraph.text.length;return [{paragraphId:id,startOffset,endOffset,text:paragraph.text.slice(startOffset,endOffset)}];});
 if(!parts.length||parts.length!==entries.length)return null;
 const snapshot=selectionFromParts(parts);return selectionMatchesParagraphs(snapshot,paragraphs)&&pdfCompact(range.toString())===pdfCompact(snapshot.text)?snapshot:null;
}
export function readLimitedPdfSelection(selection:Selection,pages:readonly PdfDomPage[],paragraphs:readonly LibraryParagraph[],onLimit?:()=>void):ReadingSelection|null{
 if(!selection.rangeCount||selection.isCollapsed)return null;const range=selection.getRangeAt(0),full=selectionFromPdfRange(range,pages,paragraphs);if(!full)return null;
 const reverse=selection.anchorNode===range.endContainer&&selection.anchorOffset===range.endOffset,limited=capReadingSelection(full,reverse);
 if(limited!==full){const parts=selectionParts(limited),first=pdfRangesForSource(pages,parts[0])[0],last=pdfRangesForSource(pages,parts[parts.length-1]).at(-1);if(!first||!last)return null;selection.setBaseAndExtent(reverse?last.endContainer:first.startContainer,reverse?last.endOffset:first.startOffset,reverse?first.startContainer:last.endContainer,reverse?first.startOffset:last.endOffset);onLimit?.();return selectionFromPdfRange(selection.getRangeAt(0),pages,paragraphs);}
 return limited;
}
