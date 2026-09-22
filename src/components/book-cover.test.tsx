// @vitest-environment jsdom
import {act} from "react";import {createRoot} from "react-dom/client";import {it,expect,vi} from "vitest";
import {BookCover} from "./book-cover";
it("按版本请求同源懒加载封面，失败保留标题兜底",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);const log=vi.spyOn(console,"warn").mockImplementation(()=>{});const host=document.createElement("div"),root=createRoot(host);
 try{await act(async()=>root.render(<BookCover book={{id:"a",title:"测试标题",author:"",editions:[{id:"v",fileName:"a.pdf",fileType:".pdf",hasOriginalFile:true,createdAt:"2026"}]}}/>));const image=host.querySelector("img")!;expect(image.getAttribute("src")).toBe("/api/books/a/cover?editionId=v");expect(image.getAttribute("loading")).toBe("lazy");act(()=>image.dispatchEvent(new Event("error")));expect(host.querySelector("img")).toBeNull();expect(host.textContent).toContain("测试标题");expect(host.textContent).toContain("文字封面");}
 finally{act(()=>root.unmount());log.mockRestore();vi.unstubAllGlobals();}
});
