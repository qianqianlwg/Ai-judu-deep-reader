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

