// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReaderBookSearch } from "./reader-book-search";
import type { SearchParagraph } from "@/lib/book-search";
let host: HTMLDivElement, root: Root;
const openResult=vi.fn();
const paragraphs:SearchParagraph[]=[{id:"a",chapterId:"c1",chapterTitle:"第一章",paragraphIndex:0,text:"当前章节正文"},{id:"b",chapterId:"c2",chapterTitle:"第二章",paragraphIndex:1,text:"后面章节包含 Needle 原文😀"}];
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true); host=document.createElement("div"); document.body.append(host); root=createRoot(host); openResult.mockReset(); });
afterEach(async () => { await act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(data=paragraphs,disabled=false,key="e1") { await act(() => root.render(<ReaderBookSearch key={key} paragraphs={data} disabled={disabled} onResult={openResult}/>)); }
async function open() { await act(() => host.querySelector<HTMLButtonElement>("button")!.click()); }
async function search(value:string) { await act(() => { const input=host.querySelector("input")!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value); input.dispatchEvent(new Event("input",{bubbles:true})); }); await act(() => host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))); }
it("从阅读工具栏搜索后续章节，展示逐字原文、高亮和精确位置",async () => { await render(); await open(); expect(document.activeElement).toBe(host.querySelector("input")); await search("needle"); expect(host.textContent).toContain("找到 1 段匹配原文"); expect(host.querySelector("mark")?.textContent).toBe("Needle"); await act(() => host.querySelector<HTMLButtonElement>('button small')!.parentElement!.click()); expect(openResult).toHaveBeenCalledWith(expect.objectContaining({paragraphId:"b",chapterId:"c2",startOffset:7,matchedText:"Needle"})); expect(host.querySelector("section")).toBeNull(); expect(document.activeElement).toBe(host.querySelector("button")); });
it("无结果、空关键词、图片书均有明确状态",async () => { await render(); await open(); expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true); await search("不存在"); expect(host.textContent).toContain("未找到匹配内容"); await render([],false,"image"); await open(); expect(host.textContent).toContain("没有可搜索的文字层"); expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true); });
it("全书结果不被前20段截断，分批展示并支持继续加载",async () => { await render(Array.from({length:65},(_,i)=>({...paragraphs[0],id:String(i),text:"共同关键词"}))); await open(); await search("关键词"); expect(host.textContent).toContain("找到 65 段"); expect(host.querySelectorAll("mark")).toHaveLength(30); await act(() => Array.from(host.querySelectorAll("button")).find(button=>button.textContent?.startsWith("显示更多"))!.click()); expect(host.querySelectorAll("mark")).toHaveLength(60); });
it("切书清除旧结果，Escape关闭并把焦点还给入口",async () => { await render(); await open(); await search("needle"); await act(() => host.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))); expect(host.querySelector("section")).toBeNull(); await render([paragraphs[0]],false,"e2"); await open(); expect(host.querySelector("mark")).toBeNull(); expect(host.querySelector("input")!.value).toBe(""); });
it("切书加载期间结果不可点击",async () => { await render(); await open(); await search("needle"); await render(paragraphs,true); expect(host.querySelector<HTMLButtonElement>('button small')!.parentElement).toHaveProperty("disabled",true); });
