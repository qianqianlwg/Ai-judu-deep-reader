import { createHash, randomUUID } from "node:crypto";
import type { getDb } from "./db";
import { convertUmdFile } from "./umd-conversion";
import type { UmdWorkerOptions } from "./umd-worker-client";
import { UMD_LIMITS } from "./umd-container";
import { readConversionSources } from "./edition-conversion";
import { hashText } from "./hash";
import { storeOriginalFile, storeDerivedEpub, removeStoredOriginalFile, removeDerivedEpub } from "./data-storage";

export type UmdImportContext = { db: ReturnType<typeof getDb>; dataDir: string };
/** UMD导入组合根：明确接收DB/私有目录，装配已固定的转换器和存储器；上传API尚未开放。 */
export async function importUmdEdition(context: UmdImportContext, fileName: string, input: Uint8Array, options: UmdWorkerOptions = {}) {
  if (!fileName.trim() || fileName.length > 255 || /[\\/\u0000-\u001f\u007f]/u.test(fileName) || !/\.umd$/iu.test(fileName)) throw new Error("UMD文件名不合法");
  if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > UMD_LIMITS.input) throw new Error("UMD输入大小无效或超限");
  const originalBytes = Buffer.from(input), sourceHash = createHash("sha256").update(originalBytes).digest("hex");
  const converted = await convertUmdFile(originalBytes, options);
  if (converted.sourceHash !== sourceHash || converted.sourceSize !== originalBytes.length
    || converted.epubHash !== createHash("sha256").update(converted.epub).digest("hex") || converted.converterVersion !== "umd-epub-v1") throw new Error("UMD转换前后身份不一致");
  const sources = readConversionSources({ version: 1, chapters: converted.chapters });
  if (sources.length !== converted.document.chapters.length || converted.document.chapters.some((chapter, index) => chapter.sourceHref !== sources[index].href)) throw new Error("UMD正文与派生章节来源不一致");
  if (!converted.document.chapters.some(chapter => chapter.paragraphs.some(text => text.trim()))) throw new Error("UMD没有可阅读正文，未导入");
  const bookId = randomUUID(), editionId = randomUUID(), now = new Date().toISOString();
  const chapters = converted.document.chapters.map(chapter => ({ ...chapter, id: randomUUID(), paragraphs: chapter.paragraphs.map(text => ({ id: randomUUID(), text })) }));
  let preservePublished = false;
  const published: { role: "original" | "derived"; path: string }[] = [];
  const cancel = () => { if (options.signal?.aborted) throw new Error("UMD导入已取消"); };
  const { db, dataDir } = context;
  try {
    cancel();
    const original = await storeOriginalFile({ dataDir, editionId, extension: ".umd", buffer: originalBytes });
    published.push({ role: "original", path: original.relativePath }); cancel();
    const derived = await storeDerivedEpub({ dataDir, editionId, buffer: converted.epub });
    published.push({ role: "derived", path: derived.relativePath }); cancel();
    if (original.originalHash !== sourceHash || derived.fileHash !== converted.epubHash) throw new Error("持久化文件哈希与转换结果不一致");
    const conversion = { format: ".epub" as const, sourceHash, fileHash: derived.fileHash, fileSize: derived.size, converterVersion: converted.converterVersion, createdAt: now };
    const edition = { id: editionId, fileName, fileType: ".umd", hasOriginalFile: true, fileSize: original.size,
      originalHash: sourceHash, readerMode: "text" as const, createdAt: now, conversion };
    const result = { id: bookId, title: converted.document.title, author: converted.document.author, createdAt: now, editionId, edition, editions: [edition], chapters };
    // WHY：两个文件均成功发布后才进入同步SQLite事务；不跨await持锁，不把派生文件伪装成editions原件。
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO books (id,title,author,created_at) VALUES (?,?,?,?)").run(bookId, result.title, result.author, now);
      db.prepare("INSERT INTO editions (id,book_id,file_name,file_type,file_hash,original_file_path,original_file_size,original_hash,reader_mode,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(editionId, bookId, fileName, ".umd", hashText(originalBytes.toString("base64")), original.relativePath, original.size, sourceHash, "text", now);
      db.prepare("INSERT INTO edition_conversions (edition_id,source_hash,target_format,file_path,file_size,file_hash,converter_version,source_map_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(editionId, sourceHash, ".epub", derived.relativePath, derived.size, derived.fileHash, converted.converterVersion, JSON.stringify({ version: 1, chapters: sources }), now);
      const insertChapter = db.prepare("INSERT INTO chapters (id,edition_id,title,order_index,source_href) VALUES (?,?,?,?,?)");
      const insertParagraph = db.prepare("INSERT INTO paragraphs (id,chapter_id,text,text_hash,order_index) VALUES (?,?,?,?,?)");
      chapters.forEach((chapter, index) => { insertChapter.run(chapter.id, editionId, chapter.title, index, chapter.sourceHref!);
        chapter.paragraphs.forEach((paragraph, at) => insertParagraph.run(paragraph.id, chapter.id, paragraph.text, hashText(paragraph.text), at)); });
      db.exec("COMMIT");
    } catch (cause: unknown) {
      try { db.exec("ROLLBACK"); } catch (rollback: unknown) {
        // WHY：回滚失败时事务状态不确定，删除文件可能损坏已提交/仍引用文件的记录；宁可保留等待核查。
        preservePublished = true; throw new AggregateError([cause, rollback], "UMD数据库事务状态不确定，已保留原件和转换版，请检查后重试");
      }
      throw cause;
    }
    return result;
  } catch (cause: unknown) {
    if (preservePublished) throw cause;
    const failures: unknown[] = [cause];
    // WHY：只清理本次成功发布的文件，失败的同名发布不赋予删除旧文件的权利；一项清理失败也要继续另一项。
    for (const file of published.reverse()) {
      try { if (file.role === "original") await removeStoredOriginalFile(dataDir, file.path); else await removeDerivedEpub(dataDir, file.path); }
      catch (cleanup: unknown) { failures.push(cleanup); }
    }
    if (failures.length > 1) throw new AggregateError(failures, "UMD导入失败且文件清理未完成，请检查存储权限");
    throw cause;
  }
}
