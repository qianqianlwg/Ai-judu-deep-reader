// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {useBookSemanticSearch} from "./use-book-semantic-search";
let root:Root,host:HTMLDivElement,fetcher:ReturnType<typeof vi.fn>;
const onNotice=vi.fn();
function Probe({editionId}:{editionId:string}){const props=useBookSemanticSearch(editionId,onNotice);return <><button type="button" onClick={()=>props.onQuery("承认")}>输入查询</button><button type="button" onClick={props.onSearch}>提交查询</button><span data-count>{props.results.length}</span></>;}
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host);fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).startsWith("/api/search/status")?Response.json({backend:"sqlite",editionId:"e1",paragraphCount:1,indexedCount:1,vectorIndexed:true,note:""}):Response.json({results:[{paragraphId:"p",chapterId:"c",chapterTitle:"章",excerpt:"原文"}]}));vi.stubGlobal("fetch",fetcher);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it("本书高级检索结果按版本隔离，切书后不带入旧结果",async()=>{
 await act(async()=>root.render(<Probe editionId="e1"/>));
 await act(async()=>host.querySelector<HTMLButtonElement>("button:first-child")!.click());
 await act(async()=>host.querySelector<HTMLButtonElement>("button:nth-child(2)")!.click());
 expect(host.querySelector("[data-count]")?.textContent).toBe("1");
 await act(async()=>root.render(<Probe editionId="e2"/>));expect(host.querySelector("[data-count]")?.textContent).toBe("0");
});
