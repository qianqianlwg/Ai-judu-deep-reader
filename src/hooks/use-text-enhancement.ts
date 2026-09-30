'use client';
import { useEffect, type RefObject } from 'react';
import { sourceEmphasisRanges,type SourceEmphasis } from '@/lib/source-enhancement';
import type { ReadingAppearancePreferences } from '@/lib/reading-appearance';
type Source = { id: string; text: string };
type HighlightWindow = Window & { CSS?: { highlights?: { set(name:string,value:unknown):void; delete(name:string):boolean } }; Highlight?:new(...ranges:Range[])=>unknown };
const names = { term:'judu-source-term', key_sentence:'judu-source-sentence' };
// WHY：与原版一样只叠加 Highlight；开关和翻页不拆装正文节点，保留原生 Range、标注偏移及分页测量。
export function paintTextEnhancement(root:HTMLElement,sources:readonly Source[],terms:boolean,sentences:boolean,marks:readonly SourceEmphasis[]=[]):()=>void {
  const doc=root.ownerDocument,view=doc.defaultView as HighlightWindow|null;
  const registry=view?.CSS?.highlights,Highlight=view?.Highlight;
  if(!registry||!Highlight)return()=>{};
  const clear=()=>{for(const name of Object.values(names))registry.delete(name);};
  clear();if(!terms&&!sentences)return clear;
  const sourceById=new Map(sources.map(p=>[p.id,p.text]));
  const paint=()=>{
    const ranges:{term:Range[];key_sentence:Range[]}={term:[],key_sentence:[]};
    for(const element of root.querySelectorAll<HTMLElement>('p[data-paragraph-id]')){
      const text=sourceById.get(element.dataset.paragraphId??'');if(text===undefined)continue;
      const base=Number(element.dataset.sourceStart??0),end=Number(element.dataset.sourceEnd??text.length);
      if(!Number.isInteger(base)||!Number.isInteger(end)||base<0||end>text.length)continue;
      const walker=doc.createTreeWalker(element,4),nodes:{node:Node;start:number;end:number}[]=[];let at=base;
      for(let node=walker.nextNode();node;node=walker.nextNode()){
        if(!node.parentElement?.closest('[data-reader-text]')||node.parentElement.closest('[data-reader-decoration]'))continue;
        const length=node.nodeValue?.length??0;nodes.push({node,start:at,end:at+length});at+=length;
      }
      if(nodes.map(n=>n.node.nodeValue??'').join('')!==text.slice(base,end))continue;
      for(const mark of sourceEmphasisRanges(text,element.dataset.paragraphId??'',marks)){
        if(!(mark.kind==='term'?terms:sentences))continue;
        const low=Math.max(base,mark.start),high=Math.min(end,mark.end);if(high<=low)continue;
        const first=nodes.find(n=>low>=n.start&&low<n.end),last=nodes.find(n=>high>n.start&&high<=n.end);
        if(!first||!last)continue;
        const range=doc.createRange();range.setStart(first.node,low-first.start);range.setEnd(last.node,high-last.start);ranges[mark.kind].push(range);
      }
    }
    for(const kind of ['term','key_sentence'] as const)registry.set(names[kind],new Highlight(...ranges[kind]));
  };
  paint();const Observer=doc.defaultView?.MutationObserver;
  const observer=Observer?new Observer(paint):undefined;observer?.observe(root,{childList:true,characterData:true,subtree:true});
  return()=>{observer?.disconnect();clear();};
}
export function useTextEnhancement(viewport:RefObject<HTMLElement|null>,sources:readonly Source[],appearance:ReadingAppearancePreferences,enabled:boolean,layout:unknown,marks:readonly SourceEmphasis[]=[]):void {
  useEffect(()=>{const root=viewport.current;if(!root)return;return paintTextEnhancement(root,sources,enabled&&appearance.sourceTerms,enabled&&appearance.sourceSentences,marks);},[viewport,sources,appearance.sourceTerms,appearance.sourceSentences,enabled,layout,marks]);
}
