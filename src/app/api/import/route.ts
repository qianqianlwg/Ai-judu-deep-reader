import {MAX_IMPORT_FILE_BYTES,IMPORT_TOO_LARGE} from "@/lib/import-limits";
import {readImportForm,ImportFormError} from "@/lib/import-form";
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { EpubImportSecurityError, validateEpubImport } from "@/lib/epub-import-security";
import { hashText } from "@/lib/hash";
import { documentAdapterFor, type DocumentAdapter, type ExtractedDocument } from "@/lib/document-adapter";
import { getJuduDataDir, removeStoredOriginalFile, storeOriginalFile } from "@/lib/data-storage";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
class ImportError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
async function extractDocument(adapter: DocumentAdapter, fileName: string, buffer: Buffer): Promise<ExtractedDocument> {
  let directory: string | undefined;
  try {
    let tempPath = "";
    if (adapter.extension === ".epub") {
      await validateEpubImport(buffer);
      directory = await fs.mkdtemp(path.join(os.tmpdir(), "judu-import-"));
      tempPath = path.join(directory, "source.epub");
      await fs.writeFile(tempPath, buffer, { flag: "wx", mode: 0o600 });
    }
    try { return await adapter.extract({ fileName, extension: adapter.extension, buffer, tempPath }); }
    catch (error: unknown) {
      console.error("书籍解析失败", error);
      throw new ImportError(422, adapter.extension === ".cbz"&&error instanceof Error ? "CBZ解析失败："+error.message : adapter.extension === ".mobi"&&error instanceof Error ? "MOBI解析失败："+error.message : adapter.extension === ".pdf" ? "PDF 解析失败，请确认这是文字型 PDF 且文件未损坏" : [".fb2",".fbz"].includes(adapter.extension)&&error instanceof Error ? "FB2/FBZ解析失败："+error.message : "书籍解析失败，请确认文件未损坏后重试");
    }
  } finally {
    if (directory) {
      // WHY：只删除由本次 mkdtemp 返回且已经验证的私有临时目录，不递归处理上传文件名。
      const resolved = path.resolve(directory);
      if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("judu-import-")) throw new Error("临时目录不安全");
      await fs.rm(resolved, { recursive: true, force: true });
    }
  }
}
export async function POST(request: NextRequest) {
  let original: { dataDir: string; relativePath: string } | undefined;
  let committed = false;
  try {
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "multipart/form-data") throw new ImportError(415, "请使用文件上传表单");
    const form=await readImportForm(request);
    const file = form.get("file");
    if (form.getAll("file").length !== 1 || !(file instanceof File)) throw new ImportError(400, "请上传一个 MOBI、EPUB、PDF、FB2/FBZ、CBZ、TXT 或 Markdown 文件");
    if (!file.name.trim() || /[\\/\u0000-\u001f\u007f]/u.test(file.name) || file.name.length > 255) throw new ImportError(400, "上传文件名不合法");
    const adapter = documentAdapterFor(file.name.toLowerCase().endsWith(".fb2.zip")?".fbz":path.extname(file.name).toLowerCase());
    // WHY：AZW/AZW3 仍未完成公开资源/来源验收；MOBI 已通过独立文本 worker 接入统一导入契约。
    if (!adapter && [".azw", ".azw3"].includes(path.extname(file.name).toLowerCase())) throw new ImportError(415, "AZW/AZW3 正在验收，尚未开放导入；请使用无 DRM 的 MOBI、EPUB 或已支持格式。");
    if (!adapter && path.extname(file.name).toLowerCase() === ".umd") throw new ImportError(415, "UMD 转换正在验收，尚未开放导入；请先使用 EPUB 或已支持格式。");
    if (!adapter) throw new ImportError(415, "当前支持 MOBI、EPUB、PDF、FB2/FBZ、CBZ、TXT 和 Markdown");
    if (!file.size) throw new ImportError(422, "文件为空，未导入任何内容");
    if (file.size > MAX_IMPORT_FILE_BYTES) throw new ImportError(413, IMPORT_TOO_LARGE);
    let buffer: Buffer;
    try { buffer = Buffer.from(await file.arrayBuffer()); }
    catch (error: unknown) { console.warn("上传内容读取失败", error); throw new ImportError(400, "上传文件不完整，请重新上传"); }
    if (buffer.byteLength !== file.size) throw new ImportError(400, "上传文件不完整，请重新上传");
    const extracted = await extractDocument(adapter, file.name, buffer);
    // WHY：原文映射只携带 EPUB flow 返回的精确 href，不能为对齐阅读器而修改旧段落归一化或生成算法。
    // WHY：新客户端无需正文的 base64 副本；显式协商精简响应，旧客户端仍保留原契约。
    const compact = request.headers.get("X-Judu-Import-Response") === "compact";
    const chapters = extracted.chapters.filter(chapter => chapter.paragraphs.length || [".pdf",".fb2",".fbz",".cbz"].includes(adapter.extension)).map((chapter, chapterIndex) => ({
      id: randomUUID(), title: chapter.title || `第${chapterIndex + 1}章`,
      ...(chapter.sourceHref !== undefined ? { sourceHref: chapter.sourceHref } : {}),
      paragraphs: chapter.paragraphs.map(text => ({ id: randomUUID(), text, ...(compact ? {} : { textHash: Buffer.from(text).toString("base64url") }) })),
    }));
    if (!chapters.length || (![".pdf",".fb2",".fbz",".cbz"].includes(adapter.extension) && !chapters.some(chapter => chapter.paragraphs.some(paragraph => paragraph.text.trim().length)))) throw new ImportError(422, "文件中没有可阅读正文，未导入任何内容");
    const db = getDb();
    const bookId = randomUUID(), editionId = randomUUID(), now = new Date().toISOString();
    const dataDir = getJuduDataDir();
    const stored = await storeOriginalFile({ dataDir, editionId, extension: adapter.extension, buffer });
    original = { dataDir, relativePath: stored.relativePath };
    const metadata = { hasOriginalFile: true, fileSize: stored.size, originalHash: stored.originalHash, readerMode: "text" as const };
    const edition = { id: editionId, fileName: file.name, fileType: adapter.extension, createdAt: now, ...metadata };
    const response = NextResponse.json({ id: bookId, editionId, title: extracted.title, author: extracted.author, fileName: file.name, createdAt: now, ...metadata, edition, editions: [edition], chapters }, { headers });
    const insertBook = db.prepare("INSERT INTO books (id, title, author, created_at) VALUES (?, ?, ?, ?)");
    const insertEdition = db.prepare("INSERT INTO editions (id, book_id, file_name, file_type, file_hash, original_file_path, original_file_size, original_hash, reader_mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertChapter = db.prepare("INSERT INTO chapters (id, edition_id, title, order_index, source_href) VALUES (?, ?, ?, ?, ?)");
    const insertParagraph = db.prepare("INSERT INTO paragraphs (id, chapter_id, text, text_hash, order_index) VALUES (?, ?, ?, ?, ?)");
    // WHY：异步文件写入完成后才进入同步 SQLite 事务，不跨 await 持有数据库写锁。
    db.exec("BEGIN IMMEDIATE");
    try {
      insertBook.run(bookId, extracted.title, extracted.author, now);
      // WHY：保留历史 file_hash 的 base64 文本哈希语义，原始字节 SHA-256 只写入新列 original_hash。
      insertEdition.run(editionId, bookId, file.name, adapter.extension, hashText(buffer.toString("base64")), stored.relativePath, stored.size, stored.originalHash, "text", now);
      chapters.forEach((chapter, chapterIndex) => {
        insertChapter.run(chapter.id, editionId, chapter.title, chapterIndex, chapter.sourceHref ?? null);
        chapter.paragraphs.forEach((paragraph, paragraphIndex) => insertParagraph.run(paragraph.id, chapter.id, paragraph.text, hashText(paragraph.text), paragraphIndex));
      });
      db.exec("COMMIT"); committed = true;
    } catch (error: unknown) {
      try { db.exec("ROLLBACK"); }
      catch (rollbackError: unknown) { throw new AggregateError([error, rollbackError], "书籍持久化及回滚失败"); }
      throw error;
    }
    return response;
  } catch (error: unknown) {
    console.error("书籍导入失败", error);
    if (original && !committed) {
      try { await removeStoredOriginalFile(original.dataDir, original.relativePath); }
      catch (cleanupError: unknown) {
        console.error("失败导入的原文件清理失败", cleanupError);
        return NextResponse.json({ error: "导入失败且原文件清理失败，请检查数据目录权限后重试" }, { status: 500, headers });
      }
    }
    return NextResponse.json({ ...(error instanceof ImportFormError&&error.status===413||error instanceof ImportError&&error.status===413?{code:"upload_too_large",maxFileBytes:MAX_IMPORT_FILE_BYTES}:{}), error: error instanceof ImportError || error instanceof ImportFormError || error instanceof EpubImportSecurityError ? error.message : "书籍保存失败，请检查存储权限和可用空间后重试" }, { status: error instanceof ImportError || error instanceof ImportFormError ? error.status : error instanceof EpubImportSecurityError ? 422 : 500, headers });
  }
}
