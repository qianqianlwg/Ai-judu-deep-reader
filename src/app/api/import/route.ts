import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { getDb } from "@/lib/db";
import { hashText } from "@/lib/hash";
import { parseEpubFile, splitParagraphs } from "@/lib/epub-parser";

const nodeRequire = createRequire(import.meta.url);
// WHY：Turbopack 会错误改写 PDF.js 的 worker 路径，因此通过 Node 运行时加载并显式注册 fake worker。
const loadNodeModule = (specifier: string): unknown => Reflect.apply(nodeRequire, undefined, [specifier]);
type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfJsWorkerGlobal = { WorkerMessageHandler: unknown };
const pdfjs = loadNodeModule(["pdfjs-dist", "legacy", "build", "pdf.mjs"].join("/")) as PdfJsModule;
const pdfjsRuntime = globalThis as typeof globalThis & { pdfjsWorker?: PdfJsWorkerGlobal };
pdfjsRuntime.pdfjsWorker = loadNodeModule(["pdfjs-dist", "legacy", "build", "pdf.worker.mjs"].join("/")) as PdfJsWorkerGlobal;

export const runtime = "nodejs";

async function extractPdfText(buffer: Buffer): Promise<string> {
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  try {
    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        pageTexts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
      } finally {
        page.cleanup();
      }
    }
    return pageTexts.join("\n\n");
  } finally {
    await document.destroy();
  }
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "请上传 EPUB、PDF 或 TXT 文件" }, { status: 400 });
  const extension = path.extname(file.name).toLowerCase();
  if (![".epub", ".pdf", ".txt", ".md"].includes(extension)) return NextResponse.json({ error: "当前仅支持 EPUB、文字型 PDF、TXT 和 Markdown" }, { status: 415 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const tempPath = path.join(os.tmpdir(), `judu-${randomUUID()}${extension}`);
  await fs.writeFile(tempPath, buffer);
  try {
    let title = file.name.replace(/\.[^.]+$/, "");
    let author = "未知作者";
    let chapterData: { title: string; paragraphs: string[] }[] = [];
    if (extension === ".epub") {
      const result = await parseEpubFile(tempPath); title = result.title; author = result.author; chapterData = result.chapters;
    } else if (extension === ".pdf") {
      const text = await extractPdfText(buffer); chapterData = [{ title: "正文", paragraphs: splitParagraphs(text) }];
    } else {
      chapterData = [{ title: "正文", paragraphs: splitParagraphs(buffer.toString("utf8")) }];
    }
    const chapters = chapterData
      .filter((chapter) => chapter.paragraphs.length)
      .map((chapter, chapterIndex) => ({
        id: randomUUID(),
        title: chapter.title || `第${chapterIndex + 1}章`,
        paragraphs: chapter.paragraphs.map((text) => ({
          id: randomUUID(),
          text,
          textHash: Buffer.from(text).toString("base64url"),
        })),
      }));
    const bookId = randomUUID();
    const editionId = randomUUID();
    const now = new Date().toISOString();
    const insertBook = db.prepare("INSERT INTO books (id, title, author, created_at) VALUES (?, ?, ?, ?)");
    const insertEdition = db.prepare("INSERT INTO editions (id, book_id, file_name, file_type, file_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    const insertChapter = db.prepare("INSERT INTO chapters (id, edition_id, title, order_index) VALUES (?, ?, ?, ?)");
    const insertParagraph = db.prepare("INSERT INTO paragraphs (id, chapter_id, text, text_hash, order_index) VALUES (?, ?, ?, ?, ?)");
    // WHY：使用显式事务适配 Node 内置 SQLite，避免引入原生数据库扩展。
    db.exec("BEGIN");
    try {
      insertBook.run(bookId, title, author, now);
      insertEdition.run(editionId, bookId, file.name, extension, hashText(buffer.toString("base64")), now);
      chapters.forEach((chapter, chapterIndex) => {
        insertChapter.run(chapter.id, editionId, chapter.title, chapterIndex);
        chapter.paragraphs.forEach((paragraph, paragraphIndex) => insertParagraph.run(paragraph.id, chapter.id, paragraph.text, hashText(paragraph.text), paragraphIndex));
      });
      db.exec("COMMIT");
    } catch (error: unknown) {
      db.exec("ROLLBACK");
      console.error("书籍持久化失败", error);
      throw error;
    }    return NextResponse.json({ id: bookId, editionId, title, author, fileName: file.name, chapters });
  } catch (error: unknown) {
    console.error("书籍导入失败", error);
    const message = extension === ".pdf"
      ? "PDF 解析失败，请确认这是文字型 PDF 且文件未损坏"
      : "书籍解析失败，请重试";
    return NextResponse.json({ error: message }, { status: 422 });
  } finally { await fs.rm(tempPath, { force: true }); }
}
