import type {LibraryBook} from "@/lib/library";
export type ShelfSort = "recent" | "imported" | "title";
export type ShelfStatus = "all" | "reading" | "unread";
export function formatName(value: string): string { return value.replace(/^\./u, "").toUpperCase(); }
export function shelfTitle(book: LibraryBook): string { return book.displayTitle || book.title; }
export function coverTone(id: string): number { return [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4; }
export function selectShelfBooks(books: readonly LibraryBook[], options: {
  query: string; format: string; status: ShelfStatus; sort: ShelfSort;
  resumes: Readonly<Record<string, string>>; recent?: Readonly<Record<string, number>>;
}): LibraryBook[] {
  const terms = options.query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const timestamp = (book: LibraryBook) => Date.parse(book.createdAt ?? "") || 0;
  return books.filter(book => {
    const text = [shelfTitle(book), book.title, book.author, book.id, ...(book.editions ?? []).flatMap(e => [e.fileName, e.id])].join(" ").toLocaleLowerCase();
    return terms.every(term => text.includes(term))
      && (!options.format || book.editions?.some(e => formatName(e.fileType) === options.format))
      && (options.status === "all" || Boolean(options.resumes[book.id]) === (options.status === "reading"));
  }).sort((a, b) => {
    if (options.sort === "title") return shelfTitle(a).localeCompare(shelfTitle(b), "zh-CN") || a.id.localeCompare(b.id);
    if (options.sort === "recent") {
      const delta = (options.recent?.[b.id] ?? 0) - (options.recent?.[a.id] ?? 0);
      if (delta) return delta;
    }
    return timestamp(b) - timestamp(a) || a.id.localeCompare(b.id);
  });
}
