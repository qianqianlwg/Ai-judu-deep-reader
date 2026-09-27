// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {KnowledgeLibrary} from "./knowledge-library";
let host:HTMLDivElement,root:Root,fetcher:ReturnType<typeof vi.fn>;
const source={bookId:"b",editionId:"e",bookTitle:"阅读测试",author:"作者",fileName:"book.txt",fileType:".txt",createdAt:"2026-09-26",paragraphCount:100};
const item=(id:string)=>({id,kind:"excerpt",origin:"user",title:"我的笔记",body:"内容"+id,quote:"原文",createdAt:"2026-09-26",source,chapterTitle:"第一章",anchor:null,locationReason:"来源待核对",concepts:[],conversation:null});
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host);fetcher=vi.fn(async(input:RequestInfo|URL)=>{const params=new URL(String(input),"http://localhost").searchParams,offset=Number(params.get("offset")??0),all=params.get("scope")==="all";return Response.json({version:1,scope:all?"all":"current",editionId:all?null:"e",query:params.get("q")??"",items:[item("item:"+offset)],counts:{source:0,excerpt:2,understanding:0,passage:0},total:2,offset,limit:60,warnings:[]});});vi.stubGlobal("fetch",fetcher);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it("检索常驻，资料按来源标记，分页追加而不是藏起后续材料",async()=>{
 await act(async()=>root.render(<KnowledgeLibrary editionId="e" onReturnReading={vi.fn()}/>));
 expect(host.querySelector('input[type="search"]')).not.toBeNull();expect(host.querySelectorAll('[data-material-kind="excerpt"]')).toHaveLength(1);
 await act(async()=>host.querySelector<HTMLButtonElement>('.knowledge-library-more')?.click());
 expect(host.querySelectorAll('[data-material-kind="excerpt"]')).toHaveLength(2);expect(host.querySelector('.knowledge-library-more')).toBeNull();
 await act(async()=>host.querySelector<HTMLButtonElement>('.knowledge-library-scope button:nth-child(2)')?.click());
 expect(fetcher.mock.calls.some(([url])=>String(url).includes("scope=all"))).toBe(true);
});
