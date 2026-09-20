import {NextResponse} from "next/server";
import {getDb} from "@/lib/db";
import {isConversationId} from "@/lib/conversations";
import {OriginalFileError,originalRelativePath,readStoredOriginalFile} from "@/lib/data-storage";
import {publishMobiFile} from "@/lib/mobi-publication-server";
import type {MobiPublication} from "@/lib/mobi-publication-model";
export const runtime="nodejs";
const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
const fail=(status:number,code:string,error:string)=>NextResponse.json({error,code},{status,headers});
// WHY：同一原件并发请求共享解析；仅保留一份小布局，限制大书常驻内存，也不另建可遗留的公开缓存目录。
let cached:{key:string;value:MobiPublication}|null=null;
let pending:{key:string;job:Promise<MobiPublication>}|null=null;
export async function GET(request:Request,context:{params:Promise<{bookId:string}>}){
 try{
  const {bookId}=await context.params,query=new URL(request.url).searchParams;
  if([...query.keys()].some(key=>key!=="editionId")||query.getAll("editionId").length!==1||!isConversationId(query.get("editionId")))return fail(400,"INVALID_EDITION","请提供唯一合法的 editionId");
  if(!isConversationId(bookId))return fail(404,"NOT_FOUND","书籍或版本不存在");
  const edition=getDb().prepare(`SELECT e.id,e.file_type AS fileType,e.original_file_path AS relativePath,e.original_file_size AS size,e.original_hash AS originalHash FROM editions e JOIN books b ON b.id=e.book_id WHERE b.id=? AND e.id=?`).get(bookId,query.get("editionId")) as {id:string;fileType:string;relativePath:string|null;size:number;originalHash:string|null}|undefined;
  if(!edition)return fail(404,"NOT_FOUND","当前书籍不存在此版本");
  if(edition.fileType!==".mobi")return fail(415,"UNSUPPORTED_FORMAT","此接口仅用于MOBI原版");
  if(!edition.relativePath)return fail(404,"ORIGINAL_NOT_AVAILABLE","未保存MOBI原件，请重新导入；已有文本和标注仍可使用");
  if(edition.relativePath.replaceAll('\\','/')!==originalRelativePath(edition.id,".mobi"))return fail(409,"CORRUPT_FILE","原文件归属元数据损坏");
  const key=edition.id+':'+edition.originalHash;
  // WHY：在读取最多100MiB原件前准入；同版本共享IO与解析，其他版本立即429，不能读完大文件才限流。
  if(pending&&pending.key!==key)return fail(429,"LAYOUT_BUSY","正在准备另一本MOBI，请稍后重试");
  const active=pending??{key,job:(async()=>{
   // WHY：即使缓存命中仍核验磁盘原件，删除/篡改后不发布旧副本；校验也在single-flight内。
   const bytes=await readStoredOriginalFile({relativePath:edition.relativePath!,size:edition.size,originalHash:edition.originalHash??""});
   if(cached?.key===key)return cached.value;
   const value=await publishMobiFile(bytes);
   if(JSON.stringify(value).length<=8*1024*1024)cached={key,value};
   return value;
  })()};pending=active;
  try{return NextResponse.json(await active.job,{headers});}
  finally{if(pending===active)pending=null;}
 }catch(cause:unknown){
  console.error("MOBI原版准备失败",cause);
  if(cause instanceof OriginalFileError)return fail(cause.code==="MISSING_FILE"?404:409,cause.code,cause.message);
  return fail(422,"MOBI_LAYOUT_FAILED","MOBI原版准备失败：文件可能损坏、包含加密或超出支持范围；可切回精读，原文件与标注未改动。");
 }
}
