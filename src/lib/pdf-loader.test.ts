// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import { indexPdfPages, openPdf, type PdfRuntime } from "./pdf-loader";
import { MAX_PDF_INDEX_CHARACTERS, MAX_PDF_PAGES, pdfPageText, pdfSafeText } from "./pdf-text";

const runtime = { GlobalWorkerOptions: { workerSrc: "" }, getDocument: vi.fn() };
function textItem(str: string): TextItem { return { str, dir: "ltr", fontName: "SyntheticFont", width: str.length * 8, height: 12, transform: [1, 0, 0, 1, 0, 100], hasEOL: false }; }
function mockPage(strings = ["合成正文"], rotate = 0) {
  const content: TextContent = { items: strings.map(textItem), styles: {}, lang: "zh" };
  const methods = {
    rotate, getTextContent: vi.fn(async () => content), cleanup: vi.fn(() => true),
    getViewport: vi.fn((options: { scale: number }) => ({ width: (rotate % 180 ? 800 : 600) * options.scale, height: (rotate % 180 ? 600 : 800) * options.scale, rotation: rotate })),
  };
  return { ...methods, content, proxy: methods as unknown as PDFPageProxy };
}
function mockDocument(pages: ReturnType<typeof mockPage>[], numPages = pages.length) {
  const methods = { numPages, getPage: vi.fn(async (number: number) => pages[number - 1].proxy), destroy: vi.fn(async () => {}) };
  return { ...methods, proxy: methods as unknown as PDFDocumentProxy };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const signal = () => new AbortController().signal;
// WHY：mock PDF.js 边界，但运行真实 loader；不加载远程资源、用户 PDF、正式 data 或 AI。
beforeEach(() => {
  vi.resetModules(); runtime.GlobalWorkerOptions.workerSrc = ""; runtime.getDocument.mockReset();
  vi.doMock("pdfjs-dist/build/pdf.mjs", () => runtime);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("独立验收不允许网络请求"); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.doUnmock("pdfjs-dist/build/pdf.mjs"); vi.resetModules(); });

describe("PDF runtime 本地资源与安全选项", () => {
  it("并发初始化共享固定本地 worker，不使用 CDN", async () => {
    const loader = await import("./pdf-loader"), [first, second] = await Promise.all([loader.loadPdfRuntime(), loader.loadPdfRuntime()]);
    expect(first).toBe(second); expect(first.GlobalWorkerOptions.workerSrc).toBe("/vendor/pdfjs/pdf.worker.min.mjs");
    expect(runtime.getDocument).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("初始化错误向上传递且下一次允许重试，不永久缓存 rejected promise", async () => {
    const failure = new Error("合成 runtime 初始化失败"); vi.doMock("pdfjs-dist/build/pdf.mjs", () => { throw failure; });
    const loader = await import("./pdf-loader");
    await expect(loader.loadPdfRuntime()).rejects.toThrow();
    vi.doMock("pdfjs-dist/build/pdf.mjs", () => runtime);
    const result = await loader.loadPdfRuntime(); expect(result.GlobalWorkerOptions.workerSrc).toBe("/vendor/pdfjs/pdf.worker.min.mjs");
  });
  it("只配置本地 CMaps、标准字体、wasm、ICC，关闭 eval 与 XFA", async () => {
    const { loadPdfRuntime } = await import("./pdf-loader"), pdf = await loadPdfRuntime();
    const task = { destroy: vi.fn(async () => {}), promise: Promise.resolve({}) }; runtime.getDocument.mockReturnValue(task);
    expect(openPdf(pdf, "/api/books/book/original?editionId=edition")).toBe(task);
    expect(runtime.getDocument).toHaveBeenCalledExactlyOnceWith({
      url: "/api/books/book/original?editionId=edition", isEvalSupported: false, enableXfa: false,
      cMapUrl: "/vendor/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
      wasmUrl: "/vendor/pdfjs/wasm/", iccUrl: "/vendor/pdfjs/iccs/", maxImageSize: 16_777_216,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("原样交回 loading task 供调用方取消，保留 destroy 与 promise", async () => {
    const document = mockDocument([mockPage()]); const task = { promise: Promise.resolve(document.proxy), destroy: vi.fn(async () => {}) };
    runtime.getDocument.mockReturnValue(task);
    const opened = openPdf(runtime as unknown as PdfRuntime, "/local.pdf");
    expect(opened).toBe(task); expect(await opened.promise).toBe(document.proxy); await opened.destroy(); expect(task.destroy).toHaveBeenCalledOnce();
  });
  it("加载取消拒绝调用方 promise，不吞掉错误或替换为成功", async () => {
    const pending = deferred<PDFDocumentProxy>(), reason = new Error("合成加载取消");
    const task = { promise: pending.promise, destroy: vi.fn(async () => { pending.reject(reason); }) };
    runtime.getDocument.mockReturnValue(task); const opened: PDFDocumentLoadingTask = openPdf(runtime as unknown as PdfRuntime, "/local.pdf");
    const rejected = expect(opened.promise).rejects.toBe(reason); await opened.destroy(); await rejected;
  });
  it("getDocument 同步失败可见，不使用不安全 fallback", () => {
    const error = new Error("文档打开失败"); runtime.getDocument.mockImplementation(() => { throw error; });
    expect(() => openPdf(runtime as unknown as PdfRuntime, "/local.pdf")).toThrow(error);
    expect(runtime.getDocument).toHaveBeenCalledOnce();
  });
});

describe("PDF 页级文本索引与资源清理", () => {
  it("从1顺序提取，保存原item/UTF-16/几何，不做HTML解释或提前猜来源", async () => {
    const first = mockPage(["甲😀", "x<y &amp;", "\t换行\n"]), second = mockPage(["第二页"], 90), doc = mockDocument([first, second]), progress = vi.fn();
    first.content.items.splice(1, 0, { type: "beginMarkedContent", id: "mc0" });
    first.content.items.push({ type: "endMarkedContent", id: "mc0-end" }); first.content.items[0] = { ...textItem("甲😀"), hasEOL: true };
    const result = await indexPdfPages(doc.proxy, signal(), progress);
    expect(doc.getPage.mock.calls).toEqual([[1], [2]]); expect(progress.mock.calls).toEqual([[1], [2]]);
    expect(result[0]).toEqual({ pageNumber: 1, width: 600, height: 800, rotation: 0, mapped: false, runs: [], items: [
      { str: "甲😀", transform: [1, 0, 0, 1, 0, 100], width: 24, height: 12, hasEOL: true },
      { str: "x<y &amp;", transform: [1, 0, 0, 1, 0, 100], width: 72, height: 12, hasEOL: false },
      { str: "\t换行\n", transform: [1, 0, 0, 1, 0, 100], width: 32, height: 12, hasEOL: false },
    ] });
    expect(result[1]).toMatchObject({ pageNumber: 2, width: 800, height: 600, rotation: 90 });
    expect(first.getViewport).toHaveBeenCalledExactlyOnceWith({ scale: 1 }); expect(second.getViewport).toHaveBeenCalledExactlyOnceWith({ scale: 1 });
    expect(first.cleanup).toHaveBeenCalledOnce(); expect(second.cleanup).toHaveBeenCalledOnce(); expect(doc.destroy).not.toHaveBeenCalled();
  });
  it("图片扫描空文本页保留页号和几何，不伪造正文或略掉中间页", async () => {
    const blank = mockPage([]), doc = mockDocument([mockPage(["前"]), blank, mockPage(["后"])]);
    const result = await indexPdfPages(doc.proxy, signal(), vi.fn());
    expect(result.map(page => page.pageNumber)).toEqual([1, 2, 3]); expect(result[1]).toMatchObject({ items: [], mapped: false, runs: [] }); expect(blank.cleanup).toHaveBeenCalledOnce();
  });
  it("严格串行读取，不在前页完成前同时加载全部页", async () => {
    const first = mockPage(), second = mockPage(), pending = deferred<TextContent>(); first.getTextContent.mockReturnValue(pending.promise);
    const doc = mockDocument([first, second]), indexing = indexPdfPages(doc.proxy, signal(), vi.fn());
    await Promise.resolve(); expect(doc.getPage.mock.calls).toEqual([[1]]); expect(second.getTextContent).not.toHaveBeenCalled();
    pending.resolve(first.content); await indexing; expect(doc.getPage.mock.calls).toEqual([[1], [2]]);
  });
  it.each(["text", "viewport", "progress"])("%s 步骤失败也清理已获得的页，并传播异常", async stage => {
    const first = mockPage(), second = mockPage(), doc = mockDocument([first, second]), progress = vi.fn(), error = new Error(`合成 ${stage} 失败`);
    if (stage === "text") first.getTextContent.mockRejectedValue(error);
    if (stage === "viewport") first.getViewport.mockImplementation(() => { throw error; });
    if (stage === "progress") progress.mockImplementation(() => { throw error; });
    await expect(indexPdfPages(doc.proxy, signal(), progress)).rejects.toBe(error);
    expect(first.cleanup).toHaveBeenCalledOnce(); expect(doc.getPage).toHaveBeenCalledTimes(1); expect(second.cleanup).not.toHaveBeenCalled();
  });
  it("getPage 失败不吞错，已读页已清理，失败页不虚报进度", async () => {
    const first = mockPage(), doc = mockDocument([first, mockPage()]), progress = vi.fn(), error = new Error("第二页失败");
    doc.getPage.mockRejectedValueOnce(error);
    await expect(indexPdfPages(doc.proxy, signal(), progress)).rejects.toBe(error); expect(first.cleanup).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled();
    doc.getPage.mockReset().mockResolvedValueOnce(first.proxy).mockRejectedValueOnce(error);
    await expect(indexPdfPages(doc.proxy, signal(), progress)).rejects.toBe(error); expect(first.cleanup).toHaveBeenCalledOnce(); expect(progress.mock.calls).toEqual([[1]]);
  });
  it("清理失败同样可见，不静默成功", async () => {
    const first = mockPage(), error = new Error("cleanup失败"); first.cleanup.mockImplementation(() => { throw error; });
    await expect(indexPdfPages(mockDocument([first]).proxy, signal(), vi.fn())).rejects.toBe(error);
  });
});

describe("PDF 索引取消", () => {
  it("预先取消不加载页、不汇报进度", async () => {
    const controller = new AbortController(), reason = new Error("开始前取消"), doc = mockDocument([mockPage()]), progress = vi.fn(); controller.abort(reason);
    await expect(indexPdfPages(doc.proxy, controller.signal, progress)).rejects.toBe(reason);
    expect(doc.getPage).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled();
  });
  it("getPage等待期间取消，返回页后只清理，不再启动 getTextContent", async () => {
    const controller = new AbortController(), first = mockPage(), doc = mockDocument([first]), pending = deferred<PDFPageProxy>(), reason = new Error("等待页时取消"), progress = vi.fn();
    doc.getPage.mockReturnValue(pending.promise);
    const indexing = indexPdfPages(doc.proxy, controller.signal, progress), rejected = expect(indexing).rejects.toBe(reason);
    controller.abort(reason); pending.resolve(first.proxy); await rejected;
    expect(first.getTextContent).not.toHaveBeenCalled(); expect(first.cleanup).toHaveBeenCalledOnce(); expect(progress).not.toHaveBeenCalled();
  });
  it("getTextContent期间取消，settle后清理且不读取下一页/几何/进度", async () => {
    const controller = new AbortController(), first = mockPage(), doc = mockDocument([first, mockPage()]), pending = deferred<TextContent>(), progress = vi.fn(), reason = new Error("提取时取消");
    first.getTextContent.mockReturnValue(pending.promise);
    const indexing = indexPdfPages(doc.proxy, controller.signal, progress), rejected = expect(indexing).rejects.toBe(reason);
    await Promise.resolve(); expect(first.getTextContent).toHaveBeenCalledOnce(); controller.abort(reason); pending.resolve(first.content); await rejected;
    expect(first.cleanup).toHaveBeenCalledOnce(); expect(doc.getPage).toHaveBeenCalledTimes(1); expect(first.getViewport).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled();
  });
  it("页间取消不开始下一页", async () => {
    const controller = new AbortController(), first = mockPage(), second = mockPage(), doc = mockDocument([first, second]), reason = new Error("页间取消");
    const progress = vi.fn(() => controller.abort(reason));
    await expect(indexPdfPages(doc.proxy, controller.signal, progress)).rejects.toBe(reason);
    expect(doc.getPage).toHaveBeenCalledTimes(1); expect(first.cleanup).toHaveBeenCalledOnce(); expect(second.getTextContent).not.toHaveBeenCalled();
  });
});

describe("PDF 页数与累计字符安全边界", () => {
  it("5001页在加载前拒绝", async () => {
    const doc = mockDocument([], MAX_PDF_PAGES + 1), progress = vi.fn();
    await expect(indexPdfPages(doc.proxy, signal(), progress)).rejects.toThrow(/5000|页.*上限/);
    expect(doc.getPage).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled();
  });
  it("恰好5000空白页允许，最后页有序完成清理", async () => {
    const blank = mockPage([]), doc = mockDocument([], MAX_PDF_PAGES), progress = vi.fn(); doc.getPage.mockResolvedValue(blank.proxy);
    const result = await indexPdfPages(doc.proxy, signal(), progress);
    expect(result).toHaveLength(5000); expect(result.at(-1)?.pageNumber).toBe(5000); expect(blank.cleanup).toHaveBeenCalledTimes(5000); expect(progress).toHaveBeenLastCalledWith(5000);
  });
  it.each([0, -1, 1.5, Number.NaN])("非法页数 %s 不作为成功索引", async count => {
    const doc = mockDocument([mockPage(), mockPage()], count), progress = vi.fn();
    await expect(indexPdfPages(doc.proxy, signal(), progress)).rejects.toThrow(); expect(doc.getPage).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled();
  });
  it("恰好8百万UTF-16字符允许，不修改原文字串", async () => {
    const text = "甲".repeat(MAX_PDF_INDEX_CHARACTERS), first = mockPage([text]);
    const result = await indexPdfPages(mockDocument([first]).proxy, signal(), vi.fn());
    expect(result[0].items[0].str).toBe(text); expect(first.cleanup).toHaveBeenCalledOnce();
  });
  it("单页超字符上限必须拒绝且清理，不返回截断正文", async () => {
    const first = mockPage(["甲".repeat(MAX_PDF_INDEX_CHARACTERS + 1)]), progress = vi.fn();
    await expect(indexPdfPages(mockDocument([first]).proxy, signal(), progress)).rejects.toThrow(/文字.*上限/);
    expect(first.cleanup).toHaveBeenCalledOnce(); expect(progress).not.toHaveBeenCalled(); expect(first.getViewport).not.toHaveBeenCalled();
  });
  it("字符上限跨item跨页累计，超限页清理且不再读取后页", async () => {
    const first = mockPage(["甲".repeat(2_000_000), "乙".repeat(2_000_000)]), second = mockPage(["丙".repeat(4_000_001)]), third = mockPage(), doc = mockDocument([first, second, third]), progress = vi.fn();
    await expect(indexPdfPages(doc.proxy, signal(), progress)).rejects.toThrow(/文字.*上限/);
    expect(first.cleanup).toHaveBeenCalledOnce(); expect(second.cleanup).toHaveBeenCalledOnce(); expect(third.getTextContent).not.toHaveBeenCalled(); expect(progress.mock.calls).toEqual([[1]]);
  });
  it("内存保护字符总量按UTF-16计量，与用户1000Unicode选区上限区分", async () => {
    const first = mockPage(["😀".repeat(MAX_PDF_INDEX_CHARACTERS / 2) + "甲"]);
    await expect(indexPdfPages(mockDocument([first]).proxy, signal(), vi.fn())).rejects.toThrow(/文字.*上限/);
    expect(first.cleanup).toHaveBeenCalledOnce();
  });
});





describe("PDF NUL 显式未知字符归一化回归", () => {
  it.each([
    ["公式甲\0公式乙", "公式甲�公式乙"],
    ["\0x\0\0y\0", "�x��y�"],
    ["😀\0x<y &amp; 后半式", "😀�x<y &amp; 后半式"],
    ["原有�与\u2400、零0、\\0", "原有�与\u2400、零0、\\0"],
  ])("索引保留NUL后原文、item几何和UTF-16长度：%j", async (raw, expected) => {
    const first = mockPage([raw]), before = JSON.stringify(first.content), doc = mockDocument([first]);
    const [indexed] = await indexPdfPages(doc.proxy, signal(), vi.fn());
    expect(indexed.items[0]).toEqual({ str: expected, transform: [1, 0, 0, 1, 0, 100], width: raw.length * 8, height: 12, hasEOL: false });
    expect(indexed.items[0].str).not.toContain("\0"); expect(indexed.items[0].str.length).toBe(raw.length);
    expect(Array.from(indexed.items[0].str).length).toBe(Array.from(raw).length);
    expect(pdfSafeText(raw)).toBe(expected); expect(pdfSafeText(expected)).toBe(expected);
    expect(JSON.stringify(first.content)).toBe(before); expect(first.cleanup).toHaveBeenCalledOnce();
    expect(pdfPageText(first.content.items)).toBe(expected);
  });
  it("多页多item标记项和空item不打乱序列，导入canonical与索引非空白一致", async () => {
    const pages = [mockPage(["甲\0", "", "乙😀"]), mockPage(["", "\0x<y", "\t后半式\0\n"])];
    pages[0].content.items.splice(1, 0, { type: "beginMarkedContentProps", id: "formula" });
    const indexed = await indexPdfPages(mockDocument(pages).proxy, signal(), vi.fn());
    expect(indexed.map(page => page.items.map(item => item.str))).toEqual([["甲�", "", "乙😀"], ["", "�x<y", "\t后半式�\n"]]);
    expect(pages.map(page => pdfPageText(page.content.items))).toEqual(["甲� 乙😀", "�x<y 后半式�"]);
    for (let index = 0; index < pages.length; index++) {
      expect(indexed[index].items.map(item => item.str).join("").replace(/\s/gu, "")).toBe(pdfPageText(pages[index].content.items).replace(/\s/gu, ""));
    }
  });
  it("真实内存SQLite TEXT往返保留未知字符后的公式，并仍能精确定位，不读取正式数据库", async () => {
    type MemoryDatabase = { exec(sql: string): void; close(): void; prepare(sql: string): { run(...values: string[]): unknown; get(): { text: string } } };
    const sqlite = (process as unknown as { getBuiltinModule(name: string): { DatabaseSync: new (path: string) => MemoryDatabase } }).getBuiltinModule("node:sqlite");
    // WHY：仅使用同步内存SQLite复现生产TEXT读取边界，不创建文件或调用项目getDb。
    const db = new sqlite.DatabaseSync(":memory:");
    try {
      const { mapPdfDocument, bindPdfTextLayer, selectionFromPdfRange } = await import("./pdf-source-map");
      const raw = ["方程😀x\0y", "", "=z\0后半式"], first = mockPage(raw), canonical = pdfPageText(first.content.items);
      const indexed = await indexPdfPages(mockDocument([first]).proxy, signal(), vi.fn());
      db.exec("CREATE TABLE pdf_text (text TEXT NOT NULL)"); db.prepare("INSERT INTO pdf_text (text) VALUES (?)").run(canonical);
      const stored = db.prepare("SELECT text FROM pdf_text").get().text;
      expect(stored).toBe("方程😀x�y =z�后半式"); expect(stored).toBe(canonical);
      const paragraphs = [{ id: "original-paragraph-id", text: stored }];
      const mapped = mapPdfDocument(indexed, { id: "synthetic", title: "合成公式", author: "验收", chapters: [{ id: "page-1", title: "1", sourceHref: "pdf:page:1", paragraphs }] });
      expect(mapped.complete).toBe(true);
      const container = document.createElement("div"); document.body.append(container);
      try {
        const strings = raw.map(pdfSafeText), divs = strings.map(str => { const div = document.createElement("span"); div.textContent = str; if (str !== "") container.append(div); return div; });
        const dom = bindPdfTextLayer(mapped.pages[0], container, divs, strings), range = document.createRange(); range.selectNodeContents(container);
        expect(selectionFromPdfRange(range, [dom], paragraphs)).toEqual({ paragraphId: "original-paragraph-id", startOffset: 0, endOffset: stored.length, text: stored });
        expect(dom.points.at(-1)?.sourceOffset).toBe(stored.length - 1);
      } finally { container.remove(); }
    } finally { db.close(); }
  });
  it("NUL替换不缩短输入从而绕开累计字符上限", async () => {
    const first = mockPage(["甲".repeat(MAX_PDF_INDEX_CHARACTERS), "\0"]), progress = vi.fn();
    await expect(indexPdfPages(mockDocument([first]).proxy, signal(), progress)).rejects.toThrow(/文字.*上限/);
    expect(first.cleanup).toHaveBeenCalledOnce(); expect(progress).not.toHaveBeenCalled();
  });
});

it("真实PdfPage把NUL归一化后才交给TextLayer，空span未挂载仍与持久化canonical对齐", async () => {
  const { act, createElement } = await import("react"), { createRoot } = await import("react-dom/client");
  const { PdfPage } = await import("../components/pdf-page");
  const { mapPdfDocument, selectionFromPdfRange } = await import("./pdf-source-map");
  type PageProps = Parameters<typeof PdfPage>[0];
  type DomPage = Parameters<PageProps["onReady"]>[0];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const original = mockPage(["", "公式😀\0", "", "x<y\0后半式", ""]), canonical = pdfPageText(original.content.items);
  const paragraphs = [{ id: "formula-p1", text: canonical }];
  const indexed = await indexPdfPages(mockDocument([original]).proxy, signal(), vi.fn());
  const mapped = mapPdfDocument(indexed, { id: "synthetic", title: "公式", author: "测试", chapters: [{ id: "c1", title: "1", sourceHref: "pdf:page:1", paragraphs }] });
  const viewport = { width: 600, height: 800, clone: vi.fn(() => ({ width: 600, height: 800, dontFlip: true })) };
  const pdfPage = { rotate: 0, getViewport: vi.fn(() => viewport), render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
    getTextContent: original.getTextContent, getAnnotations: vi.fn(async () => []), cleanup: vi.fn() };
  const contents: TextContent[] = [], layers: SyntheticTextLayer[] = [];
  class SyntheticTextLayer {
    textDivs: HTMLElement[] = []; textContentItemsStr: string[] = []; cancel = vi.fn();
    constructor(readonly options: { container: HTMLElement; textContentSource: TextContent }) { contents.push(options.textContentSource); layers.push(this); }
    async render() {
      this.textContentItemsStr = this.options.textContentSource.items.flatMap(item => "str" in item ? [item.str] : []);
      this.textDivs = this.textContentItemsStr.map(str => {
        const span = document.createElement("span"); span.textContent = str;
        // WHY：复现已安装PDF.js的hasText挂载契约，不把空span人为补到DOM掩盖实际问题。
        if (str !== "") this.options.container.append(span);
        return span;
      });
    }
  }
  class SyntheticAnnotationLayer { async render() {} }
  const pdfRuntime = { TextLayer: SyntheticTextLayer, AnnotationLayer: SyntheticAnnotationLayer, AnnotationMode: { ENABLE: 1 },
    AnnotationType: { LINK: 2, TEXT: 1, POPUP: 16, HIGHLIGHT: 9, UNDERLINE: 10, STRIKEOUT: 12, SQUIGGLY: 11 } } as unknown as PdfRuntime;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host), ready = vi.fn<(page: DomPage) => void>();
  try {
    const props: PageProps = { document: { getPage: vi.fn(async () => pdfPage), annotationStorage: {} } as unknown as PDFDocumentProxy,
      runtime: pdfRuntime, page: mapped.pages[0], scale: 1, rotation: 0, linkService: {} as PageProps["linkService"], onReady: ready, onRemove: vi.fn() };
    await act(async () => root.render(createElement(PdfPage, props)));
    expect(contents).toHaveLength(1);
    expect(contents[0].items.flatMap(item => "str" in item ? [item.str] : [])).toEqual(["", "公式😀�", "", "x<y�后半式", ""]);
    expect(layers[0].textDivs).toHaveLength(5); expect(host.querySelectorAll(".textLayer span")).toHaveLength(2);
    expect(host.querySelector('[role="alert"]')).toBeNull(); expect(ready).toHaveBeenCalledOnce();
    const dom = ready.mock.calls[0][0], range = document.createRange(); range.selectNodeContents(dom.container);
    expect(dom.points.map(point => point.node.data[point.offset]).join("")).toBe("公式😀�x<y�后半式");
    expect(selectionFromPdfRange(range, [dom], paragraphs)).toEqual({ paragraphId: "formula-p1", startOffset: 0, endOffset: canonical.length, text: canonical });
    expect(fetch).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
