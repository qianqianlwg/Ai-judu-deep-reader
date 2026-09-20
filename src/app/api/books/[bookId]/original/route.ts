import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isConversationId } from "@/lib/conversations";

import { isStoredOriginalExtension, OriginalFileError, originalRelativePath, readStoredOriginalFile } from "@/lib/data-storage";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'" };
const fail = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status, headers });
export async function GET(request: Request, context: { params: Promise<{ bookId: string }> }) {
  try {
    const { bookId } = await context.params;
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== "editionId") || query.getAll("editionId").length !== 1 || !isConversationId(query.get("editionId"))) return fail(400, "INVALID_EDITION", "请提供唯一合法的 editionId 版本参数");
    if (!isConversationId(bookId)) return fail(404, "NOT_FOUND", "书籍或版本不存在");
    const edition = getDb().prepare(`SELECT e.id, e.file_type AS fileType, e.original_file_path AS relativePath,
      e.original_file_size AS size, e.original_hash AS originalHash FROM editions e
      JOIN books b ON b.id = e.book_id WHERE b.id = ? AND e.id = ?`).get(bookId, query.get("editionId")) as { id: string; fileType: string; relativePath: string; size: number; originalHash: string | null } | undefined;
    if (!edition) return fail(404, "NOT_FOUND", "当前书籍不存在此版本");
    if (!edition.relativePath) return fail(404, "ORIGINAL_NOT_AVAILABLE", "此旧版本未保存原文件，请重新导入；现有文本和标注仍可使用");
    const extension = edition.fileType.startsWith(".") ? edition.fileType : "." + edition.fileType;
    // WHY：数据库路径也视为不可信；即使是合法相对路径，也不能把另一个版本的原件交给当前版本。
    if (!isStoredOriginalExtension(extension) || edition.relativePath.replaceAll("\\", "/") !== originalRelativePath(edition.id, extension)) return fail(409, "CORRUPT_FILE", "原文件归属元数据损坏，请重新导入");
    const buffer = await readStoredOriginalFile({ relativePath: edition.relativePath, size: edition.size, originalHash: edition.originalHash ?? "" });
    return new Response(new Uint8Array(buffer), { headers: { ...headers,
      // WHY：只交付原始容器字节，不解包或直接提供 EPUB HTML；固定安全下载名不使用不可信上传文件名。
      "Content-Type": extension === ".epub" ? "application/epub+zip" : "application/octet-stream",
      "Content-Disposition": `attachment; filename="original${extension}"`, "Content-Length": String(buffer.byteLength),
    } });
  } catch (error: unknown) {
    console.error("原文件读取失败", error);
    if (error instanceof OriginalFileError) return fail(error.code === "MISSING_FILE" ? 404 : 409, error.code, error.message);
    return fail(500, "ORIGINAL_READ_FAILED", "原文件读取失败，请检查存储权限后重试");
  }
}
