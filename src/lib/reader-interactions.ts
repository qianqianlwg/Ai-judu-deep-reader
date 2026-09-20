import { segmentAnnotatedText, type AnnotationConcept, type ConceptDetail, type TextAnnotation } from "./annotations";
import type {LibraryParagraph} from "./library";
export type ReaderInteraction = {key:string;range:Range} & ({kind:"concept";concept:AnnotationConcept}|{kind:"history";annotations:TextAnnotation[]}|{kind:"mark";annotation:TextAnnotation});
export type ReaderRect={left:number;right:number;top:number;bottom:number;width:number;height:number};
export function buildReaderInteractions(paragraphs:readonly LibraryParagraph[],rangeFor:(paragraphId:string,start:number,end:number)=>Range|null,annotations:readonly TextAnnotation[],concepts:readonly ConceptDetail[]):ReaderInteraction[]{
 const result:ReaderInteraction[]=[];
 for(const paragraph of paragraphs){
  const segments=segmentAnnotatedText({paragraphId:paragraph.id,text:paragraph.text,sourceText:paragraph.text,annotations,bookConcepts:concepts,showConcepts:concepts.length>0});
  let previousConcept:Extract<ReaderInteraction,{kind:"concept"}>|undefined;
  for(const segment of segments){
   if(segment.concept){
    const range=rangeFor(paragraph.id,segment.startOffset,segment.endOffset);
    if(range){
     if(previousConcept?.concept===segment.concept){previousConcept.range.setEnd(range.endContainer,range.endOffset);}
     else {previousConcept={kind:"concept",key:paragraph.id+":concept:"+segment.startOffset,range,concept:segment.concept};result.push(previousConcept);}
    } else previousConcept=undefined;
   } else previousConcept=undefined;
   const history=segment.endingAnnotations.filter(annotation=>!annotation.kind||annotation.kind==="analysis");
   const end=segment.endOffset,lastCharacter=Array.from(paragraph.text.slice(0,end)).at(-1);
   const range=history.length ? rangeFor(paragraph.id,Math.max(0,end-(lastCharacter?.length??1)),end) : null;
   if(range)result.push({kind:"history",key:paragraph.id+":history:"+segment.endOffset,range,annotations:history});
  }
  for(const annotation of annotations.filter(a=>a.paragraphId===paragraph.id&&a.kind&&a.kind!=="analysis"&&a.kind!=="highlight")){
   const range=rangeFor(paragraph.id,annotation.startOffset,annotation.endOffset);if(range)result.push({kind:"mark",key:"mark:"+annotation.id,range,annotation});
  }
 }
 return result;
}
/** WHY：书内 iframe 的坐标独立于应用窗口；只投影可见位置，不更改书籍 DOM、CFI 或 shadow root。 */
export function epubPointToHost(doc:Document,x:number,y:number):{x:number;y:number}{
 const frame=doc.defaultView?.frameElement,rect=frame?.getBoundingClientRect();
 const sx=rect&&frame?.clientWidth ? rect.width/frame.clientWidth : 1,sy=rect&&frame?.clientHeight ? rect.height/frame.clientHeight : 1;
 return {x:(rect?.left??0)+x*sx,y:(rect?.top??0)+y*sy};
}
export function epubRectToHost(doc:Document,rect:Pick<DOMRect,"left"|"top"|"right"|"bottom">):ReaderRect {
 const a=epubPointToHost(doc,rect.left,rect.top),b=epubPointToHost(doc,rect.right,rect.bottom);return {left:a.x,top:a.y,right:b.x,bottom:b.y,width:b.x-a.x,height:b.y-a.y};
}
export function insideRect(rect:Pick<ReaderRect,"left"|"top"|"right"|"bottom">,x:number,y:number):boolean{return x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom;}
export function clipReaderRect(rect:ReaderRect,bounds:Pick<ReaderRect,"left"|"top"|"right"|"bottom">):ReaderRect|null{
 const left=Math.max(rect.left,bounds.left),right=Math.min(rect.right,bounds.right),top=Math.max(rect.top,bounds.top),bottom=Math.min(rect.bottom,bounds.bottom);
 return right>left&&bottom>top ? {left,right,top,bottom,width:right-left,height:bottom-top}:null;
}
