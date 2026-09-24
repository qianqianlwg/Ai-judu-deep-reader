import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readEmbeddingConfig } from "@/lib/embedding-store";
import { createBookRetrieval } from "@/lib/book-retrieval";
import { createQueryEmbeddingSession } from "@/lib/query-embedding";
import { retrievalModeSchema } from "@/lib/retrieval-report";
import { buildSearchResponse, normalizeSearchQuery } from "@/lib/book-search";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
 const params=request.nextUrl.searchParams, editionId=params.get("editionId")?.trim(),query=normalizeSearchQuery(params.get("q")??"");
 if(!editionId||!query)return NextResponse.json({error:"缺少书籍版本或查询内容"},{status:400});
 if(params.has("embedding"))return NextResponse.json({error:"不再接受外部 embedding，请使用 retrieval=semantic 或 hybrid"},{status:400});
 if(params.has("sourceType")&&params.get("sourceType")!=="book")return NextResponse.json({error:"当前检索仅包含本书正文"},{status:400});
 const mode=retrievalModeSchema.safeParse(params.get("retrieval")??"keyword");
 if(!mode.success||query.length>500)return NextResponse.json({error:"检索方式不合法，或查询超过 500 字符"},{status:400});
 const raw=Number(params.get("limit")??20),limit=Number.isFinite(raw)?Math.min(100,Math.max(1,Math.trunc(raw))):20;
 try {
  const db=getDb(),config=readEmbeddingConfig(db);
  const retrieve=createBookRetrieval({db,editionId,config,embeddings:createQueryEmbeddingSession(config)});
  const result=await retrieve({query,chapterId:params.get("chapterId"),limit,mode:mode.data,signal:request.signal});
  if(result.retrieval.effectiveMode==="none")return NextResponse.json({error:result.retrieval.branches.find(b=>b.reason)?.reason??"检索不可用",retrieval:result.retrieval},{status:503});
  return NextResponse.json({...buildSearchResponse({query,mode:params.get("mode")==="concept"?"concept":"search",results:result.results}),retrieval:result.retrieval});
 }catch(error:unknown){console.error("书内检索失败",{name:error instanceof Error?error.name:"UnknownError"});return NextResponse.json({error:"书内检索失败，请重试"},{status:503});}
}
