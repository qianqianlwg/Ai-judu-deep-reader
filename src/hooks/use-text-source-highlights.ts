"use client";
import { useEffect, type RefObject } from "react";
import { selectionParts, type ReadingSelection } from "@/lib/reader-selection";
type HighlightsWindow = Window & { CSS?: { highlights?: {set(name:string,value:unknown):void;delete(name:string):boolean} }; Highlight?:new(...ranges:Range[])=>unknown };
/** WHY：选文回跳只使用非侵入高亮层；实时划选时拆装 span 会使浏览器 Range 丢失。 */
export function useTextSourceHighlights(viewport: RefObject<HTMLElement|null>, selection:ReadingSelection|null, enabled:boolean, layout:unknown):void {
 useEffect(()=>{
  const root=viewport.current,view=root?.ownerDocument.defaultView as HighlightsWindow|null;
  const registry=view?.CSS?.highlights,Highlight=view?.Highlight;
  if(!root||!registry||!Highlight)return;
  const name="judu-source-selection";registry.delete(name);
  if(!enabled||!selection)return;
  const paint=()=>{
  const ranges:Range[]=[];
  for(const part of selectionParts(selection))for(const element of root.querySelectorAll<HTMLElement>('p[data-paragraph-id]')){
   if(element.dataset.paragraphId!==part.paragraphId)continue;
   const base=Number(element.dataset.sourceStart??0),end=Number(element.dataset.sourceEnd??base+(element.textContent?.length??0));
   const low=Math.max(base,part.startOffset),high=Math.min(end,part.endOffset);if(high<=low)continue;
   const walker=root.ownerDocument.createTreeWalker(element,4);let offset=base;let start:{node:Node;offset:number}|null=null;let finish:{node:Node;offset:number}|null=null;
   for(let node=walker.nextNode();node;node=walker.nextNode()){
    if(!node.parentElement?.closest('[data-reader-text]')||node.parentElement.closest('[data-reader-decoration]'))continue;
    const length=node.nodeValue?.length??0;
    if(!start&&low>=offset&&low<offset+length)start={node,offset:low-offset};
    if(high>offset&&high<=offset+length)finish={node,offset:high-offset};
    offset+=length;
   }
   if(start&&finish){const range=root.ownerDocument.createRange();range.setStart(start.node,start.offset);range.setEnd(finish.node,finish.offset);ranges.push(range);}
  }
  if(ranges.length)registry.set(name,new Highlight(...ranges));else registry.delete(name);
  };
  paint();
  // WHY：保存标注和概念开关会重分文本节点；重新绑定 Range，不修改书籍 DOM，也不污染其他高亮层。
  const observer=new MutationObserver(paint);observer.observe(root,{childList:true,characterData:true,subtree:true});
  return()=>{observer.disconnect();registry.delete(name);};
 },[viewport,selection,enabled,layout]);
}
