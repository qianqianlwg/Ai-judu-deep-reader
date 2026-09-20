// @vitest-environment jsdom
import {act} from "react";import {createRoot} from "react-dom/client";import {expect,it,vi} from "vitest";
import {ConceptPopoverContent,HistoryPopoverContent} from "./reading-popover-content";
it("原版和精读内容共用：缺定义不伪造、历史展示摘要并打开对应记录",async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host),open=vi.fn();const annotation={id:'a',paragraphId:'p',startOffset:0,endOffset:2,textHash:'h',threadId:'t',summary:'完整概述',concepts:[],createdAt:'2026-09-18'};
 try{await act(async()=>root.render(<ConceptPopoverContent concept={{name:'概念',definitions:[{name:'概念',text:''}]}}/>));expect(host.textContent).toBe('暂无定义');await act(async()=>root.render(<HistoryPopoverContent annotations={[annotation]} onOpen={open}/>));expect(host.textContent).toContain('完整概述');await act(async()=>host.querySelector('button')!.click());expect(open).toHaveBeenCalledWith(annotation);}finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
