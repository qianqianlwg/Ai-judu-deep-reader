// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bookshelf, type BookshelfProps } from "./bookshelf";
let root: Root; let host: HTMLDivElement;
const onOpen = vi.fn(), onImport = vi.fn(), onRefresh = vi.fn();
const props: BookshelfProps = { books: [{ id: "a", title: "精神现象学", author: "黑格尔" }, { id: "b", title: "国富论", author: "斯密" }], currentBookId: "a", onOpenBook: onOpen, onImport, onRefresh };
async function render(patch: Partial<BookshelfProps> = {}) { await act(async () => root.render(<Bookshelf {...props} {...patch} />)); }
function click(selector: string) { act(() => host.querySelector<HTMLButtonElement>(selector)?.click()); }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); localStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); vi.unstubAllGlobals(); });
describe("Bookshelf", () => {
  it("真实书卡可阅读，当前书提供继续阅读入口", async () => {
    await render(); expect(host.querySelectorAll("[data-book-id]")).toHaveLength(2);
    expect(host.querySelector('[data-book-id="a"]')?.textContent).toContain("继续阅读");
    click('[data-book-id="b"] button'); expect(onOpen).toHaveBeenCalledWith("b");
  });
  it("按书名/作者实际筛选，不修改书架数据", async () => {
    await render(); const input = host.querySelector("input")!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "黑格尔"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(host.querySelectorAll("[data-book-id]")).toHaveLength(1); expect(host.querySelector('[data-book-id="a"]')).not.toBeNull();
  });
  it("空书架提供导入入口，错误有刷新恢复路径", async () => {
    await render({ books: [] }); expect(host.textContent).toContain("从一本书开始");
    click(".workspace-empty button"); expect(onImport).toHaveBeenCalledOnce();
    await render({ books: [], error: "读取失败" }); expect(host.querySelector('[role="alert"]')?.textContent).toContain("读取失败");
    click('[role="alert"] button'); expect(onRefresh).toHaveBeenCalledOnce();
  });
  it("运行中书卡及导入不能绕过保护", async () => {
    await render({ busy: true }); click(".bookshelf-open"); click(".workspace-heading button");
    expect(onOpen).not.toHaveBeenCalled(); expect(onImport).not.toHaveBeenCalled();
  });
});


describe("书架全部版本入口", () => {
  it("同名BookID分别展示，每个版本按钮提交准确BookID和EditionID", async () => {
    const editions = [{ id: "new", fileName: "新版.epub", fileType: "epub", createdAt: "2026-01-01" }, { id: "old", fileName: "旧版.pdf", fileType: "pdf", createdAt: "2025-01-01" }];
    await render({ books: [{ id: "a", title: "同名书", author: "作者", editions }, { id: "b", title: "同名书", author: "作者", editions: [{ ...editions[0], id: "b-edition" }] }], currentEditionId: "old" });
    expect(host.querySelectorAll(".bookshelf-card")).toHaveLength(2); expect(host.querySelectorAll("[data-edition-id]")).toHaveLength(3);
    const old = host.querySelector<HTMLButtonElement>('[data-book-id="a"] [data-edition-id="old"]')!;
    expect(old.textContent).toContain("旧版.pdf"); expect(old.textContent).toContain("2025"); expect(old.getAttribute("aria-current")).toBe("true");
    act(() => old.click()); expect(onOpen).toHaveBeenCalledWith("a", "old");
    act(() => host.querySelector<HTMLButtonElement>('[data-book-id="b"] [data-edition-id="b-edition"]')?.click()); expect(onOpen).toHaveBeenCalledWith("b", "b-edition");
  });
});

it("书卡新增下架按钮且不触发阅读，忙碌状态禁用",async()=>{await render();const action=host.querySelector<HTMLButtonElement>('button[aria-label="下架《精神现象学》"]')!;expect(action).not.toBeNull();act(()=>action.click());expect(onOpen).not.toHaveBeenCalled();expect(host.querySelector('[aria-label="确认下架《精神现象学》"]')).not.toBeNull();await render({busy:true});expect(Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='确认下架')?.disabled).toBe(true);});

it("每本读过的书都显示继续阅读，点击非当前书恢复其旧版，新书仍显示打开",async()=>{localStorage.setItem('judu:edition:a','old-a');localStorage.setItem('judu:edition:b','v-b');const edition=(id:string)=>({id,fileName:id+'.epub',fileType:'.epub',createdAt:'2026-09-21'});await act(async()=>render({currentBookId:'b',books:[{id:'a',title:'甲书',author:'',editions:[edition('new-a'),edition('old-a')]},{id:'b',title:'乙书',author:'',editions:[edition('v-b')]},{id:'c',title:'新书',author:'',editions:[edition('v-c')]}]}));expect(host.querySelector('[data-book-id="a"] .bookshelf-read-action')?.textContent).toContain('继续阅读');expect(host.querySelector('[data-book-id="b"] .bookshelf-read-action')?.textContent).toContain('继续阅读');expect(host.querySelector('[data-book-id="c"] .bookshelf-read-action')?.textContent).toContain('打开阅读');expect(host.querySelector('[data-book-id="a"] .bookshelf-resume-edition')?.textContent).toContain('old-a.epub');click('[data-book-id="a"] .bookshelf-open');expect(onOpen).toHaveBeenCalledWith('a','old-a');});

it("格式、阅读状态与列表组合筛选可清空，书架不丢原始记录",async()=>{
 const edition=(id:string,type:string)=>({id,fileName:id+type,fileType:type,createdAt:"2026-09-22"});
 localStorage.setItem("judu:edition:a","a-pdf");
 await render({books:[{id:"a",title:"甲",author:"",editions:[edition("a-pdf",".pdf")]},{id:"b",title:"乙",author:"",editions:[edition("b-epub",".epub")]}]});
 const select=(label:string,value:string)=>act(()=>{const field=host.querySelector<HTMLSelectElement>('select[aria-label="'+label+'"]')!;field.value=value;field.dispatchEvent(new Event("change",{bubbles:true}));});
 select("文件格式","EPUB");expect(host.querySelectorAll(".bookshelf-card")).toHaveLength(1);select("阅读状态","reading");expect(host.textContent).toContain("没有找到这本书");click(".workspace-empty button");expect(host.querySelectorAll(".bookshelf-card")).toHaveLength(2);
 const list=Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="列表")!;act(()=>list.click());expect(host.querySelector(".bookshelf-list")).not.toBeNull();expect(list.getAttribute("aria-pressed")).toBe("true");
});
it("最近阅读展示真实章节并回到相同版本，显示名也可搜索",async()=>{
 localStorage.setItem("judu:edition:a","old");localStorage.setItem("judu:resume-meta:a",JSON.stringify({editionId:"old",updatedAt:1234567890000,location:"第三章"}));
 await render({books:[{id:"a",title:"原始长文件名",displayTitle:"简洁书名",author:"",editions:[{id:"old",fileName:"原文件.pdf",fileType:".pdf",createdAt:"2026"}]}]});
 expect(host.querySelector('[aria-label="最近阅读"]')?.textContent).toContain("第三章");click('[aria-label="最近阅读"] button');expect(onOpen).toHaveBeenCalledWith("a","old");expect(host.querySelector(".bookshelf-card-copy strong")?.textContent).toBe("简洁书名");
});
