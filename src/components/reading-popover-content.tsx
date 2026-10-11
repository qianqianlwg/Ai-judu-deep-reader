"use client";
import { ConceptDefinitionContent } from "./concept-definition-content";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { readAnswerEmphasis, remarkAnswerEmphasis, type AnswerEmphasis } from "@/lib/answer-emphasis";
import type { AnnotationConcept, TextAnnotation } from "@/lib/annotations";
/** WHY：原版和精读使用同一内容组件，概念定义不能拿句读摘要顶替，历史入口保持相同语义。 */
export function ConceptPopoverContent({concept}:{concept:AnnotationConcept}) {
 return <ConceptDefinitionContent concept={concept}/>;
}
export type HistoryPopoverReading={content:string;emphasis?:AnswerEmphasis};
export function HistoryPopoverContent({annotations,onOpen,disabled=false,showOpenButton=true,hideFirstOpenButton=false,readingsByMessageId}:{annotations:readonly TextAnnotation[];onOpen:(annotation:TextAnnotation)=>void;disabled?:boolean;showOpenButton?:boolean;hideFirstOpenButton?:boolean;readingsByMessageId?:ReadonlyMap<string,HistoryPopoverReading>}) {
 return <ol className="judu-annotation-history">{annotations.map((annotation,index)=>{
  const reading=annotation.messageId?readingsByMessageId?.get(annotation.messageId):undefined;
  const content=reading?.content.trim()||annotation.summary||"暂无句读内容";
  const emphasis=reading?.emphasis?readAnswerEmphasis(content,reading.emphasis):undefined;
  return <li key={annotation.id}>
   {showOpenButton&&!(hideFirstOpenButton&&index===0)&&<button type="button" disabled={disabled} onClick={()=>onOpen(annotation)}>查看完整句读</button>}
   <div className="judu-annotation-summary"><Markdown remarkPlugins={[remarkGfm,...(emphasis?[[remarkAnswerEmphasis,emphasis] as [typeof remarkAnswerEmphasis,AnswerEmphasis]]:[])]} skipHtml components={{a:({children})=><span>{children}</span>,img:({alt})=><span>{alt||"[图片]"}</span>}}>{content}</Markdown></div>
   <time dateTime={annotation.createdAt}>{new Date(annotation.createdAt).toLocaleString("zh-CN")}</time>
  </li>;
 })}</ol>;
}
