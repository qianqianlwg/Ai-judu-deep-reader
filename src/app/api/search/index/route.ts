import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readEmbeddingConfig } from "@/lib/embedding-store";
import { createVectorIndexJobs } from "@/lib/vector-index-jobs";
import { vectorIndexStatus } from "@/lib/vector-index";
export const runtime = "nodejs";
const jobs = createVectorIndexJobs();
function editionId(body: unknown): string | null {
  return body !== null && typeof body === "object" && "editionId" in body && typeof body.editionId === "string" && body.editionId.trim()
    ? body.editionId.trim() : null;
}
export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const id = editionId(body);
    if (!id || !body || typeof body !== "object" || !("consent" in body) || body.consent !== true)
      return NextResponse.json({ error: "缺少版本或尚未确认将本书文字发送至 SiliconFlow" }, { status: 400 });
    const db = getDb();
    const job = jobs.start(db, id, readEmbeddingConfig(db));
    return NextResponse.json({ ...vectorIndexStatus(db, id), configured: true, job });
  } catch (cause: unknown) {
    console.error("启动向量索引失败", { name: cause instanceof Error ? cause.name : "UnknownError" });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "索引任务启动失败" }, { status: 400 });
  }
}
export async function DELETE(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const id = editionId(body);
    if (!id) return NextResponse.json({ error: "缺少书籍版本" }, { status: 400 });
    const db = getDb();
    return NextResponse.json({ ...vectorIndexStatus(db, id), configured: Boolean(readEmbeddingConfig(db).apiKey), job: jobs.pause(db, id) });
  } catch (cause: unknown) {
    console.error("暂停向量索引失败", { name: cause instanceof Error ? cause.name : "UnknownError" });
    return NextResponse.json({ error: "暂停失败，请重试" }, { status: 503 });
  }
}
