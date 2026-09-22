import type {ShelfStore} from "./book-shelf";
// WHY：显示名独立保存，不改导入标题、文件名、版本身份或引用锚点。数据库边界沿用同步事务语义。
export function ensureBookDisplayTitles(db: ShelfStore): void {
  db.exec("CREATE TABLE IF NOT EXISTS book_display_titles (book_id TEXT PRIMARY KEY, display_title TEXT NOT NULL)");
}
export function bookDisplayTitles(db: ShelfStore): Record<string,string> {
  ensureBookDisplayTitles(db);
  const rows = db.prepare("SELECT book_id AS bookId, display_title AS displayTitle FROM book_display_titles").all() as {bookId:string;displayTitle:string}[];
  return Object.fromEntries(rows.map(row => [row.bookId,row.displayTitle]));
}
export function normalizeDisplayTitle(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("显示书名必须是文字");
  const title=value.trim();
  if (!title || title.length > 200 || /[\u0000-\u001f\u007f]/u.test(title)) throw new Error("显示书名应为 1–200 个字符，不能包含控制字符");
  return title;
}
export function setBookDisplayTitle(db: ShelfStore, bookId: string, value: string | null): boolean {
  ensureBookDisplayTitles(db);
  if (!db.prepare("SELECT id FROM books WHERE id = ?").get(bookId)) return false;
  if (value === null) db.prepare("DELETE FROM book_display_titles WHERE book_id = ?").run(bookId);
  else db.prepare("INSERT INTO book_display_titles (book_id,display_title) VALUES (?,?) ON CONFLICT(book_id) DO UPDATE SET display_title=excluded.display_title").run(bookId,value);
  return true;
}
