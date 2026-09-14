import { NextRequest, NextResponse } from "next/server";
import { createAnnotation, dedupeAnnotations, type TextAnnotation } from "@/lib/annotations";
import { getDb } from "@/lib/db";
export const runtime = "nodejs";
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
function definitions(value: unknown): { name: string; text: string }[] {
  return Array.isArray(value) ? value.filter((v): v is {name:string;text:string} => isRecord(v) && typeof v.name === "string" && typeof v.text === "string") : [];
}
function rowToAnnotation(value: unknown): TextAnnotation | null {
  if (!isRecord(value)) return null;
  const r = value;
  if (typeof r.id !== "string" || typeof r.paragraph_id !== "string" || typeof r.start_offset !== "number" || typeof r.end_offset !== "number" || typeof r.thread_id !== "string" || typeof r.text_hash !== "string" || typeof r.summary !== "string" || typeof r.concepts !== "string" || typeof r.created_at !== "string") return null;
  try {
    const concepts: unknown = JSON.parse(r.concepts);
    const details: unknown = JSON.parse(typeof r.concept_details === "string" ? r.concept_details : "[]");
    return { id:r.id, paragraphId:r.paragraph_id, startOffset:r.start_offset, endOffset:r.end_offset, threadId:r.thread_id, textHash:r.text_hash, summary:r.summary, createdAt:r.created_at, concepts:Array.isArray(concepts)?concepts.filter((v):v is string => typeof v === "string"):[], conceptDetails:definitions(details), messageId:typeof r.message_id === "string" ? r.message_id : undefined };
  } catch (error: unknown) { console.error("读取标注结构失败",error); return null; }
}
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const clauses:string[] = []; const values:string[]=[];
    const editionId=params.get("editionId"); const paragraphId=params.get("paragraphId"); const threadId=params.get("threadId");
    if (editionId) { clauses.push("c.edition_id = ?"); values.push(editionId); }
    if (paragraphId) { clauses.push("a.paragraph_id = ?"); values.push(paragraphId); }
    if (threadId) { clauses.push("a.thread_id = ?"); values.push(threadId); }
    const rows = getDb().prepare("SELECT a.* FROM annotations a JOIN paragraphs p ON p.id = a.paragraph_id JOIN chapters c ON c.id = p.chapter_id" + (clauses.length ? " WHERE " + clauses.join(" AND ") : "") + " ORDER BY a.created_at ASC").all(...values);
    return NextResponse.json({ annotations:dedupeAnnotations(rows.map(rowToAnnotation).filter((r):r is TextAnnotation=>r!==null)) });
  } catch (error:unknown) { console.error("读取标注失败",error); return NextResponse.json({error:"读取标注失败"},{status:500}); }
}
export async function POST(request: NextRequest) {
  try {
    const body:unknown=await request.json();
    if (!isRecord(body) || typeof body.paragraphId !== "string") return NextResponse.json({error:"缺少段落位置"},{status:400});
    const db=getDb();
    const paragraph=db.prepare("SELECT text FROM paragraphs WHERE id = ?").get(body.paragraphId) as {text:string}|undefined;
    if (!paragraph) return NextResponse.json({error:"原文段落不存在"},{status:404});
    // WHY：位置与哈希只能用数据库的真实原文校验，不能信任客户端回传的一段字符串。
    const annotation=createAnnotation({ id:typeof body.id === "string"?body.id:undefined, paragraphId:body.paragraphId, startOffset:typeof body.startOffset === "number"?body.startOffset:-1, endOffset:typeof body.endOffset === "number"?body.endOffset:-1, threadId:typeof body.threadId === "string"?body.threadId:"", textHash:typeof body.textHash === "string"?body.textHash:undefined, summary:typeof body.summary === "string"?body.summary:"", concepts:Array.isArray(body.concepts)?body.concepts.filter((v):v is string=>typeof v === "string"):[], conceptDetails:definitions(body.conceptDetails), messageId:typeof body.messageId === "string"?body.messageId:undefined, createdAt:typeof body.createdAt === "string"?body.createdAt:new Date().toISOString() },paragraph.text);
    db.prepare("INSERT INTO annotations (id, paragraph_id, start_offset, end_offset, text_hash, thread_id, summary, concepts, created_at, concept_details, message_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET summary=excluded.summary, concepts=excluded.concepts, concept_details=excluded.concept_details, message_id=excluded.message_id").run(annotation.id,annotation.paragraphId,annotation.startOffset,annotation.endOffset,annotation.textHash,annotation.threadId,annotation.summary,JSON.stringify(annotation.concepts),annotation.createdAt,JSON.stringify(annotation.conceptDetails ?? []),annotation.messageId ?? null);
    return NextResponse.json({annotation},{status:201});
  } catch (error:unknown) { console.error("保存标注失败",error); return NextResponse.json({error:error instanceof Error?error.message:"保存标注失败"},{status:400}); }
}
