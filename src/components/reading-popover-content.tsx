"use client";
import { ConceptDefinitionContent } from "./concept-definition-content";
import type { AnnotationConcept, TextAnnotation } from "@/lib/annotations";
/** WHY：原版和精读使用同一内容组件，概念定义不能拿句读摘要顶替，历史入口保持相同语义。 */
export function ConceptPopoverContent({concept}:{concept:AnnotationConcept}) {
 return <ConceptDefinitionContent concept={concept}/>;
}
export function HistoryPopoverContent({annotations,onOpen,disabled=false}:{annotations:readonly TextAnnotation[];onOpen:(annotation:TextAnnotation)=>void;disabled?:boolean}) {
 return <ol className="judu-annotation-history">{annotations.map(annotation=><li key={annotation.id}><time dateTime={annotation.createdAt}>{new Date(annotation.createdAt).toLocaleString("zh-CN")}</time><div className="judu-annotation-summary">{annotation.summary||"暂无句读内容"}</div><button type="button" disabled={disabled} onClick={()=>onOpen(annotation)}>查看完整句读</button></li>)}</ol>;
}
