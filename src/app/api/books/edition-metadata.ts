import type { LibraryEdition } from "@/lib/library";
// WHY：所有书架入口复用显式公开字段白名单，绝不把 SQLite 行 spread 到 JSON 中泄露内部存储路径。
export const EDITION_COLUMNS = "id, book_id AS bookId, file_name AS fileName, file_type AS fileType, original_file_path != '' AS hasOriginalFile, original_file_size AS fileSize, original_hash AS originalHash, created_at AS createdAt";
export type EditionRow = { id: string; bookId: string; fileName: string; fileType: string; hasOriginalFile: number; fileSize: number; originalHash: string | null; createdAt: string };
export function publicEdition(row: EditionRow): LibraryEdition {
  return { id: row.id, fileName: row.fileName, fileType: row.fileType, hasOriginalFile: Boolean(row.hasOriginalFile), fileSize: row.fileSize,
    ...(row.originalHash ? { originalHash: row.originalHash } : {}), readerMode: "text", createdAt: row.createdAt };
}
