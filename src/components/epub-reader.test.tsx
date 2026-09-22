// @vitest-environment jsdom
import { act } from "react";
import { createHash, webcrypto } from "node:crypto";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EpubReader, appearanceCss, type EpubReaderProps } from "./epub-reader";
import { DEFAULT_READING_APPEARANCE } from "@/lib/reading-appearance";
import type { FoliateBook, FoliateView } from "@/lib/foliate-types";
import { originalPositionKey, convertedPositionKey } from "@/lib/epub-position";
import { capReadingSelection, selectionFromParts, selectionParts } from "@/lib/reader-selection";
const loader=vi.hoisted(()=>({loadEpub:vi.fn(),createFoliateView:vi.fn()}));
vi.mock("@/lib/epub-loader",()=>loader);
const fb2loader=vi.hoisted(()=>({loadFb2:vi.fn()}));
vi.mock("@/lib/fb2-loader",()=>fb2loader);
const mobiloader=vi.hoisted(()=>({loadMobiPublication:vi.fn()}));
vi.mock("@/lib/mobi-loader",()=>mobiloader);
let root:Root,host:HTMLDivElement,frame:HTMLIFrameElement,doc:Document,view:FoliateView,original:FoliateBook,props:EpubReaderProps;
function deferred<T>(){let resolve!:(value:T|PromiseLike<T>)=>void,reject!:(reason?:unknown)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail});return {promise,resolve,reject};}
function makeView():FoliateView{const raw=document.createElement("div"),renderer=document.createElement("div");Object.assign(renderer,{setStyles:vi.fn(),goTo:vi.fn(async(target:{anchor:(doc:Document)=>unknown})=>{target.anchor(doc)}),getContents:()=>[{doc,index:0}]});Object.assign(raw,{renderer,open:vi.fn(async()=>{}),init:vi.fn(async()=>{}),next:vi.fn(),prev:vi.fn(),close:vi.fn(),getCFI:()=>"epubcfi(/6/2!/4)",resolveCFI:()=>({index:0,anchor:(target:Document)=>target.body}),lastLocation:{cfi:"epubcfi(/6/2!/4)"}});return raw as unknown as FoliateView;}
function makeBook(id:string):FoliateBook{return {...original,positionIdentity:id,sections:original.sections.map(section=>({...section})),destroy:vi.fn()};}
function makeSourceBook(id:string,editionId:string):EpubReaderProps["book"]{return {...props.book,id,editionId,edition:{...props.book.edition!,id:editionId,fileName:`${id}.epub`}};}
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

it("原版 view.open 延迟超过20秒后关闭资源且忽略迟到事件",async()=>{
 vi.spyOn(console,"error").mockImplementation(()=>{});vi.useFakeTimers();const open=deferred<void>();vi.mocked(view.open).mockReturnValueOnce(open.promise);
 await render();expect(view.open).toHaveBeenCalledOnce();await act(async()=>{await vi.advanceTimersByTimeAsync(20_000);});
 expect(host.querySelector('[role="alert"]')?.textContent).toContain("原版渲染超时");expect(view.close).toHaveBeenCalledOnce();expect(original.destroy).toHaveBeenCalledOnce();vi.mocked(props.onNotice).mockClear();
 await act(async()=>{open.resolve();await Promise.resolve();await Promise.resolve();await Promise.resolve();});
 expect(view.init).not.toHaveBeenCalled();expect(props.onNotice).not.toHaveBeenCalled();
});
it("原版 view.init 延迟超过20秒后关闭资源且忽略迟到load",async()=>{
 vi.spyOn(console,"error").mockImplementation(()=>{});vi.useFakeTimers();const init=deferred<void>();vi.mocked(view.init).mockImplementationOnce(async()=>{await init.promise;view.dispatchEvent(new CustomEvent("load",{detail:{doc,index:0}}));});
 await render();expect(view.init).toHaveBeenCalledOnce();vi.mocked(props.onNotice).mockClear();await act(async()=>{await vi.advanceTimersByTimeAsync(20_000);});
 expect(host.querySelector('[role="alert"]')?.textContent).toContain("原版渲染超时");expect(view.close).toHaveBeenCalledOnce();expect(original.destroy).toHaveBeenCalledOnce();
 await act(async()=>{init.resolve();await Promise.resolve();await Promise.resolve();});expect(props.onNotice).not.toHaveBeenCalled();
});
it("原版 renderer.goTo 延迟超过20秒后关闭资源且忽略迟到load",async()=>{
 vi.spyOn(console,"error").mockImplementation(()=>{});vi.useFakeTimers();const goTo=deferred<void>();vi.mocked(view.renderer.goTo).mockImplementationOnce(async target=>{await goTo.promise;target.anchor(doc);view.dispatchEvent(new CustomEvent("load",{detail:{doc,index:0}}));});
 await render({anchor:{paragraphId:"p",offset:1}});expect(view.renderer.goTo).toHaveBeenCalledOnce();vi.mocked(props.onNotice).mockClear();await act(async()=>{await vi.advanceTimersByTimeAsync(20_000);});
 expect(host.querySelector('[role="alert"]')?.textContent).toContain("原版渲染超时");expect(view.close).toHaveBeenCalledOnce();expect(original.destroy).toHaveBeenCalledOnce();
 await act(async()=>{goTo.resolve();await Promise.resolve();await Promise.resolve();});expect(props.onNotice).not.toHaveBeenCalled();
});
it("切换书籍会取消旧的 view.open，迟到promise不污染新会话",async()=>{
 const oldOpen=deferred<void>(),nextView=makeView(),nextBook=makeBook("book-2"),nextSource=makeSourceBook("b-2","e-2");vi.mocked(view.open).mockReturnValueOnce(oldOpen.promise);loader.loadEpub.mockResolvedValueOnce(original).mockResolvedValueOnce(nextBook);loader.createFoliateView.mockResolvedValueOnce(view).mockResolvedValueOnce(nextView);
 await render();expect(view.open).toHaveBeenCalledOnce();await render({book:nextSource});await act(async()=>{await vi.waitFor(()=>expect(nextView.init).toHaveBeenCalledOnce());});
 expect(host.querySelector('[aria-label="EPUB 原版内容"]')).toBe(nextView);vi.mocked(props.onNotice).mockClear();await act(async()=>{oldOpen.resolve();await Promise.resolve();await Promise.resolve();});
 expect(view.close).toHaveBeenCalledTimes(2);expect(original.destroy).toHaveBeenCalledOnce();expect(nextView.close).not.toHaveBeenCalled();expect(nextBook.destroy).not.toHaveBeenCalled();expect(host.querySelector('[aria-label="EPUB 原版内容"]')).toBe(nextView);expect(props.onNotice).not.toHaveBeenCalled();
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

const mobiIdentity = `mobi-publication-v1:${"a".repeat(64)}:${"b".repeat(64)}`;
function assembleMobi(): EpubReaderProps["book"] {
 original.sections[0].id="mobi-v1/mobi/0";original.positionIdentity=mobiIdentity;
 original.toc=[{label:"MOBI 第一章",href:original.sections[0].id}];
 return {...props.book,editionId:"e-mobi",edition:{...props.book.edition!,id:"e-mobi",fileName:"书.mobi",fileType:".mobi"},
  chapters:props.book.chapters.map(chapter=>({...chapter,sourceHref:original.sections[0].id}))};
}
function mockMobiSelection(range:Range) {
 Object.defineProperty(range,"getBoundingClientRect",{value:()=>({left:10,top:60,width:30})});
 vi.spyOn(doc.defaultView!,"getSelection").mockReturnValue({rangeCount:1,isCollapsed:false,getRangeAt:()=>range} as unknown as Selection);
}
it("MOBI加载各阶段标识正确，只将布局响应交给动态MOBI loader",async()=>{
 const book=assembleMobi();book.id="书/一";book.editionId="版/一";book.edition!.id=book.editionId;
 let finishFetch!:(response:Response)=>void,finishLoad!:(result:{book:FoliateBook;warnings:string[]})=>void;
 vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>(resolve=>{finishFetch=resolve;}));
 mobiloader.loadMobiPublication.mockReturnValueOnce(new Promise<{book:FoliateBook;warnings:string[]}>(resolve=>{finishLoad=resolve;}));
 await render({book});
 expect(host.querySelector('[role="status"]')?.textContent).toBe("正在加载 MOBI 原版…");
 expect(host.querySelector("section")?.getAttribute("aria-label")).toBe("MOBI 原版阅读器");
 expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/books/%E4%B9%A6%2F%E4%B8%80/mobi-layout?editionId=%E7%89%88%2F%E4%B8%80",expect.objectContaining({cache:"no-store",signal:expect.any(AbortSignal)}));
 expect(loader.loadEpub).not.toHaveBeenCalled();expect(mobiloader.loadMobiPublication).not.toHaveBeenCalled();
 const response=new Response("{}",{headers:{"content-type":"application/json"}}),blob=vi.spyOn(response,"blob");
 await act(async()=>finishFetch(response));
 expect(host.querySelector('[role="status"]')?.textContent).toBe("正在校验并准备原版章节…");
 expect(mobiloader.loadMobiPublication).toHaveBeenCalledExactlyOnceWith(response,book.edition!.originalHash);
 expect(loader.loadEpub).not.toHaveBeenCalled();expect(blob).not.toHaveBeenCalled();
 await act(async()=>finishLoad({book:original,warnings:[]}));
 expect(view.open).toHaveBeenCalledWith(original);expect(view.getAttribute("aria-label")).toBe("MOBI 原版内容");
 expect(host.querySelector('[role="status"]')).toBeNull();expect(host.textContent).toContain("MOBI 第一章");
 expect(host.textContent).not.toContain("转换版");expect(host.textContent).not.toContain("EPUB");
 expect(loader.loadEpub).not.toHaveBeenCalled();expect(fb2loader.loadFb2).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledOnce();
});
it("MOBI嵌套裸文本及后续标题走真实映射，跨段选区写入独立身份位置",async()=>{
 const book=assembleMobi();doc.body.innerHTML='<h1>章名</h1><div>世界😀原版文字<h2>第二段</h2></div>';
 const legacy="保留EPUB位置",converted="保留UMD位置";
 localStorage.setItem(originalPositionKey("e-mobi"),legacy);localStorage.setItem(convertedPositionKey("e-mobi"),converted);
 const before=doc.body.innerHTML,onClearSelection=vi.fn();await render({book,onClearSelection});
 const range=doc.createRange();range.setStart(doc.querySelector("div")!.firstChild!,2);range.setEnd(doc.querySelector("h2")!.firstChild!,2);mockMobiSelection(range);
 await act(async()=>{doc.dispatchEvent(new MouseEvent("mouseup"));doc.dispatchEvent(new KeyboardEvent("keyup"));});
 expect(props.onSelect).toHaveBeenCalledExactlyOnceWith({version:2,paragraphId:"p",startOffset:2,endOffset:8,text:"😀原版文字\n\n第二",fragments:[
  {paragraphId:"p",startOffset:2,endOffset:8,text:"😀原版文字"},{paragraphId:"p2",startOffset:0,endOffset:2,text:"第二"},
 ]},expect.any(Object));
 expect(JSON.parse(localStorage.getItem("judu:original-position:mobi:e-mobi")!)).toEqual({version:1,originalHash:mobiIdentity,cfi:"epubcfi(/6/2!/4)",anchor:{paragraphId:"p",offset:2}});
 expect(localStorage.getItem(originalPositionKey("e-mobi"))).toBe(legacy);expect(localStorage.getItem(convertedPositionKey("e-mobi"))).toBe(converted);
 expect(doc.body.innerHTML).toBe(before);
 range.selectNodeContents(doc.body);await act(async()=>doc.dispatchEvent(new MouseEvent("mouseup")));
 expect(onClearSelection).toHaveBeenCalledOnce();expect(props.onSelect).toHaveBeenCalledOnce();expect(props.onNotice).toHaveBeenCalledWith(expect.stringContaining("此次未提交"));
 await render({anchor:{paragraphId:"p2",offset:1}});
 const navigation=vi.mocked(view.renderer.goTo).mock.calls.at(-1)![0];expect(navigation.anchor(doc).toString()).toBe("二");
 expect(fetch).toHaveBeenCalledOnce();expect(loader.loadEpub).not.toHaveBeenCalled();
});
it.each([false,true])("MOBI跨段沿用既有1000字cap并收紧真实选区，反向=%s",async reverse=>{
 const book=assembleMobi(),texts=["😀".repeat(600),"乙".repeat(600)];
 book.chapters[0].paragraphs=texts.map((text,index)=>({id:index?"p2":"p",text}));
 doc.body.innerHTML=`<h1>章</h1><div>${texts[0]}<p>${texts[1]}</p></div>`;
 Object.defineProperty(doc.createRange().constructor.prototype,"getBoundingClientRect",{configurable:true,value:()=>({left:10,top:60,width:30})});
 await render({book});
 const selection=doc.defaultView!.getSelection()!,first=doc.querySelector("div")!.firstChild!,last=doc.querySelector("p")!.firstChild!;
 selection.setBaseAndExtent(reverse?last:first,reverse?600:0,reverse?first:last,reverse?0:600);
 const expected=capReadingSelection(selectionFromParts(book.chapters[0].paragraphs.map(paragraph=>({paragraphId:paragraph.id,startOffset:0,endOffset:paragraph.text.length,text:paragraph.text}))),reverse);
 // WHY：不mock映射或cap；原版事件必须修改实际Selection，不能仅截断交给上层的请求文本。
 await act(async()=>doc.dispatchEvent(new MouseEvent("mouseup")));
 expect(props.onSelect).toHaveBeenCalledExactlyOnceWith(expected,expect.any(Object));expect(Array.from(expected.text)).toHaveLength(1000);
 expect(selection.toString()).toBe(selectionParts(expected).map(part=>part.text).join(""));
 expect(props.onNotice).toHaveBeenCalledWith("最多选择 1000 字，选区已限制到上限。");expect(fetch).toHaveBeenCalledOnce();
});
it("MOBI loaded warnings明确通知但不触发失败回退",async()=>{
 mobiloader.loadMobiPublication.mockResolvedValueOnce({book:original,warnings:["部分图片缺失。","一个引用不可定位。"]});
 await render({book:assembleMobi()});
 expect(props.onNotice).toHaveBeenCalledWith("部分图片缺失。 一个引用不可定位。");
 expect(props.onFallback).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')).toBeNull();expect(view.open).toHaveBeenCalledWith(original);
});
it.each(["match","old-layout","old-version","original-hash","epub-key","other-edition","umd-key"])("MOBI CFI仅恢复独立key和当前positionIdentity：%s",async kind=>{
 const book=assembleMobi(),cfi="epubcfi(/6/2!/4/1:4)";
 const identity=kind==="old-layout"?mobiIdentity.replace("b".repeat(64),"c".repeat(64)):kind==="old-version"?mobiIdentity.replace("v1:","v0:"):kind==="original-hash"?book.edition!.originalHash:mobiIdentity;
 const key=kind==="epub-key"?originalPositionKey("e-mobi"):kind==="other-edition"?originalPositionKey("mobi:other"):kind==="umd-key"?convertedPositionKey("e-mobi"):originalPositionKey("mobi:e-mobi");
 localStorage.setItem(key,JSON.stringify({version:1,originalHash:identity,cfi,anchor:null}));
 const resolve=vi.spyOn(view,"resolveCFI");await render({book});
 expect(view.init).toHaveBeenCalledExactlyOnceWith(kind==="match"?{lastLocation:cfi,showTextStart:true}:{showTextStart:true});
 if(kind==="match")expect(resolve).toHaveBeenCalledExactlyOnceWith(cfi);else expect(resolve).not.toHaveBeenCalled();
 expect(props.onPosition).not.toHaveBeenCalled();expect(loader.loadEpub).not.toHaveBeenCalled();
});
it("MOBI身份匹配但精读锚点改变时不恢复旧CFI",async()=>{
 const book=assembleMobi(),cfi="epubcfi(/6/2!/4/1:4)";
 localStorage.setItem(originalPositionKey("mobi:e-mobi"),JSON.stringify({version:1,originalHash:mobiIdentity,cfi,anchor:{paragraphId:"p",offset:0}}));
 const resolve=vi.spyOn(view,"resolveCFI");await render({book,anchor:{paragraphId:"p2",offset:1}});
 expect(resolve).not.toHaveBeenCalled();expect(view.init).toHaveBeenCalledWith({showTextStart:true});
 expect(vi.mocked(view.renderer.goTo).mock.calls.at(-1)![0].anchor(doc).toString()).toBe("二");
});
it("MOBI同身份CFI已经失效时明确通知并回到精读锚点",async()=>{
 const book=assembleMobi(),anchor={paragraphId:"p2",offset:1},cfi="epubcfi(/6/2!/4/1:4)";
 localStorage.setItem(originalPositionKey("mobi:e-mobi"),JSON.stringify({version:1,originalHash:mobiIdentity,cfi,anchor}));
 vi.spyOn(view,"resolveCFI").mockImplementation(()=>{throw new Error("过期CFI");});vi.spyOn(console,"warn").mockImplementation(()=>{});
 await render({book,anchor});
 expect(props.onNotice).toHaveBeenCalledWith("原版位置已失效，已回退到精读锚点。");expect(view.init).toHaveBeenCalledExactlyOnceWith({showTextStart:true});
 expect(vi.mocked(view.renderer.goTo).mock.calls.at(-1)![0].anchor(doc).toString()).toBe("二");expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("MOBI手势位置按真实章节UTF-16锚点保存，重流不覆盖位置",async()=>{
 await render({book:assembleMobi()});const range=doc.createRange();range.setStart(doc.querySelector("p")!.firstChild!,4);range.setEnd(doc.querySelector("p")!.firstChild!,8);
 await act(async()=>{view.renderer.dispatchEvent(new CustomEvent("relocate",{detail:{reason:"snap"}}));view.dispatchEvent(new CustomEvent("relocate",{detail:{section:{current:0},range,cfi:"epubcfi(/6/2!/4:4)"}}));});
 expect(props.onPosition).toHaveBeenCalledExactlyOnceWith({paragraphId:"p",offset:4});
 const saved=localStorage.getItem(originalPositionKey("mobi:e-mobi"));expect(JSON.parse(saved!)).toMatchObject({originalHash:mobiIdentity,anchor:{paragraphId:"p",offset:4}});
 range.selectNodeContents(doc.querySelectorAll("p")[1]);
 await act(async()=>{view.renderer.dispatchEvent(new CustomEvent("relocate",{detail:{reason:"anchor"}}));view.dispatchEvent(new CustomEvent("relocate",{detail:{section:{current:0},range,cfi:"epubcfi(/6/2!/4:0)"}}));});
 expect(props.onPosition).toHaveBeenCalledOnce();expect(localStorage.getItem(originalPositionKey("mobi:e-mobi"))).toBe(saved);
});
it("MOBI后续标题复用真实paint及本地标注交互，不请求AI或改写正文",async()=>{
 const registry=new Map<string,{ranges:Range[]}>();
 class Highlight {ranges:Range[];constructor(...ranges:Range[]){this.ranges=ranges;}}
 Object.defineProperties(doc.defaultView!,{CSS:{configurable:true,value:{highlights:registry}},Highlight:{configurable:true,value:Highlight}});
 const book=assembleMobi();doc.body.innerHTML='<h1>章名</h1><p>世界😀原版文字</p><h2>第二段</h2>';
 const before=doc.body.innerHTML,node=doc.querySelector("h2")!.firstChild,onOpenAnnotation=vi.fn();
 await render({book,onOpenAnnotation,annotations:[{id:"mobi-note",paragraphId:"p2",startOffset:0,endOffset:2,textHash:"h",threadId:"manual-mark",summary:"MOBI本地笔记",concepts:[],createdAt:"now",kind:"note",markColor:"yellow"}]});
 expect(registry.get("judu-yellow")?.ranges.map(range=>range.toString())).toEqual(["第二"]);
 await act(async()=>doc.querySelector("h2")!.dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:20,clientY:30})));
 expect(document.body.textContent).toContain("MOBI本地笔记");expect(onOpenAnnotation).not.toHaveBeenCalled();
 expect(doc.querySelector("h2")!.firstChild).toBe(node);expect(doc.body.innerHTML).toBe(before);expect(fetch).toHaveBeenCalledOnce();
 await act(async()=>root.render(null));expect(registry.size).toBe(0);expect(original.destroy).toHaveBeenCalledOnce();
});
it.each(["http","loader"])("MOBI %s失败明确显示错误与回退按钮，不降级使用EPUB loader",async kind=>{
 vi.spyOn(console,"error").mockImplementation(()=>{});const book=assembleMobi();
 if(kind==="http")vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({error:"MOBI布局不存在"}),{status:404,headers:{"content-type":"application/json"}}));
 else mobiloader.loadMobiPublication.mockRejectedValueOnce(new Error("MOBI布局校验失败"));
 await render({book});expect(host.querySelector('[role="alert"]')?.textContent).toContain(kind==="http"?"MOBI布局不存在":"MOBI布局校验失败");
 expect([...host.querySelectorAll("nav button")].every(button=>(button as HTMLButtonElement).disabled)).toBe(true);
 expect(view.open).not.toHaveBeenCalled();expect(loader.createFoliateView).not.toHaveBeenCalled();expect(loader.loadEpub).not.toHaveBeenCalled();expect(fb2loader.loadFb2).not.toHaveBeenCalled();
 if(kind==="http")expect(mobiloader.loadMobiPublication).not.toHaveBeenCalled();
 const fallback=[...host.querySelectorAll("button")].find(button=>button.textContent==="切回精读")!;
 expect([...host.querySelectorAll("button")].some(button=>button.textContent==="重试原版")).toBe(true);
 await act(async()=>fallback.click());expect(props.onFallback).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledOnce();
});
it("MOBI重试仍走布局API和MOBI loader，成功后清除错误",async()=>{
 vi.spyOn(console,"error").mockImplementation(()=>{});mobiloader.loadMobiPublication.mockRejectedValueOnce(new Error("MOBI暂不可用"));
 await render({book:assembleMobi()});expect(host.querySelector('[role="alert"]')).not.toBeNull();
 const retry=[...host.querySelectorAll("button")].find(button=>button.textContent==="重试原版")!;await act(async()=>retry.click());
 expect(host.querySelector('[role="alert"]')).toBeNull();expect(view.open).toHaveBeenCalledOnce();expect(mobiloader.loadMobiPublication).toHaveBeenCalledTimes(2);
 expect(vi.mocked(fetch).mock.calls.map(call=>call[0])).toEqual(["/api/books/b/mobi-layout?editionId=e-mobi","/api/books/b/mobi-layout?editionId=e-mobi"]);expect(loader.loadEpub).not.toHaveBeenCalled();
});
it("MOBI延迟loaded在卸载后完成只释放资源，不发出过期warning或创建view",async()=>{
 let finish!:(value:{book:FoliateBook;warnings:string[]})=>void;
 mobiloader.loadMobiPublication.mockReturnValueOnce(new Promise<{book:FoliateBook;warnings:string[]}>(resolve=>{finish=resolve;}));
 await render({book:assembleMobi()});expect(mobiloader.loadMobiPublication).toHaveBeenCalledOnce();await act(async()=>root.render(null));
 const late={...original,destroy:vi.fn()};await act(async()=>finish({book:late,warnings:["过期提醒"]}));
 expect(late.destroy).toHaveBeenCalledOnce();expect(props.onNotice).not.toHaveBeenCalledWith("过期提醒");expect(loader.createFoliateView).not.toHaveBeenCalled();expect(host.childNodes).toHaveLength(0);
});
it("恢复CFI超时不能当作位置失效再次初始化同一view",async()=>{
 vi.spyOn(console,"error").mockImplementation(()=>{});vi.useFakeTimers();const cfi="epubcfi(/6/2!/4)",anchor={paragraphId:"p",offset:1};
 localStorage.setItem(originalPositionKey("e"),JSON.stringify({version:1,originalHash:"a".repeat(64),cfi,anchor}));
 vi.mocked(view.init).mockImplementationOnce(()=>new Promise(()=>{}));await render({anchor});
 expect(view.init).toHaveBeenCalledExactlyOnceWith({lastLocation:cfi,showTextStart:true});
 await act(async()=>{await vi.advanceTimersByTimeAsync(20000);});
 expect(host.querySelector('[role="alert"]')?.textContent).toContain("恢复原版位置");expect(view.init).toHaveBeenCalledOnce();
 expect(props.onNotice).not.toHaveBeenCalledWith(expect.stringContaining("位置已失效"));expect(view.close).toHaveBeenCalledOnce();
});
it("目录与翻页串行，前一导航失败超时后取消所有排队导航",async()=>{
 vi.spyOn(console,"error").mockImplementation(()=>{});vi.useFakeTimers();await render();
 vi.mocked(view.renderer.goTo).mockImplementationOnce(()=>new Promise(()=>{}));
 const select=host.querySelector('select')!;const next=[...host.querySelectorAll('button')].find(button=>button.textContent==="原版下一页")!;
 await act(async()=>{select.value="OEBPS/ch.xhtml";select.dispatchEvent(new Event("change",{bubbles:true}));next.click();});
 expect(view.renderer.goTo).toHaveBeenCalledOnce();expect(view.next).not.toHaveBeenCalled();
 await act(async()=>{await vi.advanceTimersByTimeAsync(20000);});expect(view.next).not.toHaveBeenCalled();
 expect(host.querySelector('[role="alert"]')?.textContent).toContain("跳转目录");expect(view.close).toHaveBeenCalledOnce();
});
it("正常导航连续点击时依次完成，不丢失用户翻页",async()=>{
 await render();const navigation=deferred<void>();vi.mocked(view.renderer.goTo).mockReturnValueOnce(navigation.promise);
 const select=host.querySelector('select')!;const next=[...host.querySelectorAll('button')].find(button=>button.textContent==="原版下一页")!;
 await act(async()=>{select.value="OEBPS/ch.xhtml";select.dispatchEvent(new Event("change",{bubbles:true}));next.click();});
 expect(view.next).not.toHaveBeenCalled();await act(async()=>navigation.resolve());expect(view.next).toHaveBeenCalledOnce();
});
it("合法CFI的文档加载异常不能误报位置失效或重入初始化",async()=>{
 vi.spyOn(console,"error").mockImplementation(()=>{});const cfi="epubcfi(/6/2!/4)",anchor={paragraphId:"p",offset:1};
 localStorage.setItem(originalPositionKey("e"),JSON.stringify({version:1,originalHash:"a".repeat(64),cfi,anchor}));
 vi.mocked(view.init).mockRejectedValueOnce(new Error("原版章节文档加载失败"));await render({anchor});
 expect(view.init).toHaveBeenCalledExactlyOnceWith({lastLocation:cfi,showTextStart:true});
 expect(host.querySelector('[role="alert"]')?.textContent).toContain("章节文档加载失败");
 expect(props.onNotice).not.toHaveBeenCalledWith(expect.stringContaining("位置已失效"));expect(view.close).toHaveBeenCalledOnce();
});
it("CFI章节有效但正文偏移越界时，清理坏记录并回退精读锚点",async()=>{
 vi.spyOn(console,"warn").mockImplementation(()=>{});const cfi="epubcfi(/6/2!/4/2/1:999)",anchor={paragraphId:"p",offset:1};
 const vendorPath="../../public/vendor/foliate/view.js";const {View:RealView}=await import(vendorPath) as {View:new()=>FoliateView};
 const real=new RealView();Object.assign(real,{book:original});vi.spyOn(view,"resolveCFI").mockImplementation(value=>real.resolveCFI(value));
 const target=real.resolveCFI(cfi);expect(target.index).toBe(0);expect(()=>target.anchor(doc)).toThrow();
 localStorage.setItem(originalPositionKey("e"),JSON.stringify({version:1,originalHash:"a".repeat(64),cfi,anchor}));
 const remove=vi.spyOn(Storage.prototype,"removeItem");await render({anchor});
 expect(view.init).toHaveBeenCalledExactlyOnceWith({showTextStart:true});expect(props.onNotice).toHaveBeenCalledWith("原版位置已失效，已回退到精读锚点。");
 expect(remove).toHaveBeenCalledWith(originalPositionKey("e"));expect(host.querySelector('[role="alert"]')).toBeNull();
 expect(view.renderer.goTo).toHaveBeenCalledOnce();expect(JSON.parse(localStorage.getItem(originalPositionKey("e"))!).cfi).not.toBe(cfi);
});
it.each(["reject","timeout"])("核验CFI文档%s不是位置失效，不得回退重入或删除有效记录",async kind=>{
 vi.spyOn(console,"error").mockImplementation(()=>{});vi.useFakeTimers();const cfi="epubcfi(/6/2!/4)",anchor={paragraphId:"p",offset:1};
 const stored=JSON.stringify({version:1,originalHash:"a".repeat(64),cfi,anchor});localStorage.setItem(originalPositionKey("e"),stored);
 original.sections[0].createDocument=vi.fn(()=>kind==="reject"?Promise.reject(new Error("章节文档损坏")):new Promise<Document>(()=>{}));
 await render({anchor});if(kind==="timeout")await act(async()=>{await vi.advanceTimersByTimeAsync(20000);});
 expect(view.init).not.toHaveBeenCalled();expect(view.close).toHaveBeenCalledOnce();expect(localStorage.getItem(originalPositionKey("e"))).toBe(stored);
 expect(props.onNotice).not.toHaveBeenCalledWith(expect.stringContaining("位置已失效"));
 expect(host.querySelector('[role="alert"]')?.textContent).toContain(kind==="reject"?"章节文档损坏":"核验原版位置");
});
it("CFI文档核验途中切书，迟到的坏位置不能清除记录或通知新会话",async()=>{
 const cfi="epubcfi(/6/2!/4)",anchor={paragraphId:"p",offset:1},body=deferred<Document>();
 const stored=JSON.stringify({version:1,originalHash:"a".repeat(64),cfi,anchor});localStorage.setItem(originalPositionKey("e"),stored);
 const nextView=makeView(),nextBook=makeBook("next"),nextSource=makeSourceBook("b-next","e-next");
 original.sections[0].createDocument=vi.fn(()=>body.promise);vi.spyOn(view,"resolveCFI").mockReturnValue({index:0,anchor:()=>{throw new Error("过期正文偏移");}});
 loader.loadEpub.mockResolvedValueOnce(original).mockResolvedValueOnce(nextBook);loader.createFoliateView.mockResolvedValueOnce(view).mockResolvedValueOnce(nextView);
 await render({anchor});expect(view.init).not.toHaveBeenCalled();await render({book:nextSource,anchor:null});await act(async()=>body.resolve(doc));
 expect(nextView.init).toHaveBeenCalledOnce();expect(props.onNotice).not.toHaveBeenCalledWith(expect.stringContaining("位置已失效"));
 expect(localStorage.getItem(originalPositionKey("e"))).toBe(stored);expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("真实有效CFI正文偏移通过预检，仍使用原位置而不回退",async()=>{
 const vendorPath="../../public/vendor/foliate/view.js";const {View:RealView}=await import(vendorPath) as {View:new()=>FoliateView};
 const real=new RealView();Object.assign(real,{book:original});vi.spyOn(view,"resolveCFI").mockImplementation(value=>real.resolveCFI(value));
 const cfi="epubcfi(/6/2!/4/2/1:1)",anchor={paragraphId:"p",offset:1};
 const range=real.resolveCFI(cfi).anchor(doc) as Range;expect(range.startOffset).toBe(1);expect(range.startContainer).toBe(doc.querySelector('p')!.firstChild);
 const stored=JSON.stringify({version:1,originalHash:"a".repeat(64),cfi,anchor});localStorage.setItem(originalPositionKey("e"),stored);
 await render({anchor});expect(view.init).toHaveBeenCalledExactlyOnceWith({lastLocation:cfi,showTextStart:true});
 expect(view.renderer.goTo).not.toHaveBeenCalled();expect(localStorage.getItem(originalPositionKey("e"))).toBe(stored);
 expect(props.onNotice).not.toHaveBeenCalledWith(expect.stringContaining("位置已失效"));expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("拖选过程中即使停顿也不弹菜单，iframe外释放后提交",async()=>{await render();Object.defineProperty(doc.createRange().constructor.prototype,'getBoundingClientRect',{configurable:true,value:()=>({left:10,top:60,width:30})});await act(async()=>{doc.body.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0}));const range=doc.createRange();range.selectNodeContents(doc.querySelector('p')!);doc.getSelection()!.removeAllRanges();doc.getSelection()!.addRange(range);doc.dispatchEvent(new Event('selectionchange'));await new Promise(resolve=>setTimeout(resolve,150));});expect(props.onSelect).not.toHaveBeenCalled();await act(async()=>document.dispatchEvent(new MouseEvent('pointerup',{button:0})));expect(props.onSelect).toHaveBeenCalledTimes(1);});
