export type LibraryConversion = {
  format: ".epub";
  sourceHash: string;
  fileHash: string;
  fileSize: number;
  converterVersion: "umd-epub-v1";
  createdAt: string;
};
export type LibraryEdition = {
  id: string; fileName: string; fileType: string; hasOriginalFile?: boolean; fileSize?: number;
  originalHash?: string; readerMode?: "text"; createdAt: string; conversion?: LibraryConversion;
};
export type LibraryBook = { id: string; title: string; author: string; createdAt?: string; editions?: readonly LibraryEdition[] };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const sha256 = (value: unknown): value is string => typeof value === "string" && value.length === 64 && /^[a-f0-9]{64}$/u.test(value);
const MAX_CONVERSION_BYTES = 64 * 1024 * 1024;

/** 客户端和服务端共用的纯验证/投影函数；仅验证公开身份，不读文件或信任内部存储路径。 */
export function readLibraryConversion(
  value: unknown,
  edition: Pick<LibraryEdition, "fileType" | "hasOriginalFile" | "originalHash">,
): LibraryConversion {
  if (!record(value) || value.format !== ".epub" || !sha256(value.sourceHash) || !sha256(value.fileHash)
    || typeof value.fileSize !== "number" || !Number.isSafeInteger(value.fileSize) || value.fileSize < 1 || value.fileSize > MAX_CONVERSION_BYTES
    || value.converterVersion !== "umd-epub-v1" || typeof value.createdAt !== "string" || !value.createdAt.trim()) {
    throw new Error("转换版本数据不完整或无效");
  }
  if (edition.fileType !== ".umd" || edition.hasOriginalFile !== true || !sha256(edition.originalHash)
    || value.sourceHash !== edition.originalHash) throw new Error("转换版本与 UMD 原件身份不匹配");
  // WHY：原件哈希与派生EPUB哈希是独立身份；只允许来源哈希关联原件，绝不把fileHash覆盖回originalHash。
  // WHY：显式投影避免将file_path/source_map_json或未来新增的数据库私有字段带入客户端。
  return { format: ".epub", sourceHash: value.sourceHash, fileHash: value.fileHash, fileSize: value.fileSize,
    converterVersion: "umd-epub-v1", createdAt: value.createdAt };
}

function readEdition(item: unknown): LibraryEdition {
  if (!record(item) || !identifier(item.id) || typeof item.fileName !== "string" || typeof item.fileType !== "string"
    || (item.hasOriginalFile !== undefined && typeof item.hasOriginalFile !== "boolean")
    || (item.fileSize !== undefined && (typeof item.fileSize !== "number" || !Number.isSafeInteger(item.fileSize) || item.fileSize < 0))
    || (item.originalHash !== undefined && !sha256(item.originalHash))
    || (item.readerMode !== undefined && item.readerMode !== "text") || typeof item.createdAt !== "string") {
    throw new Error("版本数据不完整");
  }
  const edition: LibraryEdition = {
    id: item.id, fileName: item.fileName, fileType: item.fileType,
    ...(typeof item.hasOriginalFile === "boolean" ? { hasOriginalFile: item.hasOriginalFile } : {}),
    ...(typeof item.fileSize === "number" ? { fileSize: item.fileSize } : {}),
    ...(typeof item.originalHash === "string" ? { originalHash: item.originalHash } : {}),
    ...(item.readerMode === "text" ? { readerMode: "text" } : {}), createdAt: item.createdAt,
  };
  if (item.conversion !== undefined) edition.conversion = readLibraryConversion(item.conversion, edition);
  return edition;
}

export function readLibraryResponse(value: unknown): LibraryBook[] {
  if (!Array.isArray(value)) throw new Error("书架数据不是书籍列表");
  const bookIds = new Set<string>(); const editionIds = new Set<string>();
  return value.map(row => {
    if (!record(row) || !identifier(row.id) || typeof row.title !== "string" || typeof row.author !== "string") throw new Error("书籍数据不完整");
    if (bookIds.has(row.id)) throw new Error("书架返回了重复BookID，请检查版本归属");
    bookIds.add(row.id);
    let editions: LibraryEdition[] | undefined;
    if (row.editions !== undefined) {
      if (!Array.isArray(row.editions)) throw new Error("书籍版本列表不完整");
      editions = row.editions.map(item => {
        const edition = readEdition(item);
        if (editionIds.has(edition.id)) throw new Error("版本数据不完整或EditionID重复");
        editionIds.add(edition.id);
        return edition;
      });
    }
    // WHY：旧响应无版本元数据时仍可打开默认版本；新响应中的全部ID原样保留，绝不按标题去重。
    return { id: row.id, title: row.title, author: row.author, ...(typeof row.createdAt === "string" ? { createdAt: row.createdAt } : {}), ...(editions ? { editions } : {}) };
  });
}

export function rememberedEdition(book: LibraryBook | undefined, saved: string | null): string | undefined {
  if (!saved) return undefined;
  return book?.editions?.some(edition => edition.id === saved) ? saved : undefined;
}
export function bookEditionUrl(bookId: string, editionId?: string): string {
  return "/api/books/" + encodeURIComponent(bookId) + (editionId ? "?" + new URLSearchParams({ editionId }) : "");
}

export type LibraryParagraph = { id: string; text: string };
export type LibraryChapter = { id: string; title: string; sourceHref?: string; paragraphs: LibraryParagraph[] };
export type LibraryBookContent = LibraryBook & { editionId?: string; edition?: LibraryEdition; chapters: LibraryChapter[] };
export function readBookResponse(value: unknown, bookId: string, editionId?: string): LibraryBookContent {
  if (!record(value) || value.id !== bookId || !Array.isArray(value.chapters) || (editionId !== undefined && value.editionId !== editionId)) throw new Error("返回的书籍或版本不匹配，未替换当前原文");
  const book = readLibraryResponse([value])[0];
  const selectedId = typeof value.editionId === "string" ? value.editionId : undefined;
  if (selectedId && book.editions && !book.editions.some(item => item.id === selectedId)) throw new Error("正文版本不属于返回的书籍");
  let selected = book.editions?.find(item => item.id === selectedId);
  if (value.edition !== undefined) {
    const explicit = readEdition(value.edition);
    if (!selectedId || explicit.id !== selectedId) throw new Error("返回的正文版本身份不匹配");
    // WHY：服务端同时返回选中版本和版本列表时，两份公开元数据必须一致，不能默默忽略顶层的坏转换信息。
    if (selected && JSON.stringify(selected) !== JSON.stringify(explicit)) throw new Error("正文版本与列表元数据不匹配");
    selected = explicit;
  }
  const chapters = value.chapters.map(chapter => {
    if (!record(chapter) || !identifier(chapter.id) || typeof chapter.title !== "string" || (chapter.sourceHref !== undefined && typeof chapter.sourceHref !== "string") || !Array.isArray(chapter.paragraphs)) throw new Error("章节数据不完整");
    const paragraphs = chapter.paragraphs.map(paragraph => {
      if (!record(paragraph) || !identifier(paragraph.id) || typeof paragraph.text !== "string") throw new Error("正文段落数据不完整");
      return { id: paragraph.id, text: paragraph.text };
    });
    return { id: chapter.id, title: chapter.title, ...(typeof chapter.sourceHref === "string" ? { sourceHref: chapter.sourceHref } : {}), paragraphs };
  });
  return { ...book, editionId: selectedId, edition: selected, chapters };
}
