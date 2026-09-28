// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeWorkspace } from "./knowledge-workspace";
const anchor={editionId:"e",chapterId:"c",paragraphId:"p",startOffset:0,endOffset:2,selectedText:"承认"};
const response={version:1 as const,scope:"current" as const,editionId:"e",query:"",items:[
 {id:"excerpt:m",kind:"excerpt" as const,origin:"user" as const,title:"我的笔记",body:"需要反复思考",quote:"承认",createdAt:"2026-09-14T00:00:00Z",source:{bookId:"b",editionId:"e",bookTitle:"测试书",author:"作者",fileName:"book.txt",fileType:".txt",createdAt:"2026-09-14T00:00:00Z",paragraphCount:1},chapterTitle:"第一章",anchor,locationReason:null,concepts:[],conversation:null},
 {id:"understanding:m",kind:"understanding" as const,origin:"ai" as const,title:"句读总结",body:"AI 对这段文字的解释",quote:"承认",createdAt:"2026-09-13T00:00:00Z",source:{bookId:"b",editionId:"e",bookTitle:"测试书",author:"作者",fileName:"book.txt",fileType:".txt",createdAt:"2026-09-14T00:00:00Z",paragraphCount:1},chapterTitle:"第一章",anchor,locationReason:null,concepts:[{name:"承认",text:"互相确认"}],conversation:{threadId:"t",messageId:"m"}}
],counts:{source:1,excerpt:1,understanding:1,passage:0},total:2,offset:0,limit:60,warnings:[]};
let root:Root;let host:HTMLDivElement;let fetcher:ReturnType<typeof vi.fn>;const onReturn=vi.fn(),onSource=vi.fn(),onConversation=vi.fn();
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.clearAllMocks();fetcher=vi.fn(async(input)=>{const url=String(input);const all=url.includes("scope=all");const excerpt=url.includes("kind=excerpt");return Response.json({...response,scope:all?"all":"current",editionId:all?null:"e",items:excerpt?response.items.filter(item=>item.kind==="excerpt"):response.items});});vi.stubGlobal("fetch",fetcher);host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function mount(){await act(async()=>root.render(<KnowledgeWorkspace editionId="e" bookTitle="测试书" onReturnReading={onReturn} onOpenSource={onSource} onOpenConversation={onConversation}/>));}
describe("KnowledgeWorkspace",()=>{
 it("用统一检索和材料卡承载原书、摘录与AI句读",async()=>{await mount();expect(host.querySelector('[aria-label="知识库工作区"]')).not.toBeNull();expect(host.querySelector('[role="tablist"]')).toBeNull();expect(host.querySelector('input[type="search"]')?.getAttribute("placeholder")).toContain("正文");expect(host.textContent).toContain("我的笔记");expect(host.textContent).toContain("句读总结");act(()=>host.querySelector<HTMLButtonElement>('button[aria-label="打开原文"]')?.click());expect(onSource).toHaveBeenCalledWith(anchor);act(()=>host.querySelector<HTMLButtonElement>('button[aria-label="打开句读"]')?.click());expect(onConversation).toHaveBeenCalledWith("t","m");});
 it("切换全部书籍和材料类型时使用统一接口参数",async()=>{await mount();await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')?.click());expect(fetcher.mock.calls.some(([input])=>String(input).includes("scope=all"))).toBe(true);const filter=[...host.querySelectorAll<HTMLButtonElement>('.knowledge-library-filters button')].find(button=>button.textContent?.startsWith("我的摘录"));expect(filter).toBeTruthy();await act(async()=>filter?.click());expect(fetcher.mock.calls.some(([input])=>String(input).includes("kind=excerpt"))).toBe(true);});
});
