import { readLibraryConversion, type LibraryEdition } from "@/lib/library";

// WHY：所有书架入口复用显式公开字段白名单，绝不把 SQLite 行 spread 到 JSON 中泄露内部存储路径。
// WHY：相关子查询只增加一个可空字段，不JOIN扩张版本行，也不改变现有WHERE/ORDER BY/LIMIT的形状。
export const EDITION_COLUMNS = "id, book_id AS bookId, file_name AS fileName, file_type AS fileType, original_file_path != '' AS hasOriginalFile, original_file_size AS fileSize, original_hash AS originalHash, created_at AS createdAt, "
  + "(SELECT json_object('format', target_format, 'sourceHash', source_hash, 'fileHash', file_hash, 'fileSize', file_size, 'converterVersion', converter_version, 'createdAt', created_at) FROM edition_conversions WHERE edition_id = editions.id) AS conversionJson";
export type EditionRow = {
  id: string; bookId: string; fileName: string; fileType: string; hasOriginalFile: number;
  fileSize: number; originalHash: string | null; createdAt: string; conversionJson?: string | null;
};

export function publicEdition(row: EditionRow): LibraryEdition {
  const edition: LibraryEdition = {
    id: row.id, fileName: row.fileName, fileType: row.fileType, hasOriginalFile: Boolean(row.hasOriginalFile), fileSize: row.fileSize,
    ...(row.originalHash ? { originalHash: row.originalHash } : {}), readerMode: "text", createdAt: row.createdAt,
  };
  // WHY：只有SQL NULL/旧mock缺少字段表示无转换；空串、JSON null或坏JSON不能被当成旧版本默默降级。
  if (row.conversionJson !== undefined && row.conversionJson !== null) {
    if (typeof row.conversionJson !== "string") throw new Error("转换版本JSON字段类型无效");
    let conversion: unknown;
    try { conversion = JSON.parse(row.conversionJson); }
    catch (cause: unknown) { throw new Error("转换版本JSON无效", { cause }); }
    edition.conversion = readLibraryConversion(conversion, edition);
  }
  return edition;
}
