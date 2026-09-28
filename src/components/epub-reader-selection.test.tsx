// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EpubReader, appearanceCss, type EpubReaderProps } from "./epub-reader";
import { DEFAULT_READING_APPEARANCE } from "@/lib/reading-appearance";
import type { FoliateBook, FoliateView } from "@/lib/foliate-types";
const loader=vi.hoisted(()=>({loadEpub:vi.fn(),createFoliateView:vi.fn()}));
vi.mock("@/lib/epub-loader",()=>loader);
const fb2loader=vi.hoisted(()=>({loadFb2:vi.fn()}));
vi.mock("@/lib/fb2-loader",()=>fb2loader);
const mobiloader=vi.hoisted(()=>({loadMobiPublication:vi.fn()}));
vi.mock("@/lib/mobi-loader",()=>mobiloader);
let root:Root,host:HTMLDivElement,frame:HTMLIFrameElement,doc:Document,view:FoliateView,original:FoliateBook,props:EpubReaderProps;
async function render(next:Partial<EpubReaderProps>={}){props={...props,...next};await act(async()=>{root.render(<EpubReader {...props}/>);});}
beforeEach(()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);localStorage.clear();
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
 frame=document.createElement("iframe");document.body.append(frame);doc=frame.contentDocument!;
 const rect={left:0,top:0,right:800,bottom:600,width:800,height:600,x:0,y:0,toJSON:()=>({})};
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue(rect);
 Object.defineProperty(doc.createRange().constructor.prototype,'getClientRects',{configurable:true,value:()=>[{...rect,left:10,top:20,right:110,bottom:40,width:100,height:20}]});
 const FrameElement=Reflect.get(doc.defaultView!,'Element') as typeof Element;
 vi.spyOn(FrameElement.prototype,'getBoundingClientRect').mockReturnValue({...rect,left:10,top:20,right:110,bottom:40,width:100,height:20});
 doc.body.innerHTML='<p>世界😀原版文字</p><p>第二段</p>';
 vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,blob:async()=>new Blob(["epub"])})));
 const raw=document.createElement("div"),renderer=document.createElement("div");
 const contentRange=doc.createRange();contentRange.selectNodeContents(doc.querySelector("p")!);
 const goTo=vi.fn(async(target:{index:number;anchor:(doc:Document)=>Range|Element})=>{target.anchor(doc);});
 Object.assign(renderer,{setStyles:vi.fn(),goTo,getContents:()=>[{doc,index:0}]});
 Object.assign(raw,{renderer,open:vi.fn(),init:vi.fn(async()=>{
   raw.dispatchEvent(new CustomEvent("load",{detail:{doc,index:0}}));
   raw.dispatchEvent(new CustomEvent("relocate",{detail:{section:{current:0},fraction:0.1,range:contentRange,cfi:"epubcfi(/6/2!/4)"}}));
 }),next:vi.fn(),prev:vi.fn(),close:vi.fn(),getCFI:()=>"epubcfi(/6/2!/4)",resolveCFI:()=>({index:0,anchor:(target:Document)=>target.body}),lastLocation:{cfi:"epubcfi(/6/2!/4)"}});
 view=raw as unknown as FoliateView;
 original={sections:[{id:"OEBPS/ch.xhtml",createDocument:async()=>doc,load:async()=>null,unload:()=>{}}],destroy:vi.fn(),toc:[{label:"第一章",href:"OEBPS/ch.xhtml"}],resolveHref:()=>({index:0,anchor:doc=>doc.body})};
 loader.loadEpub.mockResolvedValue(original);loader.createFoliateView.mockResolvedValue(view);fb2loader.loadFb2.mockResolvedValue(original);mobiloader.loadMobiPublication.mockResolvedValue({book:original,warnings:[]});
 props={book:{id:"b",title:"书",author:"作者",editionId:"e",edition:{id:"e",fileName:"书.epub",fileType:"epub",createdAt:"now",hasOriginalFile:true,originalHash:"a".repeat(64)},chapters:[{id:"c",title:"第一章",sourceHref:"OEBPS/ch.xhtml",paragraphs:[{id:"p",text:"世界😀原版文字"},{id:"p2",text:"第二段"}]}]},anchor:null,appearance:DEFAULT_READING_APPEARANCE,annotations:[],concepts:[],onSelect:vi.fn(),onPosition:vi.fn(),onNotice:vi.fn(),onFallback:vi.fn()};
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();frame.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks();});
it("拖选过程中即使停顿也不弹菜单，iframe外释放后提交",async()=>{await render();Object.defineProperty(doc.createRange().constructor.prototype,'getBoundingClientRect',{configurable:true,value:()=>({left:10,top:60,width:30})});await act(async()=>{doc.body.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0}));const range=doc.createRange();range.selectNodeContents(doc.querySelector('p')!);doc.getSelection()!.removeAllRanges();doc.getSelection()!.addRange(range);doc.dispatchEvent(new Event('selectionchange'));await new Promise(resolve=>setTimeout(resolve,150));});expect(props.onSelect).not.toHaveBeenCalled();await act(async()=>document.dispatchEvent(new MouseEvent('pointerup',{button:0})));expect(props.onSelect).toHaveBeenCalledTimes(1);});

it.each(["button", "textarea"])("原版确认选文后焦点转入外层 %s，保留标注用 UTF-16 快照", async (tag) => {
 const clear = vi.fn(); await render({ onClearSelection: clear });
 const text = doc.querySelector("p")!.firstChild!, range = doc.createRange(); range.setStart(text, 2); range.setEnd(text, 6);
 Object.defineProperty(range, "getBoundingClientRect", { value: () => ({ left: 10, top: 60, width: 30 }) });
 vi.spyOn(doc.defaultView!, "getSelection").mockReturnValue({ rangeCount: 1, isCollapsed: false, getRangeAt: () => range } as unknown as Selection);
 doc.querySelector("p")!.tabIndex = 0; doc.querySelector("p")!.focus();
 await act(async () => {
  doc.querySelector("p")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  doc.dispatchEvent(new MouseEvent("pointerup", { button: 0 }));
 });
 expect(props.onSelect).toHaveBeenLastCalledWith({ paragraphId: "p", startOffset: 2, endOffset: 6, text: "😀原版" }, expect.any(Object));
 clear.mockClear(); const control = document.createElement(tag); document.body.append(control);
 await act(async () => { control.focus(); doc.defaultView!.dispatchEvent(new Event("blur")); });
 expect(document.activeElement).toBe(control); expect(clear).not.toHaveBeenCalled(); control.remove();
});

it("霞鹜文楷只在原版选中时注入同源字库，并保留系统字体默认样式", () => {
 const wenkai = appearanceCss({...DEFAULT_READING_APPEARANCE,font:"wenkai"});
 expect(wenkai).toContain('@font-face{font-family:"LXGW WenKai Reader"');
 expect(wenkai).toContain('/fonts/lxgw-wenkai/LXGWWenKai-Regular.ttf');
 expect(wenkai).toContain('font-display:swap');
 const absolute = appearanceCss({...DEFAULT_READING_APPEARANCE,font:"wenkai"},"http://localhost:3100");
 expect(absolute).toContain('src:url("http://localhost:3100/fonts/lxgw-wenkai/LXGWWenKai-Regular.ttf")');
 expect(absolute).not.toContain('src:url("/fonts/');
 expect(appearanceCss(DEFAULT_READING_APPEARANCE)).not.toContain('@font-face');
});

it("生成锁定选区时仍能操作原版下一页",async()=>{
 await render();
 await render({disabled:true,navigationDisabled:false});
 const next=[...host.querySelectorAll('button')].find(button=>button.textContent==="原版下一页") as HTMLButtonElement;
 expect(next.disabled).toBe(false);
 await act(async()=>{next.click();});
 expect(view.next).toHaveBeenCalledOnce();
});

it("生成锁住原版操作但仍可重新选文，便于朗读且不触发新句读", async () => {
 await render({disabled:true,selectionDisabled:false});
 const range=doc.createRange();range.selectNodeContents(doc.querySelectorAll("p")[1]);
 Object.defineProperty(range,"getBoundingClientRect",{value:()=>({left:10,top:60,width:30,height:20})});
 vi.spyOn(doc.defaultView!,"getSelection").mockReturnValue({rangeCount:1,isCollapsed:false,getRangeAt:()=>range} as unknown as Selection);
 await act(async()=>doc.dispatchEvent(new MouseEvent("mouseup")));
 expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({paragraphId:"p2",text:"第二段"}),expect.any(Object));
 expect([...host.querySelectorAll("nav button")].every(button=>(button as HTMLButtonElement).disabled)).toBe(true);
});
