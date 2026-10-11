// @vitest-environment jsdom
import {act} from "react";import {createRoot} from "react-dom/client";import {expect,it,vi} from "vitest";
import {ConceptPopoverContent,HistoryPopoverContent} from "./reading-popover-content";
it("历史浮窗优先展示右侧同一释读及其 Agent 重点，支持标题栏承载操作且时间在右下",async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host),open=vi.fn();const annotation={id:'a',paragraphId:'p',startOffset:0,endOffset:2,textHash:'h',threadId:'t',messageId:'unit',summary:'旧版摘要',concepts:[],createdAt:'2026-09-18'};const content='关键词解释清楚，并给出了可以复核的结论。';const emphasis={version:1 as const,marks:[{kind:'term' as const,quote:'关键词',occurrence:1},{kind:'key_sentence' as const,quote:'并给出了可以复核的结论。',occurrence:1}]};
 try{await act(async()=>root.render(<HistoryPopoverContent annotations={[annotation]} onOpen={open} showOpenButton={false} readingsByMessageId={new Map([['unit',{content,emphasis}]])}/>));const item=host.querySelector('li')!;expect(item.querySelector('.judu-annotation-summary')?.textContent).toBe(content);expect(item.querySelector('[data-answer-emphasis="term"]')?.textContent).toBe('关键词');expect(item.querySelector('[data-answer-emphasis="key_sentence"]')?.textContent).toBe('并给出了可以复核的结论。');expect(item.querySelector('button')).toBeNull();expect(item.lastElementChild?.tagName).toBe('TIME');}finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});

it("多条历史仍分别提供对应的完整句读入口",async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host),open=vi.fn();const annotation={id:'a',paragraphId:'p',startOffset:0,endOffset:2,textHash:'h',threadId:'t',summary:'完整概述',concepts:[],createdAt:'2026-09-18'};
 try{await act(async()=>root.render(<HistoryPopoverContent annotations={[annotation,{...annotation,id:'b'}]} onOpen={open} hideFirstOpenButton/>));expect(host.querySelectorAll('.judu-annotation-history button')).toHaveLength(1);await act(async()=>host.querySelector('button')!.click());expect(open).toHaveBeenCalledWith({...annotation,id:'b'});}finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});

it("原版和精读内容共用：缺定义不伪造、历史展示摘要并打开对应记录",async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host),open=vi.fn();const annotation={id:'a',paragraphId:'p',startOffset:0,endOffset:2,textHash:'h',threadId:'t',summary:'完整概述',concepts:[],createdAt:'2026-09-18'};
 try{await act(async()=>root.render(<ConceptPopoverContent concept={{name:'概念',definitions:[{name:'概念',text:''}]}}/>));expect(host.textContent).toBe('暂无定义');await act(async()=>root.render(<HistoryPopoverContent annotations={[annotation]} onOpen={open}/>));expect(host.textContent).toContain('完整概述');await act(async()=>host.querySelector('button')!.click());expect(open).toHaveBeenCalledWith(annotation);}finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
