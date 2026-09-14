export type LibraryEdition = { id: string; fileName: string; fileType: string; createdAt: string };
export type LibraryBook = { id: string; title: string; author: string; createdAt?: string; editions?: readonly LibraryEdition[] };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0;

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
        if (!record(item) || !identifier(item.id) || typeof item.fileName !== "string" || typeof item.fileType !== "string" || typeof item.createdAt !== "string" || editionIds.has(item.id)) throw new Error("版本数据不完整或EditionID重复");
        editionIds.add(item.id);
        return { id: item.id, fileName: item.fileName, fileType: item.fileType, createdAt: item.createdAt };
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
export type LibraryChapter = { id: string; title: string; paragraphs: LibraryParagraph[] };
export type LibraryBookContent = LibraryBook & { editionId?: string; edition?: LibraryEdition; chapters: LibraryChapter[] };
export function readBookResponse(value: unknown, bookId: string, editionId?: string): LibraryBookContent {
  if (!record(value) || value.id !== bookId || !Array.isArray(value.chapters) || (editionId !== undefined && value.editionId !== editionId)) throw new Error("返回的书籍或版本不匹配，未替换当前原文");
  const book = readLibraryResponse([value])[0];
  const selectedId = typeof value.editionId === "string" ? value.editionId : undefined;
  if (selectedId && book.editions && !book.editions.some(item => item.id === selectedId)) throw new Error("正文版本不属于返回的书籍");
  const chapters = value.chapters.map(chapter => {
    if (!record(chapter) || !identifier(chapter.id) || typeof chapter.title !== "string" || !Array.isArray(chapter.paragraphs)) throw new Error("章节数据不完整");
    const paragraphs = chapter.paragraphs.map(paragraph => {
      if (!record(paragraph) || !identifier(paragraph.id) || typeof paragraph.text !== "string") throw new Error("正文段落数据不完整");
      return { id: paragraph.id, text: paragraph.text };
    });
    return { id: chapter.id, title: chapter.title, paragraphs };
  });
  return { ...book, editionId: selectedId, edition: book.editions?.find(item => item.id === selectedId), chapters };
}
