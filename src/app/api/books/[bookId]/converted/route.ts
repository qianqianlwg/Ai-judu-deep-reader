import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isConversationId } from "@/lib/conversations";
import { OriginalFileError, derivedRelativePath, originalRelativePath, readDerivedEpub, readStoredOriginalFile } from "@/lib/data-storage";
import { readConversionSources } from "@/lib/edition-conversion";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'" };
const fail = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status, headers });
type Row = { id: string; fileType: string; originalPath: string; originalSize: number; originalHash: string | null;
  sourceHash: string; format: string; relativePath: string; size: number; fileHash: string; converterVersion: string; sourceMap: string };
export async function GET(request: Request, context: { params: Promise<{ bookId: string }> }) {
  try {
    const { bookId } = await context.params, query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== "editionId") || query.getAll("editionId").length !== 1 || !isConversationId(query.get("editionId"))) return fail(400, "INVALID_EDITION", "请提供唯一合法的 editionId");
    if (!isConversationId(bookId)) return fail(404, "NOT_FOUND", "书籍或版本不存在");
    const row = getDb().prepare(`SELECT e.id,e.file_type AS fileType,e.original_file_path AS originalPath,e.original_file_size AS originalSize,e.original_hash AS originalHash,
      c.source_hash AS sourceHash,c.target_format AS format,c.file_path AS relativePath,c.file_size AS size,c.file_hash AS fileHash,c.converter_version AS converterVersion,c.source_map_json AS sourceMap
      FROM editions e JOIN books b ON b.id=e.book_id JOIN edition_conversions c ON c.edition_id=e.id WHERE b.id=? AND e.id=?`).get(bookId, query.get("editionId")) as Row | undefined;
    if (!row) return fail(404, "CONVERSION_NOT_AVAILABLE", "此书籍版本没有已保存的转换版");
    // WHY：原件身份、派生物归属和固定路径均核验，不能用另一版本的文件或把派生EPUB当UMD原件下载。
    if (row.fileType !== ".umd" || row.format !== ".epub" || row.converterVersion !== "umd-epub-v1" || row.sourceHash !== row.originalHash
      || row.relativePath !== derivedRelativePath(row.id) || row.originalPath !== originalRelativePath(row.id, ".umd")) return fail(409, "CORRUPT_CONVERSION", "转换版关联元数据损坏，请重新导入");
    try { readConversionSources(JSON.parse(row.sourceMap) as unknown); }
    catch (cause: unknown) { console.error("转换版来源映射损坏", cause); return fail(409, "CORRUPT_CONVERSION", "转换版来源映射损坏，请重新导入"); }
    await readStoredOriginalFile({ relativePath: row.originalPath, size: row.originalSize, originalHash: row.sourceHash });
    const bytes = await readDerivedEpub({ relativePath: row.relativePath, size: row.size, fileHash: row.fileHash });
    return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "application/epub+zip", "Content-Disposition": 'attachment; filename="converted.epub"', "Content-Length": String(bytes.length) } });
  } catch (cause: unknown) {
    console.error("转换版读取失败", cause);
    if (cause instanceof OriginalFileError) return fail(cause.code === "MISSING_FILE" ? 404 : 409, cause.code, "原件或转换版文件丢失、损坏或路径不安全，请重新导入");
    return fail(500, "CONVERSION_READ_FAILED", "转换版读取失败，请检查存储权限后重试");
  }
}
