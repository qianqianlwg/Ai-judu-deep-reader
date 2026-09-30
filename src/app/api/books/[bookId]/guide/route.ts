import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { guideChangeSchema, changeGuide, GuideError } from "@/lib/guide";
import { guideNodes, guideTransaction, navigateGuideHistory, readGuideState, requireGuideVersion, restoreGuideRevision, saveGuideRevision } from "@/lib/guide-store";
import { enqueueGuideSource, historicalGuideIds, readGuideSources } from "@/lib/guide-sources";
export const runtime = "nodejs";
type Context = { params: Promise<{ bookId: string }> };
const headers = { "Cache-Control": "no-store" };
const base = { version: z.number().int().nonnegative() };
const bodySchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("change"), change: guideChangeSchema }).strict(),
  z.object({ ...base, action: z.enum(["undo", "redo", "retry", "import-history"]) }).strict(),
  z.object({ ...base, action: z.literal("restore"), revisionId: z.number().int().positive() }).strict(),
]);
function failure(error: unknown) {
  if (error instanceof GuideError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "导读请求格式不正确" }, { status: 400, headers });
  console.error("导读接口失败", { name: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: "导读暂时无法保存，请重试；原有内容已保留" }, { status: 500, headers });
}
function snapshot(db: ReturnType<typeof getDb>, bookId: string) { return { ...readGuideState(db, bookId), historicalCount: historicalGuideIds(db, bookId).length }; }
export async function GET(request: Request, context: Context) {
  try {
    const { bookId } = await context.params, db = getDb();
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== "sourceId") || query.getAll("sourceId").length > 100) throw new GuideError("导读查询参数不正确");
    if (!db.prepare("SELECT id FROM books WHERE id=?").get(bookId)) throw new GuideError("这本书不存在", 404);
    return NextResponse.json(query.has("sourceId") ? { sources: readGuideSources(db, bookId, query.getAll("sourceId")) } : snapshot(db, bookId), { headers });
  } catch (error: unknown) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const { bookId } = await context.params, body = bodySchema.parse(await request.json()), db = getDb();
    guideTransaction(db, () => {
      const head = requireGuideVersion(db, bookId, body.version);
      switch (body.action) {
        case "change": { const next = changeGuide(guideNodes(db, head.current_revision), body.change); saveGuideRevision(db, bookId, body.version, next.nodes, "user", next.reason); break; }
        case "undo": case "redo": navigateGuideHistory(db, bookId, body.version, body.action); break;
        case "restore": restoreGuideRevision(db, bookId, body.version, body.revisionId); break;
        case "retry": db.prepare("UPDATE guide_sources SET status='pending',attempts=0,next_attempt=0,error=NULL WHERE book_id=? AND status='failed'").run(bookId); break;
        case "import-history": for (const id of historicalGuideIds(db, bookId)) enqueueGuideSource(db, id); break;
      }
    });
    return NextResponse.json(snapshot(db, bookId), { headers });
  } catch (error: unknown) { return failure(error); }
}
