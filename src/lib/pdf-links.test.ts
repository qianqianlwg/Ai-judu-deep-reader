// @vitest-environment jsdom
import{expect,it,vi}from'vitest';import{createPdfLinkService}from'./pdf-links';import type{PDFDocumentProxy}from'pdfjs-dist/types/src/display/api';
it('PDF引用只导航有效页，外部链接不自动访问，失效会话不跳转',async()=>{const go=vi.fn(),notice=vi.fn();let active=true;const doc={numPages:4,getDestination:vi.fn(async()=>[{num:5,gen:0}]),getPageIndex:vi.fn(async()=>2)}as unknown as PDFDocumentProxy;const links=createPdfLinkService(doc,{getPage:()=>1,goToPage:go,onNotice:notice,isActive:()=>active});await links.goToDestination('chapter');expect(go).toHaveBeenLastCalledWith(3);links.goToPage(0);expect(notice).toHaveBeenCalled();active=false;await links.goToDestination('chapter');expect(go).toHaveBeenCalledTimes(1);expect(links.externalLinkEnabled).toBe(false);});


import { afterEach, beforeEach, describe } from "vitest";
import { resolvePdfDestinationPage } from "./pdf-links";
function fixture() {
  const api = { numPages: 4, getDestination: vi.fn<(name: string) => Promise<unknown>>().mockResolvedValue([2, { name: "Fit" }]), getPageIndex: vi.fn<(ref: { num: number; gen: number }) => Promise<number>>().mockResolvedValue(2) };
  let active = true;
  const go = vi.fn(), notice = vi.fn(), doc = api as unknown as PDFDocumentProxy;
  return { api, doc, go, notice, setActive: (next: boolean) => { active = next; }, links: createPdfLinkService(doc, { getPage: () => 2, goToPage: go, onNotice: notice, isActive: () => active }) };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("引用单测禁止网络"); })); vi.spyOn(window, "open").mockImplementation(() => null); });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("PDF destination共用解析器", () => {
  it.each([0, 3])("直接0基页index %s映射到1基页号", async index => {
    const f = fixture(); expect(await resolvePdfDestinationPage(f.doc, [index, { name: "Fit" }])).toBe(index + 1);
    expect(f.api.getDestination).not.toHaveBeenCalled(); expect(f.api.getPageIndex).not.toHaveBeenCalled();
  });
  it("命名目标只解析一次，间接页对象原样核验后使用", async () => {
    const f = fixture(); f.api.getDestination.mockResolvedValue([{ num: 9, gen: 2 }, { name: "XYZ" }, 1, 2, null]);
    expect(await resolvePdfDestinationPage(f.doc, "章节/一%20")).toBe(3);
    expect(f.api.getDestination).toHaveBeenCalledExactlyOnceWith("章节/一%20"); expect(f.api.getPageIndex).toHaveBeenCalledExactlyOnceWith({ num: 9, gen: 2 });
  });
  it.each([undefined, null, true, {}, [], [null], ["2"], [{ num: "2", gen: 0 }], [{ num: 2 }], [{ gen: 0 }], [-1], [0.5], [Number.NaN], [Infinity], [4], [Number.MAX_SAFE_INTEGER]].map(value => ({ value })))("损坏目标 $value 拒绝，不交给间接索引API", async ({ value }) => {
    const f = fixture(); await expect(resolvePdfDestinationPage(f.doc, value)).rejects.toThrow(/PDF引用目标/); expect(f.api.getPageIndex).not.toHaveBeenCalled();
  });
  it.each([
    { num: -1, gen: 0 }, { num: 0, gen: 0 }, { num: 1.5, gen: 0 }, { num: Number.NaN, gen: 0 }, { num: Infinity, gen: 0 }, { num: Number.MAX_SAFE_INTEGER + 1, gen: 0 },
    { num: 2, gen: -1 }, { num: 2, gen: 0.5 }, { num: 2, gen: Number.NaN }, { num: 2, gen: Infinity }, { num: 2, gen: Number.MAX_SAFE_INTEGER + 1 },
  ])("非法间接对象num=$num gen=$gen在请求PDF API前拒绝", async ref => {
    const f = fixture(); await expect(resolvePdfDestinationPage(f.doc, [ref, { name: "Fit" }])).rejects.toThrow(/PDF引用目标/); expect(f.api.getPageIndex).not.toHaveBeenCalled();
  });
  it.each([-1, 0.5, Number.NaN, Infinity, 4])("间接索引API返回非法结果%s也拒绝", async index => {
    const f = fixture(); f.api.getPageIndex.mockResolvedValue(index);
    await expect(resolvePdfDestinationPage(f.doc, [{ num: 7, gen: 0 }])).rejects.toThrow(/有效页号/);
  });
  it.each(["named", "indirect"])("%s异步失败保留原错误，不默认跳到第一页", async stage => {
    const f = fixture(), error = new Error("合成解析失败");
    if (stage === "named") f.api.getDestination.mockRejectedValue(error); else f.api.getPageIndex.mockRejectedValue(error);
    await expect(resolvePdfDestinationPage(f.doc, stage === "named" ? "broken" : [{ num: 7, gen: 0 }])).rejects.toBe(error);
  });
});

describe("PDF link service 编码、导航和迟到响应", () => {
  it.each(['中文/章节"%23', [0, { name: "XYZ" }, 10, null, 2], [{ num: 7, gen: 0 }, { name: "Fit" }]].map(value => ({ value })))("目标 $value 仅JSON编码，不直接放入URL或执行", ({ value }) => {
    const f = fixture(), hash = f.links.getDestinationHash(value);
    expect(hash.startsWith("#judu-dest=")).toBe(true); expect(JSON.parse(decodeURIComponent(hash.slice("#judu-dest=".length)))).toEqual(value); expect(hash).not.toContain('"');
    expect(f.links.getAnchorUrl(hash)).toBe(hash); expect(fetch).not.toHaveBeenCalled();
  });
  it("合法目标与页属性通过校验后导航，旋转设置不改页号", async () => {
    const f = fixture(); await f.links.goToDestination([3, { name: "Fit" }]); expect(f.go).toHaveBeenLastCalledWith(4);
    f.links.page = 1; expect(f.go).toHaveBeenLastCalledWith(1); expect(f.links.pagesCount).toBe(4); expect(f.links.page).toBe(2);
    f.links.rotation = 90; expect(f.links.rotation).toBe(90); expect(f.go).toHaveBeenCalledTimes(2);
  });
  it.each([0, -1, 1.5, Number.NaN, Infinity, 5, "bad", "0", "1.5"])("无效goToPage参数%s只提示，不导航", value => {
    const f = fixture(); f.links.goToPage(value); expect(f.go).not.toHaveBeenCalled(); expect(f.notice).toHaveBeenCalledWith("PDF目标页码无效");
  });
  it("setHash仅接受有效page，不把自定义hash当脚本执行", () => {
    const f = fixture(); f.links.setHash("#page=3"); expect(f.go).toHaveBeenLastCalledWith(3);
    f.links.setHash("#page=-2"); expect(f.go).toHaveBeenCalledTimes(1); expect(f.notice).toHaveBeenCalled();
    f.links.setHash("javascript:alert(1)"); expect(f.go).toHaveBeenCalledTimes(1); expect(window.open).not.toHaveBeenCalled();
  });
  it("命名目标失败记录并提示，未知动作和图层切换不执行脚本", async () => {
    const f = fixture(), error = new Error("合成缺失目标"); f.api.getDestination.mockRejectedValue(error);
    await f.links.goToDestination("missing"); expect(console.warn).toHaveBeenCalledWith("PDF引用跳转失败", error); expect(f.notice).toHaveBeenCalledWith("PDF引用无法定位，请使用页码导航。");
    f.links.executeNamedAction("JavaScript"); f.links.executeSetOCGState({ state: ["ON"], preserveRB: true });
    expect(f.go).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
  });
  it.each(["named", "indirect"])("%s解析待定期间切书，不允许迟到导航", async stage => {
    const f = fixture(), pending = deferred<number>(), named = deferred<unknown>();
    if (stage === "named") f.api.getDestination.mockReturnValue(named.promise); else f.api.getPageIndex.mockReturnValue(pending.promise);
    const request = f.links.goToDestination(stage === "named" ? "target" : [{ num: 7, gen: 0 }]);
    f.setActive(false); if (stage === "named") named.resolve([1]); else pending.resolve(1); await request;
    expect(f.go).not.toHaveBeenCalled(); expect(f.notice).not.toHaveBeenCalled();
  });
  it("失效后的异步错误可记录但不污染新书通知", async () => {
    const f = fixture(), pending = deferred<unknown>(); f.api.getDestination.mockReturnValue(pending.promise);
    const request = f.links.goToDestination("target"); f.setActive(false); pending.reject(new Error("旧书解析失败")); await request;
    expect(f.go).not.toHaveBeenCalled(); expect(f.notice).not.toHaveBeenCalled(); expect(console.warn).toHaveBeenCalled();
  });
  it("已失效会话的普通页导航不产生跳转或新通知", () => {
    const f = fixture(); f.setActive(false); f.links.goToPage(2); f.links.goToPage(-1); f.links.page = 3;
    expect(f.go).not.toHaveBeenCalled(); expect(f.notice).not.toHaveBeenCalled();
  });
  it.each(["https://example.invalid/?secret=x", "javascript:globalThis.__pdfExecuted=1", "data:text/html,<script>alert(1)</script>", 'file:///C:/private', '<img src=x onerror="alert(1)">'])("外部URL %s只有dataset和文本提示，click被取消", url => {
    const f = fixture(), link = document.createElement("a"); document.body.append(link); f.links.addLinkAttributes(link, url, true);
    vi.stubGlobal("__pdfExecuted", 0);
    expect(link.getAttribute("href")).toBe("#"); expect(link.dataset.pdfExternalUrl).toBe(url); expect(link.title).toBe(url); expect(link.rel).toBe("noopener noreferrer"); expect(link.children).toHaveLength(0);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true }); expect(link.dispatchEvent(event)).toBe(false); expect(event.defaultPrevented).toBe(true);
    expect(f.notice).toHaveBeenCalledWith("为保护本地书库，PDF外部链接不会自动打开：" + url); expect(fetch).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
    expect(Reflect.get(globalThis, "__pdfExecuted")).toBe(0); expect(f.go).not.toHaveBeenCalled();
  });
});

import { indexPdfPages } from "./pdf-loader";
import { previewPdfReference } from "./pdf-reference-preview";
import type { PdfTextPage } from "./pdf-source-map";
function loadedPage(pageNumber: number, num = 34, gen = 0): PdfTextPage {
  return { pageNumber, reference: { num, gen }, width: 600, height: 800, rotation: 0, mapped: false, runs: [],
    items: [{ str: "合成本地页" + pageNumber, transform: [1, 0, 0, 1, 0, 0], width: 100, height: 12 }] };
}
const brokenPageTree = () => new Error("Kid reference not found in parent's kids");
// WHY：以下ref均为合成场景，只凭本次传入的已加载页精确反查；不是用户论文对象34可恢复的证据，不使用文字匹配或额外加载。
describe("PDF坏页树的本会话唯一对象引用回归", () => {
  it("唯一精确命中使用pageNumber而非数组位置，不调用会失败的getPageIndex", async () => {
    const f = fixture(); f.api.getPageIndex.mockRejectedValue(brokenPageTree());
    const pages = [loadedPage(4), loadedPage(1, 10)], before = JSON.stringify(pages);
    expect(await resolvePdfDestinationPage(f.doc, [{ num: 34, gen: 0 }, { name: "Fit" }], pages)).toBe(4);
    expect(f.api.getPageIndex).not.toHaveBeenCalled(); expect(f.api.getDestination).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(JSON.stringify(pages)).toBe(before);
  });
  it("命名目录先解析目标，再通过同会话ref反查，不因坏页树失败", async () => {
    const f = fixture(); f.api.getDestination.mockResolvedValue([{ num: 34, gen: 0 }, { name: "XYZ" }, null, null, null]); f.api.getPageIndex.mockRejectedValue(brokenPageTree());
    expect(await resolvePdfDestinationPage(f.doc, "合成目录", [loadedPage(2)])).toBe(2);
    expect(f.api.getDestination).toHaveBeenCalledExactlyOnceWith("合成目录"); expect(f.api.getPageIndex).not.toHaveBeenCalled();
  });
  it("对象号相同但generation不同不能混淆，只匹配完整num/gen二元组", async () => {
    const f = fixture(), pages = [loadedPage(1, 34, 1), loadedPage(4, 35, 0), loadedPage(3, 34, 0)];
    expect(await resolvePdfDestinationPage(f.doc, [{ num: 34, gen: 0 }], pages)).toBe(3);
    expect(await resolvePdfDestinationPage(f.doc, [{ num: 34, gen: 1 }], pages)).toBe(1);
    expect(f.api.getPageIndex).not.toHaveBeenCalled();
  });
  it.each([2, 4])("重复精确匹配（第二条page=%s）拒绝，不选首个且不fallback", async secondPage => {
    const f = fixture(), pages = [loadedPage(2), loadedPage(secondPage)];
    await expect(resolvePdfDestinationPage(f.doc, [{ num: 34, gen: 0 }], pages)).rejects.toThrow("PDF引用对象不唯一");
    expect(f.api.getPageIndex).not.toHaveBeenCalled();
  });
  it.each([
    { label: "空页面列表", pages: [] },
    { label: "相同num不同gen", pages: [loadedPage(1, 34, 1)] },
    { label: "不同num相同gen", pages: [loadedPage(1, 35, 0)] },
    { label: "旧索引没有reference", pages: [{ ...loadedPage(1), reference: undefined }] },
  ])("$label 未命中时保留原getPageIndex路径，且传递准确ref", async ({ pages }) => {
    const f = fixture(); f.api.getPageIndex.mockResolvedValue(2);
    expect(await resolvePdfDestinationPage(f.doc, [{ num: 34, gen: 0 }], pages)).toBe(3);
    expect(f.api.getPageIndex).toHaveBeenCalledExactlyOnceWith({ num: 34, gen: 0 }); expect(fetch).not.toHaveBeenCalled();
  });
  it("未命中且getPageIndex失败保留原错误，不按页文字或默认页猜测", async () => {
    const f = fixture(), error = brokenPageTree(), pages = [loadedPage(2, 35)]; f.api.getPageIndex.mockRejectedValue(error);
    await expect(resolvePdfDestinationPage(f.doc, [{ num: 34, gen: 0 }], pages)).rejects.toBe(error);
    expect(f.api.getPageIndex).toHaveBeenCalledOnce();
  });
  it("直接数字页目标保持原0基语义，不使用页对象号替换", async () => {
    const f = fixture(); expect(await resolvePdfDestinationPage(f.doc, [0, { name: "Fit" }], [loadedPage(4)])).toBe(1); expect(f.api.getPageIndex).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, Number.NaN, Infinity, 5, Number.MAX_SAFE_INTEGER + 1])("唯一命中的pageNumber=%s仍严格拒绝，不改走猜测fallback", async pageNumber => {
    const f = fixture();
    await expect(resolvePdfDestinationPage(f.doc, [{ num: 34, gen: 0 }], [loadedPage(pageNumber)])).rejects.toThrow(/有效页号/);
    expect(f.api.getPageIndex).not.toHaveBeenCalled();
  });
  it.each([
    { num: 0, gen: 0 }, { num: -1, gen: 0 }, { num: 1.5, gen: 0 }, { num: Number.NaN, gen: 0 }, { num: Infinity, gen: 0 }, { num: Number.MAX_SAFE_INTEGER + 1, gen: 0 },
    { num: 34, gen: -1 }, { num: 34, gen: 0.5 }, { num: 34, gen: Number.NaN }, { num: 34, gen: Infinity }, { num: 34, gen: Number.MAX_SAFE_INTEGER + 1 },
  ])("非法num=$num gen=$gen不能借已加载页ref绕过既有验证", async ref => {
    const f = fixture();
    await expect(resolvePdfDestinationPage(f.doc, [ref], [loadedPage(2, ref.num, ref.gen)])).rejects.toThrow(/有效页号/);
    expect(f.api.getPageIndex).not.toHaveBeenCalled();
  });
  it("同对象号在另一本session解析为不同页，不复用跨会话缓存", async () => {
    const first = fixture(), second = fixture(); first.api.getPageIndex.mockRejectedValue(brokenPageTree()); second.api.getPageIndex.mockRejectedValue(brokenPageTree());
    expect(await resolvePdfDestinationPage(first.doc, [{ num: 34, gen: 0 }], [loadedPage(1)])).toBe(1);
    expect(await resolvePdfDestinationPage(second.doc, [{ num: 34, gen: 0 }], [loadedPage(4)])).toBe(4);
    expect(await resolvePdfDestinationPage(first.doc, [{ num: 34, gen: 0 }], [loadedPage(1)])).toBe(1);
    expect(first.api.getPageIndex).not.toHaveBeenCalled(); expect(second.api.getPageIndex).not.toHaveBeenCalled();
  });
  it("indexPdfPages保留精确ref副本，索引完成后的导航不额外getPage", async () => {
    const f = fixture(), reference = { num: 34, gen: 0 }, cleanup = vi.fn();
    const pdfPage = { ref: reference, rotate: 0, cleanup, getTextContent: vi.fn(async () => ({ items: [], styles: {}, lang: null })), getViewport: vi.fn(() => ({ width: 600, height: 800 })) };
    const getPage = vi.fn(async () => pdfPage), doc = { ...f.api, numPages: 1, getPage } as unknown as PDFDocumentProxy;
    const pages = await indexPdfPages(doc, new AbortController().signal, vi.fn());
    expect(pages[0].reference).toEqual({ num: 34, gen: 0 }); expect(pages[0].reference).not.toBe(reference); expect(cleanup).toHaveBeenCalledOnce();
    reference.num = 99; f.api.getPageIndex.mockRejectedValue(brokenPageTree());
    expect(await resolvePdfDestinationPage(doc, [{ num: 34, gen: 0 }], pages)).toBe(1);
    expect(getPage).toHaveBeenCalledExactlyOnceWith(1); expect(f.api.getPageIndex).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("link service和引用概览共同传入当前页索引，坏页树也能导航与本地概览", async () => {
    const f = fixture(), pages = [loadedPage(1, 10), loadedPage(2), loadedPage(3, 50), loadedPage(4, 60)];
    f.api.getDestination.mockResolvedValue([{ num: 34, gen: 0 }, { name: "Fit" }]); f.api.getPageIndex.mockRejectedValue(brokenPageTree());
    const links = createPdfLinkService(f.doc, { getPage: () => 1, goToPage: f.go, onNotice: f.notice, isActive: () => true }, pages);
    await links.goToDestination("目录条目"); expect(f.go).toHaveBeenCalledExactlyOnceWith(2); expect(f.notice).not.toHaveBeenCalled();
    const link = document.createElement("a"); link.setAttribute("href", links.getDestinationHash([{ num: 34, gen: 0 }, { name: "Fit" }]));
    expect(await previewPdfReference(link, f.doc, { pages, paragraphs: [], complete: false })).toEqual({ title: "引用预览", text: "第 2 页文字概览（非精确脚注定位）\n合成本地页2", address: "第 2 页", index: 1 });
    expect(f.api.getPageIndex).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
  });
  it("重复ref在服务中明确提示不导航，在预览中拒绝；两条路径都不降级getPageIndex", async () => {
    const f = fixture(), pages = [loadedPage(1), loadedPage(2)];
    const links = createPdfLinkService(f.doc, { getPage: () => 1, goToPage: f.go, onNotice: f.notice, isActive: () => true }, pages);
    await links.goToDestination([{ num: 34, gen: 0 }]); expect(f.go).not.toHaveBeenCalled(); expect(f.notice).toHaveBeenCalledWith("PDF引用无法定位，请使用页码导航。");
    const link = document.createElement("a"); link.setAttribute("href", links.getDestinationHash([{ num: 34, gen: 0 }]));
    await expect(previewPdfReference(link, f.doc, { pages, paragraphs: [], complete: false })).rejects.toThrow("PDF引用对象不唯一");
    expect(f.api.getPageIndex).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});


it("孤立目录对象34不存在时明确拒绝，只有确实存在的对象281才能定位；相同页文字也不能猜", async () => {
  const f = fixture(), error = brokenPageTree(); f.api.numPages = 6;
  const pages = [loadedPage(1, 101), loadedPage(2, 102), loadedPage(3, 103), loadedPage(4, 104), loadedPage(5, 105), loadedPage(6, 281)];
  // WHY：这是合成回归，不读取用户论文；同文和相似目录标题不能成为恢复孤立对象的依据。
  for (const page of pages) page.items[0].str = "相同文字：失效目录标题";
  f.api.getDestination.mockResolvedValue([{ num: 34, gen: 0 }, { name: "Fit" }]); f.api.getPageIndex.mockRejectedValue(error);
  const invalid = "失效目录标题", valid = [{ num: 281, gen: 0 }, { name: "Fit" }];
  expect(pages.some(page => page.reference?.num === 34)).toBe(false);
  await expect(resolvePdfDestinationPage(f.doc, invalid, pages)).rejects.toBe(error);
  const links = createPdfLinkService(f.doc, { getPage: () => 1, goToPage: f.go, onNotice: f.notice, isActive: () => true }, pages);
  await links.goToDestination(invalid);
  expect(f.go).not.toHaveBeenCalled(); expect(f.notice).toHaveBeenCalledWith(expect.stringMatching(/引用.*(失效|无法定位).*页码/u));
  const link = document.createElement("a"); link.setAttribute("href", links.getDestinationHash(invalid));
  await expect(previewPdfReference(link, f.doc, { pages, paragraphs: [], complete: false })).rejects.toBe(error);
  expect(f.api.getPageIndex.mock.calls).toEqual([[{ num: 34, gen: 0 }], [{ num: 34, gen: 0 }], [{ num: 34, gen: 0 }]]);
  expect(await resolvePdfDestinationPage(f.doc, valid, pages)).toBe(6);
  await links.goToDestination(valid); expect(f.go).toHaveBeenCalledExactlyOnceWith(6);
  link.setAttribute("href", links.getDestinationHash(valid));
  expect(await previewPdfReference(link, f.doc, { pages, paragraphs: [], complete: false })).toMatchObject({ index: 5, address: "第 6 页" });
  expect(f.api.getPageIndex).toHaveBeenCalledTimes(3); expect(fetch).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
});
