import type { LibraryBook, LibraryEdition } from "@/lib/library";
export type { LibraryBook as WorkspaceBook, LibraryEdition as WorkspaceEdition } from "@/lib/library";

export function editionImportTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "导入时间未记录" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}
export function editionLabel(edition: LibraryEdition): string {
  return (edition.fileName || "文件名未记录") + " · " + editionImportTime(edition.createdAt);
}
export function editionActionLabel(book: LibraryBook, edition: LibraryEdition): string {
  return "阅读《" + book.title + "》 · " + editionLabel(edition) + " · 版本 " + edition.id + " · 书籍 " + book.id;
}
