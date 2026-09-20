// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useTextSourceHighlights } from "./use-text-source-highlights";
import { selectionFromParts } from "@/lib/reader-selection";
it("跨段高亮保持原文DOM和原生选区，不插入span破坏拖选",()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const registered=vi.fn(),removed=vi.fn();let captured:Range[]=[];
 vi.stubGlobal('CSS',{highlights:{set:registered,delete:removed}});vi.stubGlobal('Highlight',class{constructor(...ranges:Range[]){captured=ranges;}});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const selection=selectionFromParts([{paragraphId:'a',startOffset:1,endOffset:3,text:'乙丙'},{paragraphId:'b',startOffset:0,endOffset:2,text:'丁戊'}]);
 function View({enabled}:{enabled:boolean}){const ref=useRef<HTMLDivElement>(null);useTextSourceHighlights(ref,selection,enabled,0);return <div ref={ref}><p data-paragraph-id="a" data-source-start="0" data-source-end="3"><span data-reader-text="">甲乙丙</span></p><p data-paragraph-id="b" data-source-start="0" data-source-end="3"><span data-reader-text="">丁戊己</span></p></div>;}
 try{
  act(()=>root.render(<View enabled={false}/>));const node=host.querySelector('[data-reader-text]')!.firstChild!;const range=document.createRange();range.setStart(node,1);range.setEnd(node,3);document.getSelection()!.removeAllRanges();document.getSelection()!.addRange(range);const html=host.innerHTML;
  act(()=>root.render(<View enabled/>));expect(host.innerHTML).toBe(html);expect(document.getSelection()!.toString()).toBe('乙丙');expect(captured.map(range=>range.toString())).toEqual(['乙丙','丁戊']);expect(registered).toHaveBeenCalledOnce();
  act(()=>root.render(<View enabled={false}/>));expect(removed).toHaveBeenCalled();
 }finally{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
