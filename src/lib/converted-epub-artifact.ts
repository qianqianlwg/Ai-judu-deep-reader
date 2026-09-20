import { readLibraryConversion, type LibraryBookContent, type LibraryConversion } from "./library";

export type ConvertedEpubArtifact = {
  editionId: string; conversion: LibraryConversion; url: string; originalUrl: string;
};
export type ConvertedEpubState = { kind: "none" } | { kind: "invalid"; message: string } | { kind: "ready"; artifact: ConvertedEpubArtifact };

/** WHY：转换EPUB是原UMD的派生物，不能只看扩展名或把原件hash当渲染文件身份。 */
export function resolveConvertedEpub(book: LibraryBookContent): ConvertedEpubState {
  const edition = book.edition;
  if (edition?.fileType !== ".umd") return { kind: "none" };
  if (!book.id || !book.editionId || edition.id !== book.editionId) return { kind: "invalid", message: "转换版与当前书籍版本不匹配，请重新打开书籍。" };
  if (!edition.conversion) return { kind: "invalid", message: "此 UMD 版本尚无已保存的 EPUB 转换版，可继续精读。" };
  let conversion: LibraryConversion;
  try { conversion = readLibraryConversion(edition.conversion, edition); }
  catch (cause: unknown) {
    // WHY：边界校验错误转成显式UI状态，调用方显示原因；不能回退下载UMD并把它交给EPUB解析器。
    return { kind: "invalid", message: cause instanceof Error ? cause.message : "转换版元数据无效，请重新导入。" };
  }
  if (!book.chapters.length || book.chapters.length > 1024 || book.chapters.some((chapter, index) => chapter.sourceHref !== `OPS/chapter-${String(index + 1).padStart(4, "0")}.xhtml`)
    || !book.chapters.some(chapter => chapter.paragraphs.some(paragraph => paragraph.text.trim()))) {
    return { kind: "invalid", message: "转换版章节来源不完整，不能可靠关联精读正文，请重新导入。" };
  }
  const base = `/api/books/${encodeURIComponent(book.id)}`;
  const query = `?editionId=${encodeURIComponent(book.editionId)}`;
  return { kind: "ready", artifact: { editionId: book.editionId, conversion, url: base + "/converted" + query, originalUrl: base + "/original" + query } };
}

/** 服务端已核验两份文件；浏览器再绑定实际渲染字节，避免错响应污染派生CFI。 */
export async function verifyConvertedEpub(bytes: ArrayBuffer, artifact: ConvertedEpubArtifact): Promise<void> {
  if (bytes.byteLength !== artifact.conversion.fileSize) throw new Error("EPUB 转换版大小与版本记录不一致，请重新导入。");
  if (!globalThis.crypto?.subtle) throw new Error("当前浏览器不支持转换版完整性校验，请使用支持 Web Crypto 的浏览器。");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash = Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
  if (hash !== artifact.conversion.fileHash) throw new Error("EPUB 转换版内容与版本记录不一致，未启动阅读，请重新导入。");
}
