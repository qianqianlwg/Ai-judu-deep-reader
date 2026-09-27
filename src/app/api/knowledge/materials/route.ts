import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readMaterialQuery } from "@/lib/knowledge-materials";
import { readKnowledgeMaterials } from "@/lib/knowledge-material-reader";
export const runtime = "nodejs";
export async function GET(request:NextRequest){
  let query:ReturnType<typeof readMaterialQuery>;
  try{query=readMaterialQuery(request.nextUrl.searchParams);}
  catch(error:unknown){return NextResponse.json({error:error instanceof Error?error.message:"检索参数不合法"},{status:400});}
  try{return NextResponse.json(readKnowledgeMaterials(getDb(),query),{headers:{"Cache-Control":"no-store"}});}
  catch(error:unknown){console.error("读取知识材料失败",error);return NextResponse.json({error:"知识库读取失败，请重试"},{status:500});}
}
