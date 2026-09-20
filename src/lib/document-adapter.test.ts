import { describe, expect, it } from "vitest";
import { documentAdapterFor, isSupportedDocumentExtension } from "./document-adapter";
import { makeMobiFixture } from "./mobi-fixture";

describe("document adapter", () => {
  it("keeps text extraction formats behind one boundary", () => {
    expect(isSupportedDocumentExtension(".epub")).toBe(true);
    expect(isSupportedDocumentExtension(".pdf")).toBe(true);
    expect(isSupportedDocumentExtension(".txt")).toBe(true);
    expect(isSupportedDocumentExtension(".md")).toBe(true);
    expect(isSupportedDocumentExtension(".mobi")).toBe(true);
    expect(documentAdapterFor(".azw3")).toBeUndefined();
    expect(documentAdapterFor(".mobi")?.extension).toBe(".mobi");
    expect(documentAdapterFor(".pdf")?.extension).toBe(".pdf");
  });

  it("extracts MOBI through the bounded worker and preserves source chapters", async () => {
    const adapter = documentAdapterFor(".mobi");
    expect(adapter).toBeDefined();
    const result = await adapter!.extract({ fileName: "测试.mobi", extension: ".mobi", buffer: makeMobiFixture(), tempPath: "" });
    expect(result.title).toBe("本地测试标题");
    expect(result.chapters.map(chapter => chapter.sourceHref)).toEqual(["mobi-v1/mobi/0", "mobi-v1/mobi/1"]);
    expect(result.chapters.flatMap(chapter => chapter.paragraphs)).toEqual(["第一段。", "第二段😀。"]);
  }, 20000);

  it("extracts plain text without requiring a reader renderer", async () => {
    const adapter = documentAdapterFor(".txt");
    expect(adapter).toBeDefined();
    const result = await adapter!.extract({ fileName: "测试.txt", extension: ".txt", buffer: Buffer.from("第一段。\n\n第二段。", "utf8"), tempPath: "" });
    expect(result.title).toBe("测试");
    expect(result.chapters[0]?.paragraphs).toEqual(["第一段。", "第二段。"]);
  });
});

// WHY：模拟 PDF 运行时完全不可用的部署环境，仍必须能加载适配器并导入文本/EPUB。
describe("PDF bootstrap isolation", () => {
  it("does not load any PDF module at evaluation or adapter selection, and retries failures only for PDF", async () => {
    const { vi } = await import("vitest");
    const loader = vi.fn(() => { throw new Error("PDF unavailable"); });
    vi.resetModules(); vi.doMock("node:module", () => ({ createRequire: () => loader }));
    try {
      const adapters = await import("./document-adapter");
      adapters.documentAdapterFor(".pdf"); adapters.documentAdapterFor(".epub"); expect(loader).not.toHaveBeenCalled();
      await expect(adapters.documentAdapterFor(".pdf")!.extract({ fileName: "a.pdf", extension: ".pdf", buffer: Buffer.from("broken"), tempPath: "" })).rejects.toThrow("PDF unavailable");
      const text = await adapters.documentAdapterFor(".txt")!.extract({ fileName: "still works.txt", extension: ".txt", buffer: Buffer.from("unchanged text"), tempPath: "" });
      expect(text.chapters[0].paragraphs).toEqual(["unchanged text"]);
    } finally { vi.doUnmock("node:module"); vi.resetModules(); }
  });
  it("preserves PDF item joins, page boundaries, and cleanup semantics", async () => {
    const { vi } = await import("vitest");
    const cleanup = vi.fn(), destroy = vi.fn();
    const document = { numPages: 2, getPage: vi.fn(async (page: number) => ({ getTextContent: async () => ({ items: [{ str: "Page" }, { type: "marked-content" }, { str: String(page) }] }), cleanup })) };
    const getDocument = vi.fn(() => ({ promise: Promise.resolve(document), destroy }));
    vi.resetModules(); vi.doMock("node:module", () => ({ createRequire: () => (specifier: string) => specifier.includes("worker") ? { WorkerMessageHandler: {} } : { getDocument } }));
    const global = globalThis as typeof globalThis & { pdfjsWorker?: { WorkerMessageHandler: unknown } }; const previousWorker = global.pdfjsWorker;
    try {
      const adapters = await import("./document-adapter");
      const result = await adapters.documentAdapterFor(".pdf")!.extract({ fileName: "pages.pdf", extension: ".pdf", buffer: Buffer.from("data"), tempPath: "" });
      expect(result.chapters.map(chapter=>({paragraphs:chapter.paragraphs,sourceHref:chapter.sourceHref}))).toEqual([{paragraphs:["Page 1"],sourceHref:"pdf:page:1"},{paragraphs:["Page 2"],sourceHref:"pdf:page:2"}]); expect(cleanup).toHaveBeenCalledTimes(2); expect(destroy).toHaveBeenCalledOnce();
    } finally { global.pdfjsWorker = previousWorker; vi.doUnmock("node:module"); vi.resetModules(); }
  });
});


describe('FB2 / FBZ共享提取契约',()=>{
 it('原始XML与有界压缩容器提取相同章节、正文及来源',async()=>{
  const {readFile}=await import('node:fs/promises'),{default:JSZip}=await import('jszip');const xml=await readFile('src/lib/fixtures/reader.fb2'),zip=new JSZip();zip.file('book.fb2',xml);const compressed=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  const results=await Promise.all(([['.fb2',xml],['.fbz',compressed]] as const).map(async([extension,buffer])=>documentAdapterFor(extension)!.extract({extension,buffer,fileName:'book'+extension,tempPath:''})));
  expect(results[0]).toEqual(results[1]);expect(results[0].title).toBe('FB2 本地完整性验收');expect(results[0].chapters).toHaveLength(3);expect(results[0].chapters.map(chapter=>chapter.sourceHref)).toEqual(['fb2-v1/section-0.xhtml','fb2-v1/section-1.xhtml','fb2-v1/section-2.xhtml']);expect(results[0].chapters[0].paragraphs.join('')).toContain('<公式> x & y，😀');
 });
});
