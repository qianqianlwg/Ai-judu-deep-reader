import {NextResponse} from "next/server";
import {getDb} from "@/lib/db";
import {originalRelativePath,readStoredOriginalFile} from "@/lib/data-storage";
import {cachedBookCover,renderBookCover} from "@/lib/book-cover";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{bookId:string}>}) {
  const {bookId}=await params;const query=new URL(request.url).searchParams,editionId=query.get("editionId");
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(bookId)||!editionId||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(editionId)||query.getAll("editionId").length!==1)return NextResponse.json({error:"书籍版本参数无效"},{status:400});
  try {
    const edition=getDb().prepare("SELECT id, file_type AS fileType, original_file_path AS relativePath, original_file_size AS size, original_hash AS originalHash FROM editions WHERE book_id=? AND id=?").get(bookId,editionId) as {id:string;fileType:string;relativePath:string;size:number;originalHash:string}|undefined;
    if(!edition)return NextResponse.json({error:"书籍版本不存在"},{status:404});
    const format=edition.fileType.startsWith(".")?edition.fileType:"."+edition.fileType;
    if((format!==".epub"&&format!==".pdf")||!edition.relativePath)return new Response(null,{status:204,headers:{"Cache-Control":"private, max-age=3600"}});
    if(edition.relativePath.replaceAll("\\","/")!==originalRelativePath(edition.id,format))return NextResponse.json({error:"原文件归属无效"},{status:409});
    const image=await cachedBookCover(edition.originalHash,async()=>renderBookCover(await readStoredOriginalFile(edition),format));
    if(!image)return new Response(null,{status:204,headers:{"Cache-Control":"private, max-age=3600"}});
    return new Response(new Uint8Array(image),{headers:{"Content-Type":"image/webp","Content-Length":String(image.length),"Cache-Control":"private, max-age=86400","X-Content-Type-Options":"nosniff"}});
  } catch(cause:unknown){console.error("书籍封面生成失败",cause);return NextResponse.json({error:"封面暂不可用，可重试；阅读不受影响"},{status:500,headers:{"Cache-Control":"no-store"}});}
}
