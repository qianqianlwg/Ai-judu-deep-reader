"use client";
import { useState } from "react";
import {isCbzFormat} from "@/lib/cbz-manifest";
import {isFb2Format} from "@/lib/fb2-format";
import type { LibraryBookContent } from "@/lib/library";
export function originalEpubAvailable(book: LibraryBookContent): boolean {
  return Boolean(book.editionId && book.edition?.hasOriginalFile && book.edition.fileType.replace(/^\./u, "").toLowerCase() === "epub" && book.chapters.some(chapter => chapter.sourceHref));
}
export function originalReaderKind(book:LibraryBookContent):"epub"|"pdf"|"fb2"|"cbz"|null {
 if(book.editionId&&book.edition?.hasOriginalFile&&isCbzFormat(book.edition.fileType)&&book.chapters.length&&book.chapters.every(chapter=>chapter.sourceHref?.startsWith("cbz-v1/")&&!chapter.paragraphs.length))return "cbz";
 if(book.editionId&&book.edition?.hasOriginalFile&&isFb2Format(book.edition.fileType)&&book.chapters.some(chapter=>chapter.sourceHref?.startsWith("fb2-v1/")))return "fb2";
 if(originalEpubAvailable(book))return "epub";
 return book.editionId&&book.edition?.hasOriginalFile&&book.edition.fileType.replace(/^\./u,"").toLowerCase()==="pdf"?"pdf":null;
}
export function useReaderMode(book: LibraryBookContent) {
  const [choices, setChoices] = useState<Record<string, "text" | "original">>({});
  const available = originalReaderKind(book)!==null;
  const key = book.editionId ?? "unselected";
  const mode = available ? isCbzFormat(book.edition?.fileType??"")?"original":choices[key] ?? "original" : "text";
  function selectMode(next: "text" | "original") { setChoices(previous => ({ ...previous, [key]: next })); }
  return { available, original: mode === "original", selectMode };
}
export function ReaderModeSwitch({ book, original, onChange, disabled }: { book: LibraryBookContent; original: boolean; onChange(mode: "text" | "original"): void; disabled?: boolean }) {
  const available = originalReaderKind(book)!==null;
  return <div className="reader-mode" aria-label="阅读视图">
    <button type="button" disabled={disabled || !available} aria-pressed={original} onClick={() => onChange("original")} title={available ? "保留原文件的图片、公式、脚注与版式" : "此版本没有可用原文件；旧书仍可精读，新导入 EPUB/PDF/FB2/CBZ 可使用原版"}>原版</button>
    <button type="button" disabled={disabled||isCbzFormat(book.edition?.fileType??"")} title={isCbzFormat(book.edition?.fileType??"")?"CBZ无文字层，OCR尚未启用":undefined} aria-pressed={!original} onClick={() => onChange("text")}>精读</button>
  </div>;
}
