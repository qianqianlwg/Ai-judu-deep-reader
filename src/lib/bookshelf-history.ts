import type {LibraryBook} from "./library";
export const SHELF_HISTORY_PREFIX = "judu:resume-meta:";
export type ShelfHistory = {editionId: string; updatedAt: number; location: string};
export function readShelfHistory(storage: Pick<Storage,"getItem">, books: readonly LibraryBook[]): Record<string,ShelfHistory> {
  const result: Record<string,ShelfHistory> = {};
  for (const book of books) {
    const raw = storage.getItem(SHELF_HISTORY_PREFIX + book.id); if (!raw) continue;
    let value: unknown;
    try { value = JSON.parse(raw); } catch (cause: unknown) { console.warn("阅读摘要格式无效", book.id, cause); continue; }
    if (!value || typeof value !== "object" || !("editionId" in value) || typeof value.editionId !== "string"
      || !("updatedAt" in value) || typeof value.updatedAt !== "number" || !Number.isSafeInteger(value.updatedAt) || value.updatedAt <= 0 || value.updatedAt > 8_640_000_000_000_000
      || !("location" in value) || typeof value.location !== "string" || value.location.length > 300
      || !book.editions?.some(e => e.id === value.editionId)) continue;
    result[book.id] = {editionId:value.editionId, updatedAt:value.updatedAt, location:value.location};
  }
  return result;
}
export function writeShelfHistory(storage: Pick<Storage,"setItem">, bookId: string, value: ShelfHistory): void {
  // WHY：只保存书架展示摘要，不替代原始锚点；版本和阅读定位仍沿用既有恢复流程。
  storage.setItem(SHELF_HISTORY_PREFIX + bookId, JSON.stringify(value));
}
