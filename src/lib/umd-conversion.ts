import { createHash } from "node:crypto";
import type { ExtractedDocument } from "./document-adapter";
import { createUmdEpub, type UmdEpubResult } from "./umd-epub";
import { runUmdWorker, type UmdWorkerOptions } from "./umd-worker-client";

export type UmdConversion = UmdEpubResult & { epubHash: string; sourceSize: number; document: ExtractedDocument };
/** 受控转换组合根：固定隔离解析器与EPUB生成器，尚未接入生产导入和原件持久化。 */
export async function convertUmdFile(input: Uint8Array, options: UmdWorkerOptions = {}): Promise<UmdConversion> {
  const book = await runUmdWorker(input, options);
  if (options.signal?.aborted) throw new Error("UMD转换已取消");
  const converted = await createUmdEpub(book);
  if (options.signal?.aborted) throw new Error("UMD转换已取消");
  // WHY：旧EPUB提取器的实体/标题归一化不能当作新UMD的来源真值；直接保留同一解码快照的文本，XML只负责显示。
  const document: ExtractedDocument = { title: book.title, author: book.author, chapters: book.chapters.map((chapter, index) => ({
    title: chapter.title || `第 ${index + 1} 章`, sourceHref: converted.chapters[index].href,
    paragraphs: chapter.text.split(/\r\n|[\r\n\u2029]/u).filter(text => text.trim().length > 0),
  })) };
  // WHY：原件哈希与派生物哈希分别命名，不能用EPUB字节冒充已保存的UMD原件。
  return { ...converted, document, sourceSize: book.sourceSize, epubHash: createHash("sha256").update(converted.epub).digest("hex") };
}
