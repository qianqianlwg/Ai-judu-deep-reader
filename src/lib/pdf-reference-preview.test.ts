// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { previewPdfReference } from "./pdf-reference-preview";
import { createPdfLinkService } from "./pdf-links";
import type { PdfDocumentIndex, PdfTextPage } from "./pdf-source-map";
function page(pageNumber: number, strings: string[]): PdfTextPage {
  return { pageNumber, width: 600, height: 800, rotation: 0, mapped: false, runs: [], items: strings.map(str => ({ str, transform: [1, 0, 0, 1, 0, 0], width: 100, height: 12 })) };
}
function fixture(strings = [["第一页本地文字"], ["第二页公式x<y", "后续文字"]]) {
  const index: PdfDocumentIndex = { pages: strings.map((s, i) => page(i + 1, s)), paragraphs: [], complete: false };
  const api = { numPages: index.pages.length, getDestination: vi.fn<(name: string) => Promise<unknown>>().mockResolvedValue([1, { name: "Fit" }]), getPageIndex: vi.fn<(ref: { num: number; gen: number }) => Promise<number>>().mockResolvedValue(1), getPage: vi.fn() };
  const doc = api as unknown as PDFDocumentProxy, notice = vi.fn(), navigation = vi.fn();
  const links = createPdfLinkService(doc, { getPage: () => 1, goToPage: navigation, onNotice: notice, isActive: () => true });
  const link = document.createElement("a"); document.body.append(link);
  return { index, api, doc, link, links, notice, navigation };
}
function destination(link: Element, value: unknown) { link.setAttribute("href", "#judu-dest=" + encodeURIComponent(JSON.stringify(value))); }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw new Error("PDF引用验收禁止网络访问"); })); vi.spyOn(window, "open").mockImplementation(() => null); });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// WHY：只读取合成本地页索引，PDF API仅负责命名目标和间接页引用，绝不渲染真实文件或访问用户书库。
describe("PDF引用本地页概览", () => {
  it("消费link service编码的显式页目标，声明非精确脚注而不伪称引用原句", async () => {
    const f = fixture(); f.link.setAttribute("href", f.links.getDestinationHash([1, { name: "XYZ" }, 12, 42, null]));
    const result = await previewPdfReference(f.link, f.doc, f.index);
    expect(result).toEqual({ title: "引用预览", text: "第 2 页文字概览（非精确脚注定位）\n第二页公式x<y 后续文字", address: "第 2 页", index: 1 });
    expect(f.api.getDestination).not.toHaveBeenCalled(); expect(f.api.getPageIndex).not.toHaveBeenCalled(); expect(f.api.getPage).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(f.navigation).not.toHaveBeenCalled();
  });
  it("hasEOL按本地item分行，纯空白在概览两端清除但不解码HTML实体", async () => {
    const f = fixture([["  x<y &amp;", "第二行  "]]); f.index.pages[0].items[0].hasEOL = true; destination(f.link, [0, { name: "Fit" }]);
    expect((await previewPdfReference(f.link, f.doc, f.index)).text).toBe("第 1 页文字概览（非精确脚注定位）\nx<y &amp;\n第二行");
  });
  it("命名引用可包含中文引号百分号，恰好解码一次并使用间接页引用", async () => {
    const f = fixture(), name = '公式"注释%25/#一'; f.api.getDestination.mockResolvedValue([{ num: 7, gen: 0 }, { name: "Fit" }]);
    f.link.setAttribute("href", f.links.getDestinationHash(name));
    expect((await previewPdfReference(f.link, f.doc, f.index)).index).toBe(1);
    expect(f.api.getDestination).toHaveBeenCalledExactlyOnceWith(name); expect(f.api.getPageIndex).toHaveBeenCalledExactlyOnceWith({ num: 7, gen: 0 });
  });
  it("不要求AI canonical映射成功，本地原页索引仍可概览", async () => {
    const f = fixture(); destination(f.link, [1, { name: "Fit" }]); expect(f.index.complete).toBe(false);
    expect((await previewPdfReference(f.link, f.doc, f.index)).text).toContain("第二页公式");
  });
  it.each([{ strings: [] }, { strings: ["", " \n\t"] }])("无可提取文字页 $strings 明确反馈并保留页导航", async ({ strings }) => {
    const f = fixture([strings]); destination(f.link, [0, { name: "Fit" }]);
    expect(await previewPdfReference(f.link, f.doc, f.index)).toEqual({ title: "引用预览", text: "本页没有可提取的文字，可跳转查看原版。", address: "第 1 页", index: 0 });
  });
  it.each(["", "#page=1", "#other", "javascript:alert(1)", "https://example.invalid/"])("无服务编码目标 %j 返回明确不可预览反馈，不自行解析或执行", async href => {
    const f = fixture(); f.link.setAttribute("href", href);
    const result = await previewPdfReference(f.link, f.doc, f.index);
    expect(result.text).toContain("没有可预览的页定位"); expect(result.index).toBeUndefined(); expect(f.api.getDestination).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
  });
  it("DOM输入和本地索引不被概览函数修改", async () => {
    const f = fixture(); destination(f.link, [0, { name: "Fit" }]); const before = JSON.stringify(f.index), html = f.link.outerHTML;
    await previewPdfReference(f.link, f.doc, f.index); expect(JSON.stringify(f.index)).toBe(before); expect(f.link.outerHTML).toBe(html);
  });
});

describe("PDF引用恶意或损坏目标拒绝", () => {
  it.each(["%", "%E0%A4%A", "{", "undefined", "%2522name%2522"])("损坏编码/JSON %j 拒绝且不访问PDF API", async encoded => {
    const f = fixture(); f.link.setAttribute("href", "#judu-dest=" + encoded);
    await expect(previewPdfReference(f.link, f.doc, f.index)).rejects.toThrow(); expect(f.api.getDestination).not.toHaveBeenCalled(); expect(f.api.getPageIndex).not.toHaveBeenCalled();
  });
  it.each([null, {}, [], true, 1, [null], ["1"], [-1], [0.5], [2], [Number.MAX_SAFE_INTEGER]].map(value => ({ value })))("无效目标 $value 不能变成可跳转预览", async ({ value }) => {
    const f = fixture(); destination(f.link, value);
    await expect(previewPdfReference(f.link, f.doc, f.index)).rejects.toThrow(/PDF引用目标/); expect(fetch).not.toHaveBeenCalled();
  });
  it("JSON巨大指数解析为Infinity仍拒绝", async () => {
    const f = fixture(); f.link.setAttribute("href", "#judu-dest=" + encodeURIComponent("[1e309]"));
    await expect(previewPdfReference(f.link, f.doc, f.index)).rejects.toThrow(/有效页号/);
  });
  it.each([Number.NaN, -1, 1.5, 2])("间接引用解析返回非法页index %s必须拒绝", async pageIndex => {
    const f = fixture(); f.api.getPageIndex.mockResolvedValue(pageIndex); destination(f.link, [{ num: 7, gen: 0 }, { name: "Fit" }]);
    await expect(previewPdfReference(f.link, f.doc, f.index)).rejects.toThrow(/有效页号/);
  });
  it.each(["named", "indirect"])("%s 异步解析失败向上传递，不降级为第一页概览", async kind => {
    const f = fixture(), error = new Error("合成引用解析失败");
    if (kind === "named") { destination(f.link, "broken"); f.api.getDestination.mockRejectedValue(error); }
    else { destination(f.link, [{ num: 7, gen: 0 }]); f.api.getPageIndex.mockRejectedValue(error); }
    await expect(previewPdfReference(f.link, f.doc, f.index)).rejects.toBe(error); expect(f.api.getPage).not.toHaveBeenCalled();
  });
  it("待定间接引用必须等待完成，不提前返回错误页", async () => {
    const f = fixture(), pending = deferred<number>(); f.api.getPageIndex.mockReturnValue(pending.promise); destination(f.link, [{ num: 7, gen: 0 }]);
    const observed = vi.fn(), request = previewPdfReference(f.link, f.doc, f.index).then(observed);
    await Promise.resolve(); expect(observed).not.toHaveBeenCalled(); pending.resolve(1); await request;
    expect(observed).toHaveBeenCalledWith(expect.objectContaining({ index: 1, address: "第 2 页" }));
  });
  it("目标页不在本地索引时拒绝，不临时联网重载", async () => {
    const f = fixture(); f.index.pages.pop(); destination(f.link, [1, { name: "Fit" }]);
    await expect(previewPdfReference(f.link, f.doc, f.index)).rejects.toThrow("PDF引用页不存在"); expect(f.api.getPage).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("PDF外部链接仅文本与内容预算", () => {
  it.each(["https://example.invalid/path?q=secret", "javascript:globalThis.__pdfExecuted=1", 'data:text/html,<script>alert(1)</script>', 'file:///C:/private/data', '<img src=x onerror="alert(1)">', ""])("外部地址%j仅返回文字，优先于内部href且无任何请求", async url => {
    const f = fixture(); f.links.addLinkAttributes(f.link, url, false); f.link.setAttribute("href", "#judu-dest=%broken");
    expect(await previewPdfReference(f.link, f.doc, f.index)).toEqual({ title: "外部链接", text: "外部链接不自动访问。", address: url });
    expect(f.api.getDestination).not.toHaveBeenCalled(); expect(f.api.getPageIndex).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
    expect(f.link.querySelector("script,img")).toBeNull();
  });
  it("本地概览中的HTML外观字符只作为字符串，不创建节点或请求图片", async () => {
    const f = fixture([['<img src="https://example.invalid/x" onerror="alert(1)">公式']]); destination(f.link, [0]);
    const result = await previewPdfReference(f.link, f.doc, f.index);
    expect(result.text).toContain('<img src="https://example.invalid/x"'); expect(document.querySelector("img")).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([2399, 2400, 2401, 10000])("%s字页正文概览最多2400字，不修改索引或混入后页", async length => {
    const f = fixture([["甲".repeat(length)], ["绝不能混入第二页"]]); destination(f.link, [0]);
    const result = await previewPdfReference(f.link, f.doc, f.index), body = result.text.split("\n").slice(1).join("\n");
    expect(body).toBe("甲".repeat(Math.min(length, 2400))); expect(result.text).not.toContain("第二页"); expect(f.index.pages[0].items[0].str).toHaveLength(length);
  });
  it("2400边界不截断Unicode代理对而生成乱码", async () => {
    const f = fixture([["甲".repeat(2399) + "😀后文"]]); destination(f.link, [0]);
    const body = (await previewPdfReference(f.link, f.doc, f.index)).text.split("\n").slice(1).join("\n");
    expect(Array.from(body).length).toBeLessThanOrEqual(2400); expect(body).not.toMatch(/[\uD800-\uDBFF]$/u);
    expect(body === "甲".repeat(2399) || body === "甲".repeat(2399) + "😀").toBe(true);
  });
});

