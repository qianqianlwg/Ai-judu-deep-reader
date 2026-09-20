import {NextResponse} from 'next/server';
import {getDb} from '@/lib/db';
import {isConversationId} from '@/lib/conversations';
import {isCbzFormat} from '@/lib/cbz-manifest';
import {readCbzPage} from '@/lib/cbz-archive';
import {OriginalFileError,originalRelativePath,readStoredOriginalFile} from '@/lib/data-storage';
export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'; frame-ancestors 'none'"};
const fail=(status:number,error:string)=>NextResponse.json({error},{status,headers});
export async function GET(request:Request,context:{params:Promise<{bookId:string}>}){
 try{
  const {bookId}=await context.params,query=new URL(request.url).searchParams,editionId=query.get('editionId'),pageText=query.get('page');
  if(!isConversationId(editionId)||query.getAll('editionId').length!==1||query.getAll('page').length!==1||!pageText||!/^[1-9]\d{0,3}$/u.test(pageText)||[...query.keys()].some(key=>!['editionId','page'].includes(key)))return fail(400,'请提供唯一有效的版本和图片页码');
  if(!isConversationId(bookId))return fail(404,'书籍不存在');
  const db=getDb(),edition=db.prepare('SELECT id,file_type AS fileType,original_file_path AS relativePath,original_file_size AS size,original_hash AS originalHash FROM editions WHERE book_id=? AND id=?').get(bookId,editionId) as {id:string;fileType:string;relativePath:string;size:number;originalHash:string}|undefined;
  if(!edition)return fail(404,'当前书籍不存在此版本');if(!isCbzFormat(edition.fileType))return fail(415,'此版本不是CBZ图片书');
  if(!edition.relativePath||edition.relativePath.replaceAll('\\','/')!==originalRelativePath(editionId,'.cbz'))return fail(409,'CBZ原件归属元数据损坏');
  const page=Number(pageText),chapter=db.prepare('SELECT id,source_href AS href FROM chapters WHERE edition_id=? ORDER BY order_index,id LIMIT 1 OFFSET ?').get(editionId,page-1) as {id:string;href:string}|undefined;
  if(!chapter)return fail(404,'CBZ图片页不存在');
  if(db.prepare('SELECT id FROM paragraphs WHERE chapter_id=? LIMIT 1').get(chapter.id))return fail(409,'CBZ版本出现不一致的文字索引');
  const bytes=await readStoredOriginalFile({relativePath:edition.relativePath,size:edition.size,originalHash:edition.originalHash});
  // WHY：CBZ逐页只交付核验的栅格图像，不提供任意ZIP资源地址；这不改变EPUB/FB2的原生章节运输方式。
  const image=await readCbzPage(bytes,page,chapter.href);
  return new Response(new Uint8Array(image.bytes),{headers:{...headers,'Content-Type':image.info.mime,'Content-Length':String(image.bytes.length),'Content-Disposition':'inline; filename="page-'+page+'.'+image.info.mime.slice(6)+'"','X-Judu-Image-Width':String(image.info.width),'X-Judu-Image-Height':String(image.info.height)}});
 }catch(cause:unknown){console.error('读取CBZ图片页失败',cause);if(cause instanceof OriginalFileError)return fail(cause.code==='MISSING_FILE'?404:409,cause.message);return fail(409,'CBZ图片页读取或校验失败，请重试；如原件已损坏请重新导入。');}
}
