// @vitest-environment jsdom
import{act}from'react';import{createRoot}from'react-dom/client';import{expect,it,vi}from'vitest';
const dynamicState=vi.hoisted(()=>({next:0}));
// WHY：保留原有按需组件mock，只记录组件身份以验证FB2与EPUB共享装配、PDF仍独立，不模拟底层阅读行为。
vi.mock('next/dynamic',()=>({default:()=>{const identity=dynamicState.next++;return function DeferredReader(){return <div data-renderer={identity}>按需渲染器</div>;};}}));
import{OriginalReader}from'./original-reader';import{DEFAULT_READING_APPEARANCE}from'@/lib/reading-appearance';
it('缺原件时保留明确回退，不装配错误格式渲染器',async()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host),fallback=vi.fn();try{await act(async()=>root.render(<OriginalReader book={{id:'b',title:'书',author:'',chapters:[]}} anchor={null} appearance={DEFAULT_READING_APPEARANCE} annotations={[]} concepts={[]} onSelect={vi.fn()} onPosition={vi.fn()} onNotice={vi.fn()} onFallback={fallback}/>));expect(host.textContent).toContain('没有可用原文件');await act(async()=>host.querySelector('button')!.click());expect(fallback).toHaveBeenCalledOnce();}finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}});


it.each(["fb2","fbz","fb2.zip"])("%s组合根复用EPUB原版阅读组件，但不误用PDF组件",async format=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);const host=document.createElement("div"),root=createRoot(host);
 const common={anchor:null,appearance:DEFAULT_READING_APPEARANCE,annotations:[],concepts:[],onSelect:vi.fn(),onPosition:vi.fn(),onNotice:vi.fn(),onFallback:vi.fn()};
 const book={id:"b",title:"合成书",author:"",editionId:"e",edition:{id:"e",fileName:"合成.epub",fileType:"epub",createdAt:"now",hasOriginalFile:true},chapters:[{id:"c",title:"章",sourceHref:"OPS/c.xhtml",paragraphs:[]}]};
 try{await act(async()=>root.render(<OriginalReader {...common} book={book}/>));const epubIdentity=host.querySelector("[data-renderer]")?.getAttribute("data-renderer");expect(epubIdentity).toBeDefined();
  await act(async()=>root.render(<OriginalReader {...common} book={{...book,edition:{...book.edition,fileType:format},chapters:[{...book.chapters[0],sourceHref:"fb2-v1/section-0.xhtml"}]}}/>));
  expect(host.querySelector("[data-renderer]")?.getAttribute("data-renderer")).toBe(epubIdentity);expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async()=>root.render(<OriginalReader {...common} book={{...book,edition:{...book.edition,fileType:"pdf"}}}/>));
  expect(host.querySelector("[data-renderer]")?.getAttribute("data-renderer")).not.toBe(epubIdentity);
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
it("UMD有效派生版本进入EPUB渲染器而非原文件解析器",async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);
 const common={anchor:null,appearance:DEFAULT_READING_APPEARANCE,annotations:[],concepts:[],onSelect:vi.fn(),onPosition:vi.fn(),onNotice:vi.fn(),onFallback:vi.fn()};
 const book={id:'b',title:'书',author:'',editionId:'e',edition:{id:'e',fileName:'书.epub',fileType:'.epub',hasOriginalFile:true,createdAt:'now'},chapters:[{id:'c',title:'章',sourceHref:'OPS/chapter-0001.xhtml',paragraphs:[{id:'p',text:'原文'}]}]};
 try{
  await act(async()=>root.render(<OriginalReader {...common} book={book}/>));const expected=host.querySelector('[data-renderer]')?.getAttribute('data-renderer');
  await act(async()=>root.render(<OriginalReader {...common} book={{...book,edition:{...book.edition,fileType:'.umd',originalHash:'a'.repeat(64),conversion:{format:'.epub',sourceHash:'a'.repeat(64),fileHash:'b'.repeat(64),fileSize:100,converterVersion:'umd-epub-v1',createdAt:'now'}}}}/>));
  expect(host.querySelector('[data-renderer]')?.getAttribute('data-renderer')).toBe(expected);expect(host.querySelector('[role="alert"]')).toBeNull();
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
