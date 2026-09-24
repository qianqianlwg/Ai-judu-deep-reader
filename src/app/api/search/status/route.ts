import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readEmbeddingConfig } from "@/lib/embedding-store";
import { vectorIndexStatus } from "@/lib/vector-index";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
 const editionId=request.nextUrl.searchParams.get("editionId")?.trim();
 if(!editionId)return NextResponse.json({error:"缺少 editionId"},{status:400});
 try {const db=getDb();return NextResponse.json({...vectorIndexStatus(db,editionId),configured:Boolean(readEmbeddingConfig(db).apiKey)});}
 catch(error:unknown){console.error("读取索引状态失败",{name:error instanceof Error?error.name:"UnknownError"});return NextResponse.json({error:"读取索引状态失败，请重试"},{status:503});}
}
