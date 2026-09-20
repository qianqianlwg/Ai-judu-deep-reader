// @vitest-environment jsdom
import { act } from "react";
import { createHash, webcrypto } from "node:crypto";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EpubReader, appearanceCss, type EpubReaderProps } from "./epub-reader";
import { DEFAULT_READING_APPEARANCE } from "@/lib/reading-appearance";
import type { FoliateBook, FoliateView } from "@/lib/foliate-types";
import { originalPositionKey, convertedPositionKey } from "@/lib/epub-position";
const loader=vi.hoisted(()=>({loadEpub:vi.fn(),createFoliateView:vi.fn()}));
vi.mock("@/lib/epub-loader",()=>loader);
const fb2loader=vi.hoisted(()=>({loadFb2:vi.fn()}));
vi.mock("@/lib/fb2-loader",()=>fb2loader);
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
 }),next:vi.fn(),prev:vi.fn(),close:vi.fn(),getCFI:()=>"epubcfi(/6/2!/4)",resolveCFI:()=>({index:0}),lastLocation:{cfi:"epubcfi(/6/2!/4)"}});
 view=raw as unknown as FoliateView;
 original={sections:[{id:"OEBPS/ch.xhtml",createDocument:async()=>doc,load:async()=>null,unload:()=>{}}],destroy:vi.fn(),toc:[{label:"第一章",href:"OEBPS/ch.xhtml"}],resolveHref:()=>({index:0,anchor:doc=>doc.body})};
 loader.loadEpub.mockResolvedValue(original);loader.createFoliateView.mockResolvedValue(view);fb2loader.loadFb2.mockResolvedValue(original);
 props={book:{id:"b",title:"书",author:"作者",editionId:"e",edition:{id:"e",fileName:"书.epub",fileType:"epub",createdAt:"now",hasOriginalFile:true,originalHash:"a".repeat(64)},chapters:[{id:"c",title:"第一章",sourceHref:"OEBPS/ch.xhtml",paragraphs:[{id:"p",text:"世界😀原版文字"},{id:"p2",text:"第二段"}]}]},anchor:null,appearance:DEFAULT_READING_APPEARANCE,annotations:[],concepts:[],onSelect:vi.fn(),onPosition:vi.fn(),onNotice:vi.fn(),onFallback:vi.fn()};
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();frame.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks();});
it("按版本拉取原件，保留 DOM，展示目录与翻页",async()=>{
 await render();expect(fetch).toHaveBeenCalledWith("/api/books/b/original?editionId=e",expect.objectContaining({cache:"no-store"}));
 expect(host.textContent).toContain("章节 1 / 1");expect(host.querySelector('select[aria-label="原书目录"]')).not.toBeNull();
 expect(view.open).toHaveBeenCalledWith(original);expect(doc.querySelector("p")?.textContent).toBe("世界😀原版文字");
 const next=Array.from(host.querySelectorAll("button")).find(button=>button.textContent==="原版下一页")!;
 await act(async()=>next.click());expect(view.next).toHaveBeenCalledOnce();
});
it("原版选区转换为既有 UTF-16 锚点，保留 emoji",async()=>{
 await render();const text=doc.querySelector("p")!.firstChild!,range=doc.createRange();range.setStart(text,2);range.setEnd(text,6);
 Object.defineProperty(range,"getBoundingClientRect",{value:()=>({left:10,top:60,width:30})});
 vi.spyOn(doc.defaultView!,"getSelection").mockReturnValue({rangeCount:1,isCollapsed:false,getRangeAt:()=>range} as unknown as Selection);
 await act(async()=>doc.dispatchEvent(new MouseEvent("mouseup")));
 expect(props.onSelect).toHaveBeenCalledWith({paragraphId:"p",startOffset:2,endOffset:6,text:"😀原版"},expect.any(Object));
 expect(JSON.parse(localStorage.getItem(originalPositionKey("e"))!).anchor.offset).toBe(2);
});
it("翻页定位段内字符，使用上游 section.current，不以段首覆盖",async()=>{
 await render();const next=Array.from(host.querySelectorAll("button")).find(button=>button.textContent==="原版下一页")!;
 const range=doc.createRange();range.setStart(doc.querySelector("p")!.firstChild!,4);range.setEnd(doc.querySelector("p")!.firstChild!,8);
 await act(async()=>{next.click();view.dispatchEvent(new CustomEvent("relocate",{detail:{section:{current:0},range,cfi:"epubcfi(/6/2!/4:4)"}}));});
 expect(props.onPosition).toHaveBeenCalledWith({paragraphId:"p",offset:4});
});
it("字体与 canonical 跳转不重复下载，切书释放资源",async()=>{
 await render();await render({anchor:{paragraphId:"p2",offset:1},appearance:{...props.appearance,fontSize:24}});
 expect(loader.loadEpub).toHaveBeenCalledOnce();expect(view.renderer.goTo).toHaveBeenCalled();expect(view.renderer.setStyles).toHaveBeenLastCalledWith(expect.stringContaining("font-size:24px"));
 expect(appearanceCss(props.appearance)).not.toContain("undefined");await act(async()=>root.unmount());
 expect(view.close).toHaveBeenCalledOnce();expect(original.destroy).toHaveBeenCalledOnce();root=createRoot(host);
});
it("原件缺失显示错误且可回落，错误时不允许翻页",async()=>{
 vi.spyOn(console,"error").mockImplementation(()=>{});vi.mocked(fetch).mockResolvedValue({ok:false,status:404,headers:new Headers({"content-type":"application/json"}),json:async()=>({error:"此版本没有原文件"})} as Response);
 await render();expect(host.querySelector('[role="alert"]')?.textContent).toContain("没有原文件");
 const fallback=Array.from(host.querySelectorAll("button")).find(button=>button.textContent==="切回精读")!;await act(async()=>fallback.click());expect(props.onFallback).toHaveBeenCalledOnce();
 expect(loader.loadEpub).not.toHaveBeenCalled();
});
it("创建 viewer 失败也释放已展开的书籍",async()=>{
 vi.spyOn(console,"error").mockImplementation(()=>{});loader.createFoliateView.mockRejectedValue(new Error("viewer failed"));await render();
 expect(original.destroy).toHaveBeenCalledOnce();expect(host.textContent).toContain("viewer failed");
});

it("手势翻页记录位置，排版重流不把段中锚点改为页首",async()=>{
 await render();const range=doc.createRange();range.selectNodeContents(doc.querySelectorAll('p')[1]);
 await act(async()=>{view.renderer.dispatchEvent(new CustomEvent('relocate',{detail:{reason:'snap'}}));view.dispatchEvent(new CustomEvent('relocate',{detail:{section:{current:0},range,cfi:'epubcfi(/6/2!/4)'}}));});
 expect(props.onPosition).toHaveBeenCalledWith({paragraphId:'p2',offset:0});vi.mocked(props.onPosition).mockClear();
 await act(async()=>{view.renderer.dispatchEvent(new CustomEvent('relocate',{detail:{reason:'anchor'}}));view.dispatchEvent(new CustomEvent('relocate',{detail:{section:{current:0},range,cfi:'epubcfi(/6/2!/4)'}}));});
 expect(props.onPosition).not.toHaveBeenCalled();
});
it("手动标记展示本地内容，不能打开占位AI会话",async()=>{
 const onOpenAnnotation=vi.fn();await render({onOpenAnnotation,annotations:[{id:'m',paragraphId:'p',startOffset:0,endOffset:2,textHash:'h',threadId:'manual-mark',summary:'我的笔记',concepts:[],createdAt:'now',kind:'note'}]});
 const range=doc.createRange();vi.spyOn(doc,'createRange').mockReturnValue(range);
 Object.defineProperty(range,'getClientRects',{value:()=>[{left:0,right:100,top:0,bottom:100}]});
 vi.spyOn(doc.defaultView!,'getSelection').mockReturnValue({isCollapsed:true} as Selection);
 await act(async()=>doc.querySelector('p')!.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:20,clientY:20})));
 expect(onOpenAnnotation).not.toHaveBeenCalled();expect(document.body.textContent).toContain('我的笔记');
});

it("跨章节脚注通过净化文档预览，不改变当前原文位置",async()=>{
 const notes=new DOMParser().parseFromString('<aside id="note">跨章节注释</aside>','text/html');
 original.sections.push({id:'OPS/notes.xhtml',createDocument:async()=>notes,load:async()=>null,unload:()=>{}});
 doc.body.insertAdjacentHTML('beforeend','<a epub:type="noteref" href="../OPS/notes.xhtml#note">注</a>');
 await render();await act(async()=>doc.querySelector('a')!.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})));
 expect(document.body.textContent).toContain('跨章节注释');expect(props.onPosition).not.toHaveBeenCalled();
});

it("普通引用悬停预览，点击按钮才跳转",async()=>{
 doc.body.innerHTML+='<a href="#reference">(10)</a><aside id="reference">这是引用说明。</aside>';
 await render();const a=doc.querySelector('a')!;
 await act(async()=>a.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));
 expect(document.body.textContent).toContain('这是引用说明。');
 expect(view.renderer.goTo).not.toHaveBeenCalled();
 const jump=Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='跳转到原文')!;
 await act(async()=>jump.click());
 expect(view.renderer.goTo).toHaveBeenCalled();expect(document.querySelector('.judu-annotation-popover')).toBeNull();
});

it("跨栏多段原版选文发出完整片段，无索引新选区清理旧状态",async()=>{
 const onClearSelection=vi.fn();await render({onClearSelection});
 const range=doc.createRange();range.setStart(doc.querySelector('p')!.firstChild!,2);range.setEnd(doc.querySelectorAll('p')[1].firstChild!,2);
 Object.defineProperty(range,'getBoundingClientRect',{value:()=>({left:10,top:60,width:30})});
 vi.spyOn(doc.defaultView!,'getSelection').mockReturnValue({rangeCount:1,isCollapsed:false,getRangeAt:()=>range} as unknown as Selection);
 await act(async()=>doc.dispatchEvent(new MouseEvent('mouseup')));
 expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({version:2,text:'😀原版文字\n\n第二',fragments:expect.arrayContaining([expect.objectContaining({paragraphId:'p'}),expect.objectContaining({paragraphId:'p2'})])}),expect.any(Object));
 doc.body.insertAdjacentHTML('beforeend','<aside>不在索引的脚注</aside>');range.selectNodeContents(doc.body);
 await act(async()=>doc.dispatchEvent(new MouseEvent('mouseup')));expect(onClearSelection).toHaveBeenCalledOnce();expect(props.onNotice).toHaveBeenCalledWith(expect.stringContaining('此次未提交'));
});

it("同一原版选区的mouseup与keyup不重复覆盖跨页合并快照，新拖选清理",async()=>{
 const onStartSelection=vi.fn();await render({onStartSelection});
 const range=doc.createRange();range.selectNodeContents(doc.querySelector('p')!);Object.defineProperty(range,'getBoundingClientRect',{value:()=>({left:10,top:60,width:30})});
 vi.spyOn(doc.defaultView!,'getSelection').mockReturnValue({rangeCount:1,isCollapsed:false,getRangeAt:()=>range} as unknown as Selection);
 await act(async()=>{doc.dispatchEvent(new MouseEvent('mouseup'));doc.dispatchEvent(new KeyboardEvent('keyup'));});expect(props.onSelect).toHaveBeenCalledOnce();
 await act(async()=>doc.dispatchEvent(new Event('pointerdown')));expect(onStartSelection).toHaveBeenCalledOnce();
 await act(async()=>doc.dispatchEvent(new MouseEvent('mouseup')));expect(props.onSelect).toHaveBeenCalledTimes(2);
});


function assembleFb2(format = "fb2"): EpubReaderProps["book"] {
 original.sections[0].id="fb2-v1/section-0.xhtml";original.toc=[{label:"FB2章节",href:original.sections[0].id}];
 return {...props.book,editionId:"e-fb2",edition:{...props.book.edition!,id:"e-fb2",fileType:format},chapters:props.book.chapters.map(chapter=>({...chapter,sourceHref:original.sections[0].id}))};
}
it.each(["fb2","fbz","fb2.zip"])("%s原文件按版本获取并装配FB2 loader，不能交给EPUB ZIP解析",async format=>{
 await render({book:assembleFb2(format)});
 expect(fetch).toHaveBeenCalledWith("/api/books/b/original?editionId=e-fb2",expect.objectContaining({cache:"no-store"}));
 expect(fb2loader.loadFb2).toHaveBeenCalledWith(expect.any(Blob),format);expect(loader.loadEpub).not.toHaveBeenCalled();
 expect(view.open).toHaveBeenCalledWith(original);expect(view.getAttribute("aria-label")).toBe("FB2 原版内容");expect(host.textContent).toContain("FB2章节");
});
it("FB2标题和表格单元使用data-fb2-paragraph精确映射，原版选择与来源回跳都覆盖",async()=>{
 const book=assembleFb2();doc.body.innerHTML='<h1 data-fb2-paragraph="0">世界😀原版文字</h1><table><tbody><tr><td data-fb2-paragraph="1">第二段</td></tr></tbody></table>';
 await render({book});const range=doc.createRange();range.selectNodeContents(doc.querySelector("td")!);
 Object.defineProperty(range,"getBoundingClientRect",{value:()=>({left:10,top:60,width:40})});
 vi.spyOn(doc.defaultView!,"getSelection").mockReturnValue({rangeCount:1,isCollapsed:false,getRangeAt:()=>range} as unknown as Selection);
 await act(async()=>doc.dispatchEvent(new MouseEvent("mouseup")));
 expect(props.onSelect).toHaveBeenCalledWith({paragraphId:"p2",startOffset:0,endOffset:3,text:"第二段"},expect.any(Object));
 await render({anchor:{paragraphId:"p",offset:2}});expect(view.renderer.goTo).toHaveBeenCalledWith(expect.objectContaining({index:0,anchor:expect.any(Function)}));
 expect(props.onNotice).not.toHaveBeenCalledWith(expect.stringContaining("无法精确映射"));
});
it("FB2解析失败明确回退精读，不降级为raw EPUB或静默成功",async()=>{
 fb2loader.loadFb2.mockRejectedValueOnce(new Error("受控FB2解析失败"));const error=vi.spyOn(console,"error").mockImplementation(()=>{});
 await render({book:assembleFb2()});expect(host.textContent).toContain("受控FB2解析失败");expect(loader.loadEpub).not.toHaveBeenCalled();expect(view.open).not.toHaveBeenCalled();
 const fallback=[...host.querySelectorAll("button")].find(button=>button.textContent==="切回精读")!;await act(async()=>fallback.click());expect(props.onFallback).toHaveBeenCalledOnce();expect(error).toHaveBeenCalled();
});
it("FB2延迟load在组件卸载后完成仍销毁归属资源，不创建迟到View",async()=>{
 let resolve!:(book:FoliateBook)=>void;fb2loader.loadFb2.mockReturnValueOnce(new Promise<FoliateBook>(done=>{resolve=done;}));
 await render({book:assembleFb2()});expect(fb2loader.loadFb2).toHaveBeenCalledOnce();await act(async()=>root.render(null));
 const late={...original,destroy:vi.fn()};await act(async()=>resolve(late));expect(late.destroy).toHaveBeenCalledOnce();expect(loader.createFoliateView).not.toHaveBeenCalled();expect(host.childNodes).toHaveLength(0);
});

const convertedBytes = new TextEncoder().encode("converted EPUB bytes").buffer;
function assembleUmd(bytes: ArrayBuffer = convertedBytes): EpubReaderProps["book"] {
 vi.stubGlobal("crypto", webcrypto); original.sections[0].id="OPS/chapter-0001.xhtml";
 vi.mocked(fetch).mockResolvedValue({ok:true,arrayBuffer:async()=>bytes} as Response);
 return {...props.book,edition:{...props.book.edition!,fileType:".umd",fileName:"书.umd",conversion:{format:".epub",sourceHash:"a".repeat(64),fileHash:createHash("sha256").update(new Uint8Array(bytes)).digest("hex"),fileSize:bytes.byteLength,converterVersion:"umd-epub-v1",createdAt:"now"}},chapters:props.book.chapters.map(chapter=>({...chapter,sourceHref:"OPS/chapter-0001.xhtml"}))};
}
async function settleConversion() {await act(async()=>{await vi.waitFor(()=>{if(!loader.loadEpub.mock.calls.length&&!host.querySelector('[role="alert"]'))throw new Error("转换版尚未完成加载边界");});});}
it("UMD只读取转换EPUB并校验字节，原件下载单独保留且界面不伪称原版",async()=>{
 await render({book:assembleUmd()});await settleConversion();
 expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/books/b/converted?editionId=e",expect.objectContaining({cache:"no-store"}));
 expect(loader.loadEpub).toHaveBeenCalledWith(expect.any(Blob));expect(fb2loader.loadFb2).not.toHaveBeenCalled();
 expect(host.querySelector('section')?.getAttribute('aria-label')).toBe('UMD 转换版阅读器');expect(view.getAttribute('aria-label')).toBe('UMD 转换版内容');
 expect(host.textContent).toContain('转换版下一页');expect(host.textContent).toContain('不代表原文件版式');
 expect(host.querySelector('a[download]')?.getAttribute('href')).toBe('/api/books/b/original?editionId=e');
});
it("UMD选文写入独立双hash位置，精读来源回跳仍逐字定位",async()=>{
 const book=assembleUmd();const old='{"original":"do not overwrite"}';localStorage.setItem(originalPositionKey('e'),old);
 await render({book});await settleConversion();const range=doc.createRange();range.selectNodeContents(doc.querySelectorAll('p')[1]);
 Object.defineProperty(range,'getBoundingClientRect',{value:()=>({left:10,top:60,width:30})});vi.spyOn(doc.defaultView!,'getSelection').mockReturnValue({rangeCount:1,isCollapsed:false,getRangeAt:()=>range} as unknown as Selection);
 await act(async()=>doc.dispatchEvent(new MouseEvent('mouseup')));
 expect(props.onSelect).toHaveBeenCalledWith({paragraphId:'p2',startOffset:0,endOffset:3,text:'第二段'},expect.any(Object));
 expect(JSON.parse(localStorage.getItem(convertedPositionKey('e'))!)).toMatchObject({kind:'umd-epub',sourceHash:book.edition!.originalHash,fileHash:book.edition!.conversion!.fileHash,converterVersion:'umd-epub-v1',anchor:{paragraphId:'p2',offset:0}});
 expect(localStorage.getItem(originalPositionKey('e'))).toBe(old);
 await render({anchor:{paragraphId:'p',offset:2}});expect(view.renderer.goTo).toHaveBeenCalledWith(expect.objectContaining({index:0,anchor:expect.any(Function)}));expect(fetch).toHaveBeenCalledOnce();
});
it.each(['match','old-original','different-derived'])("UMD恢复位置只接受当前派生身份：%s",async kind=>{
 const book=assembleUmd(),cfi='epubcfi(/6/2!/4/1:4)';
 const identity=book.edition!.conversion!;
 if(kind==='old-original')localStorage.setItem(originalPositionKey('e'),JSON.stringify({version:1,originalHash:identity.sourceHash,cfi,anchor:null}));
 else localStorage.setItem(convertedPositionKey('e'),JSON.stringify({version:1,kind:'umd-epub',sourceHash:identity.sourceHash,fileHash:kind==='match'?identity.fileHash:'c'.repeat(64),converterVersion:identity.converterVersion,cfi,anchor:null}));
 await render({book});await settleConversion();
 expect(view.init).toHaveBeenCalledWith(kind==='match'?{lastLocation:cfi,showTextStart:true}:{showTextStart:true});
});
it.each(['hash','size','metadata','missing-response'])("转换版%s失败不回退读取原UMD或启动EPUB解析",async kind=>{
 vi.spyOn(console,'error').mockImplementation(()=>{});const book=assembleUmd();
 if(kind==='hash')book.edition!.conversion!.fileHash='b'.repeat(64);
 if(kind==='size')book.edition!.conversion!.fileSize++;
 if(kind==='metadata')book.edition!.conversion!.sourceHash='b'.repeat(64);
 if(kind==='missing-response')vi.mocked(fetch).mockResolvedValue({ok:false,status:404,headers:new Headers({'content-type':'application/json'}),json:async()=>({error:'转换版文件已丢失'})} as Response);
 await render({book});await settleConversion();expect(host.querySelector('[role="alert"]')).not.toBeNull();expect(loader.loadEpub).not.toHaveBeenCalled();expect(view.open).not.toHaveBeenCalled();
 expect(vi.mocked(fetch).mock.calls.some(call=>String(call[0]).includes('/original?'))).toBe(false);
 expect([...host.querySelectorAll('button')].some(button=>button.textContent==='重试转换版')).toBe(true);
});
it("同版本派生hash改变会重开文件并关闭旧会话，不复用旧CFI",async()=>{
 await render({book:assembleUmd()});await settleConversion();const nextBytes=new TextEncoder().encode('new converted EPUB bytes').buffer;
 const next=assembleUmd(nextBytes);await render({book:next});await act(async()=>{await vi.waitFor(()=>expect(loader.loadEpub).toHaveBeenCalledTimes(2));});
 expect(fetch).toHaveBeenCalledTimes(2);expect(original.destroy).toHaveBeenCalledOnce();expect(view.close).toHaveBeenCalledOnce();
});
