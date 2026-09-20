import { createRequire } from "node:module";
import { parseEpubFile, splitParagraphs } from "./epub-parser";
import {pdfPageText,PDF_PAGE_PREFIX,MAX_PDF_PAGES,MAX_PDF_INDEX_CHARACTERS} from "./pdf-text";
export type SupportedDocumentExtension = ".epub" | ".pdf" | ".txt" | ".md" | ".fb2" | ".fbz" | ".cbz";
export type DocumentChapter = { title: string; paragraphs: string[]; sourceHref?: string };
export type ExtractedDocument = { title: string; author: string; chapters: DocumentChapter[] };
export type DocumentInput = { fileName: string; extension: SupportedDocumentExtension; buffer: Buffer; tempPath: string };
export interface DocumentAdapter {
  readonly extension: SupportedDocumentExtension;
  extract(input: DocumentInput): Promise<ExtractedDocument>;
}
const nodeRequire = createRequire(import.meta.url);
const loadNodeModule = (specifier: string): unknown => Reflect.apply(nodeRequire, undefined, [specifier]);
type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfJsWorkerGlobal = { WorkerMessageHandler: unknown };
let pdfjs: PdfJsModule | undefined;
function loadPdfJs(): PdfJsModule {
  if (pdfjs) return pdfjs;
  // WHY：只在 PDF 提取时加载 Node fake worker；PDF 引导失败不能阻断 EPUB/TXT/MD 的模块求值。
  const worker = loadNodeModule(["pdfjs-dist", "legacy", "build", "pdf.worker.mjs"].join("/"));
  if (!worker || typeof worker !== "object" || !("WorkerMessageHandler" in worker)) throw new Error("PDF worker 初始化失败");
  const runtime = globalThis as typeof globalThis & { pdfjsWorker?: PdfJsWorkerGlobal };
  runtime.pdfjsWorker = worker as PdfJsWorkerGlobal;
  const pdfModule = loadNodeModule(["pdfjs-dist", "legacy", "build", "pdf.mjs"].join("/"));
  if (!pdfModule || typeof pdfModule !== "object" || !("getDocument" in pdfModule) || typeof pdfModule.getDocument !== "function") throw new Error("PDF 提取模块初始化失败");
  pdfjs = pdfModule as PdfJsModule;
  return pdfjs;
}
async function extractPdfText(buffer: Buffer): Promise<DocumentChapter[]> {
  const task = loadPdfJs().getDocument({ data: new Uint8Array(buffer),isEvalSupported:false,enableXfa:false });
  try {
    const document = await task.promise;
    if(document.numPages>MAX_PDF_PAGES)throw new Error("PDF 页数超过当前安全上限（5000页）");
    const chapters:DocumentChapter[]=[];let characters=0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text=pdfPageText(content.items);characters+=text.length;if(characters>MAX_PDF_INDEX_CHARACTERS)throw new Error("PDF 文字总量超过当前索引上限");
        chapters.push({title:"第 "+pageNumber+" 页",sourceHref:PDF_PAGE_PREFIX+pageNumber,paragraphs:text?[text]:[]});
      } finally { page.cleanup(); }
    }
    return chapters;
  } finally { await task.destroy(); }
}
class EpubDocumentAdapter implements DocumentAdapter {
  readonly extension = ".epub" as const;
  async extract(input: DocumentInput): Promise<ExtractedDocument> { return parseEpubFile(input.tempPath); }
}
class PdfDocumentAdapter implements DocumentAdapter {
  readonly extension = ".pdf" as const;
  async extract(input: DocumentInput): Promise<ExtractedDocument> {
    return { title: input.fileName.replace(/\.[^.]+$/, ""), author: "未知作者", chapters: await extractPdfText(input.buffer) };
  }
}
class Fb2DocumentAdapter implements DocumentAdapter {
 constructor(readonly extension:'.fb2'|'.fbz'){}
 async extract(input:DocumentInput):Promise<ExtractedDocument>{
  const {parseFb2Book}=await import('./fb2-book');const bytes=this.extension==='.fbz'?await(await import('./fb2-archive')).readFb2Archive(input.buffer):input.buffer;
  const book=parseFb2Book(bytes);return {title:book.title||input.fileName.replace(/\.(?:fb2\.zip|fb2|fbz)$/iu,''),author:book.author,chapters:book.sections.map(section=>({title:section.title,sourceHref:section.href,paragraphs:section.paragraphs}))};
 }
}
class CbzDocumentAdapter implements DocumentAdapter {
 readonly extension='.cbz' as const;
 async extract(input:DocumentInput):Promise<ExtractedDocument>{const {inspectCbzArchive}=await import('./cbz-archive');const pages=await inspectCbzArchive(input.buffer);return {title:input.fileName.replace(/\.cbz$/iu,''),author:'未知作者',chapters:pages.map(page=>({title:page.title,sourceHref:page.sourceHref,paragraphs:[]}))};}
}
class PlainTextDocumentAdapter implements DocumentAdapter {
  constructor(readonly extension: ".txt" | ".md") {}
  async extract(input: DocumentInput): Promise<ExtractedDocument> {
    return { title: input.fileName.replace(/\.[^.]+$/, ""), author: "未知作者", chapters: [{ title: "正文", paragraphs: splitParagraphs(input.buffer.toString("utf8")) }] };
  }
}
export function documentAdapterFor(extension: string): DocumentAdapter | undefined {
  if (extension === ".cbz") return new CbzDocumentAdapter();
  if (extension === ".fb2" || extension === ".fbz") return new Fb2DocumentAdapter(extension);
  if (extension === ".epub") return new EpubDocumentAdapter();
  if (extension === ".pdf") return new PdfDocumentAdapter();
  if (extension === ".txt" || extension === ".md") return new PlainTextDocumentAdapter(extension);
  return undefined;
}
export function isSupportedDocumentExtension(value: string): value is SupportedDocumentExtension {
  return [".epub", ".pdf", ".txt", ".md", ".fb2", ".fbz", ".cbz"].includes(value);
}
