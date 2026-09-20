// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach,describe,expect,it,vi } from "vitest";
import { originalEpubAvailable,originalReaderKind,ReaderModeSwitch,useReaderMode } from "./reader-mode";
import type { LibraryBookContent } from "@/lib/library";
const book:LibraryBookContent={id:'b',title:'书',author:'作者',editionId:'e',edition:{id:'e',fileName:'书.epub',fileType:'.epub',createdAt:'now',hasOriginalFile:true},chapters:[{id:'c',title:'正文',sourceHref:'OEBPS/c.xhtml',paragraphs:[]}]};
afterEach(()=>vi.unstubAllGlobals());
it('只有具有原件及资源映射的 EPUB 启用原版',()=>{expect(originalEpubAvailable(book)).toBe(true);expect(originalEpubAvailable({...book,edition:undefined})).toBe(false);expect(originalEpubAvailable({...book,edition:{...book.edition!,fileType:'.pdf'}})).toBe(false);});
it('旧版本回落精读，新版本默认原版，切换只影响当前版本',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div'),root=createRoot(host);
 function Harness({value}:{value:LibraryBookContent}){const state=useReaderMode(value);return <ReaderModeSwitch book={value} original={state.original} onChange={state.selectMode}/>;}
 await act(async()=>root.render(<Harness value={book}/>));expect(host.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
 await act(async()=>host.querySelectorAll('button')[1].click());expect(host.querySelector('button')?.getAttribute('aria-pressed')).toBe('false');
 await act(async()=>root.render(<Harness value={{...book,editionId:'other'}}/>));expect(host.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
 await act(async()=>root.render(<Harness value={{...book,edition:undefined}}/>));expect(host.querySelector('button')?.disabled).toBe(true);await act(async()=>root.unmount());
});

it('有原件的旧PDF和扫描PDF均可原版，缺原件不可伪造原版',()=>{const pdf={...book,edition:{...book.edition!,fileType:'.pdf'},chapters:[]};expect(originalReaderKind(pdf)).toBe('pdf');expect(originalReaderKind({...pdf,edition:{...pdf.edition,hasOriginalFile:false}})).toBeNull();expect(originalReaderKind({...pdf,edition:{...pdf.edition,fileType:'.mobi'}})).toBeNull();});

it.each(["fb2",".FB2","fbz",".FBZ","fb2.zip",".FB2.ZIP"])("%s只有原件与FB2来源同时存在才进入原版",format=>{
 const fb2={...book,edition:{...book.edition!,fileType:format},chapters:[{id:"fb",title:"FB2",sourceHref:"fb2-v1/section-0.xhtml",paragraphs:[]}]};
 expect(originalReaderKind(fb2)).toBe("fb2");expect(originalEpubAvailable(fb2)).toBe(false);
 expect(originalReaderKind({...fb2,edition:{...fb2.edition,hasOriginalFile:false}})).toBeNull();
 expect(originalReaderKind({...fb2,chapters:book.chapters})).toBeNull();expect(originalReaderKind({...fb2,editionId:undefined})).toBeNull();
});
it("FB2和FBZ版本间模式选择独立，纯图章也可原版但不冒充有文本",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);const host=document.createElement("div"),root=createRoot(host);
 const fb2={...book,editionId:"fb2-edition",edition:{...book.edition!,fileType:"fb2"},chapters:[{id:"image",title:"纯图",sourceHref:"fb2-v1/section-0.xhtml",paragraphs:[]}]};
 function Harness({value}:{value:LibraryBookContent}){const state=useReaderMode(value);return <ReaderModeSwitch book={value} original={state.original} onChange={state.selectMode}/>;}
 try{await act(async()=>root.render(<Harness value={fb2}/>));expect(host.querySelector("button")?.disabled).toBe(false);expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
  await act(async()=>host.querySelectorAll("button")[1].click());expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe("false");
  await act(async()=>root.render(<Harness value={{...fb2,editionId:"fbz-edition",edition:{...fb2.edition,fileType:"fbz"}}}/>));expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
 }finally{await act(async()=>root.unmount());}
});

describe("CBZ阅读模式门禁", () => {
  const cbzBook: LibraryBookContent = { ...book, editionId: "cbz-edition", edition: { ...book.edition!, id: "cbz-edition", fileType: "cbz", originalHash: "c".repeat(64) }, chapters: [{ id: "p1", title: "图页", sourceHref: "cbz-v1/1.png", paragraphs: [] }] };
  it("CBZ有原件和cbz来源时只能进入图片原版，精读按钮禁用并说明OCR未启用", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); const host = document.createElement("div"), root = createRoot(host);
    function Harness() { const state = useReaderMode(cbzBook); return <ReaderModeSwitch book={cbzBook} original={state.original} onChange={state.selectMode} />; }
    try { await act(async () => root.render(<Harness />)); const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")]; expect(originalReaderKind(cbzBook)).toBe("cbz"); expect(buttons[0].getAttribute("aria-pressed")).toBe("true"); expect(buttons[1].disabled).toBe(true); expect(buttons[1].title).toContain("OCR"); } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it("缺少原件、版本或cbz来源时不伪造CBZ原版", () => {
    expect(originalReaderKind({ ...cbzBook, edition: { ...cbzBook.edition!, hasOriginalFile: false } })).toBeNull(); expect(originalReaderKind({ ...cbzBook, editionId: undefined })).toBeNull(); expect(originalReaderKind({ ...cbzBook, chapters: [{ ...cbzBook.chapters[0], sourceHref: "fb2-v1/1.xhtml" }] })).not.toBe("cbz");
  });
});


it("UMD双份元数据和连续来源齐全才启用转换版，不能标为原版",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);const host=document.createElement('div'),root=createRoot(host);
 const umd:LibraryBookContent={...book,edition:{...book.edition!,fileType:'.umd',originalHash:'a'.repeat(64),conversion:{format:'.epub',sourceHash:'a'.repeat(64),fileHash:'b'.repeat(64),fileSize:100,converterVersion:'umd-epub-v1',createdAt:'now'}},chapters:[{id:'c',title:'章',sourceHref:'OPS/chapter-0001.xhtml',paragraphs:[{id:'p',text:'正文'}]}]};
 function Harness({value}:{value:LibraryBookContent}){const mode=useReaderMode(value);return <ReaderModeSwitch book={value} original={mode.original} onChange={mode.selectMode}/>;}
 try{
  expect(originalReaderKind(umd)).toBe('umd');expect(originalEpubAvailable(umd)).toBe(false);
  await act(async()=>root.render(<Harness value={umd}/>));const buttons=host.querySelectorAll('button');expect(buttons[0].textContent).toBe('转换版');expect(buttons[0].title).toContain('不代表原文件版式');expect(buttons[0].disabled).toBe(false);
  await act(async()=>buttons[1].click());expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
  await act(async()=>root.render(<Harness value={{...umd,edition:{...umd.edition!,conversion:undefined}}}/>));expect(host.querySelector('button')?.disabled).toBe(true);expect(host.querySelector('button')?.title).toContain('尚无已保存');expect(originalReaderKind({...umd,edition:{...umd.edition!,id:'wrong'}})).toBeNull();
 }finally{await act(async()=>root.unmount());}
});

describe("MOBI原版模式门禁",()=>{
 const mobi:LibraryBookContent={...book,editionId:"mobi-e1",edition:{...book.edition!,id:"mobi-e1",fileType:".mobi",fileName:"书.mobi",originalHash:"a".repeat(64)},
  chapters:[{id:"mobi-c",title:"正文",sourceHref:"mobi-v1/mobi/0",paragraphs:[{id:"mobi-p",text:"可精读正文"}]}]};
 it.each(["mobi","kf8"])("MOBI原件和%s来源齐全才提供原版，不冒充EPUB容器",kind=>{
  const value={...mobi,chapters:[{...mobi.chapters[0],sourceHref:`mobi-v1/${kind}/0`}]};
  expect(originalReaderKind(value)).toBe("mobi");expect(originalEpubAvailable(value)).toBe(false);
 });
 const unavailable:[string,(value:LibraryBookContent)=>LibraryBookContent][]=[
  ["无版本",value=>({...value,editionId:undefined})],
  ["无版本元数据",value=>({...value,edition:undefined})],
  ["无原件",value=>({...value,edition:{...value.edition!,hasOriginalFile:false}})],
  ["无章节",value=>({...value,chapters:[]})],
  ["无来源",value=>({...value,chapters:[{...value.chapters[0],sourceHref:undefined}]})],
  ["EPUB来源",value=>({...value,chapters:[{...value.chapters[0],sourceHref:"OEBPS/0.xhtml"}]})],
  ["FB2来源",value=>({...value,chapters:[{...value.chapters[0],sourceHref:"fb2-v1/section-0.xhtml"}]})],
 ];
 it.each(unavailable)("MOBI%s时仍可精读，但禁用原版并明确说明",async(_label,transform)=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);const host=document.createElement("div"),root=createRoot(host),value=transform(mobi);
  function Harness(){const state=useReaderMode(value);return <ReaderModeSwitch book={value} original={state.original} onChange={state.selectMode}/>;}
  try{
   expect(originalReaderKind(value)).toBeNull();expect(originalEpubAvailable(value)).toBe(false);
   await act(async()=>root.render(<Harness/>));const [original,text]=host.querySelectorAll("button");
   expect(original.disabled).toBe(true);expect(original.getAttribute("aria-pressed")).toBe("false");expect(original.title).toContain("没有可用原文件");
   expect(text.disabled).toBe(false);expect(text.getAttribute("aria-pressed")).toBe("true");
  }finally{await act(async()=>root.unmount());}
 });
 it("MOBI默认原版且可切精读，选择按版本隔离，禁用时不触发切换",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);const host=document.createElement("div"),root=createRoot(host),onChange=vi.fn();
  function Harness({value,disabled=false}:{value:LibraryBookContent;disabled?:boolean}){
   const state=useReaderMode(value);
   return <ReaderModeSwitch book={value} original={state.original} disabled={disabled} onChange={mode=>{onChange(mode);state.selectMode(mode);}}/>;
  }
  try{
   await act(async()=>root.render(<Harness value={mobi}/>));let [original,text]=host.querySelectorAll("button");
   expect(original.textContent).toBe("原版");expect(original.disabled).toBe(false);expect(original.getAttribute("aria-pressed")).toBe("true");expect(text.disabled).toBe(false);
   expect(original.title).toContain("保留原文件");expect(host.textContent).not.toContain("转换版");
   await act(async()=>text.click());expect(onChange).toHaveBeenCalledWith("text");expect(original.getAttribute("aria-pressed")).toBe("false");
   const next={...mobi,editionId:"mobi-e2",edition:{...mobi.edition!,id:"mobi-e2"}};
   await act(async()=>root.render(<Harness value={next}/>));expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
   await act(async()=>root.render(<Harness value={mobi}/>));expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe("false");
   // WHY：保留用户各版本的精读选择；繁忙状态不能借原版按钮触发新的加载会话。
   onChange.mockClear();await act(async()=>root.render(<Harness value={mobi} disabled/>));[original,text]=host.querySelectorAll("button");
   expect(original.disabled).toBe(true);expect(text.disabled).toBe(true);await act(async()=>{original.click();text.click();});expect(onChange).not.toHaveBeenCalled();
  }finally{await act(async()=>root.unmount());}
 });
});
