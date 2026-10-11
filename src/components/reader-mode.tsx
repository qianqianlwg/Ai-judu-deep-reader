"use client";
import { resolveConvertedEpub } from "@/lib/converted-epub-artifact";
import {isCbzFormat} from "@/lib/cbz-manifest";
import {isFb2Format} from "@/lib/fb2-format";
import type { LibraryBookContent } from "@/lib/library";
export function originalEpubAvailable(book: LibraryBookContent): boolean {
  return Boolean(book.editionId && book.edition?.hasOriginalFile && book.edition.fileType.replace(/^\./u, "").toLowerCase() === "epub" && book.chapters.some(chapter => chapter.sourceHref));
}
export function originalReaderKind(book:LibraryBookContent):"epub"|"pdf"|"mobi"|"fb2"|"cbz"|"umd"|null {
 if(resolveConvertedEpub(book).kind === "ready")return "umd";
 if(book.editionId&&book.edition?.hasOriginalFile&&isCbzFormat(book.edition.fileType)&&book.chapters.length&&book.chapters.every(chapter=>chapter.sourceHref?.startsWith("cbz-v1/")&&!chapter.paragraphs.length))return "cbz";
 if(book.editionId&&book.edition?.hasOriginalFile&&isFb2Format(book.edition.fileType)&&book.chapters.some(chapter=>chapter.sourceHref?.startsWith("fb2-v1/")))return "fb2";
 if(book.editionId&&book.edition?.hasOriginalFile&&book.edition.fileType===".mobi"&&book.chapters.some(chapter=>chapter.sourceHref?.startsWith("mobi-v1/")))return "mobi";
 if(originalEpubAvailable(book))return "epub";
 return book.editionId&&book.edition?.hasOriginalFile&&book.edition.fileType.replace(/^\./u,"").toLowerCase()==="pdf"?"pdf":null;
}
export function useReaderMode(book: LibraryBookContent) {
  const available = originalReaderKind(book)!==null;
  // WHY：有原件的格式始终使用原版，旧的text选择不再创建另一套阅读视图；无原件历史和纯文本格式保留数据读取能力。
  return { available, original:available };
}
export function ReaderFormatStatus({book}:{book:LibraryBookContent}) {
  const kind=originalReaderKind(book);
  return <span className="reader-format-status">{kind==='umd'?'UMD 转换版':kind?'原书排版':book.edition?.hasOriginalFile?'文本原文':'历史正文（未保存原件）'}</span>;
}
