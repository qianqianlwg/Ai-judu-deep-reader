import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createReadingMarksStore, ReadingMarkError, readingMarksEditionQuery } from "@/lib/reading-marks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 2 * 1024 * 1024;
// WHY：路由是组合根，统一装配数据库、时钟和 ID；业务模块不隐式打开真实书架数据库。
function store() { return createReadingMarksStore({ db: getDb(), newId: randomUUID, now: () => new Date().toISOString() }); }
function failure(error: unknown) {
  if (error instanceof ReadingMarkError) {
    // WHY：校验失败可恢复，但日志不输出私人笔记、原文或请求体。
    console.warn("阅读标注请求被拒绝", { code: error.code, status: error.status });
    return NextResponse.json({ error: error.message, code: error.code, recoverable: true }, { status: error.status, headers });
  }
  console.error("阅读标注服务失败", error);
  return NextResponse.json({ error: "标注服务暂时不可用，请稍后重试；原文和其他标注不会被覆盖", code: "storage_error", recoverable: true }, { status: 500, headers });
}
async function readJson(request: Request): Promise<unknown> {
  if (new URL(request.url).search) throw new ReadingMarkError("invalid_query", "写入和删除请仅使用 JSON 请求体，不要同时提供查询参数");
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new ReadingMarkError("unsupported_media_type", "请使用 application/json 提交标注", 415);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) throw new ReadingMarkError("payload_too_large", "标注请求超过 2 MiB，请缩短笔记或分段保存", 413);
  if (!request.body) throw new ReadingMarkError("invalid_json", "请求内容不能为空，请提交合法 JSON");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ReadingMarkError("payload_too_large", "标注请求超过 2 MiB，请缩短笔记或分段保存", 413);
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch (error: unknown) {
    console.warn("阅读标注请求无法解码", { name: error instanceof Error ? error.name : "UnknownError" });
    throw new ReadingMarkError("invalid_json", "请求必须是合法的 UTF-8 JSON，请重新提交");
  }
}
export async function GET(request: Request) {
  try {
    const editionId = readingMarksEditionQuery(new URL(request.url).searchParams);
    return NextResponse.json({ editionId, marks: store().list(editionId) }, { headers });
  } catch (error: unknown) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const result = store().save(body);
    return NextResponse.json(result, { status: result.created ? 201 : 200, headers });
  } catch (error: unknown) { return failure(error); }
}
export async function DELETE(request: Request) {
  try {
    const body = await readJson(request);
    return NextResponse.json(store().remove(body), { headers });
  } catch (error: unknown) { return failure(error); }
}
