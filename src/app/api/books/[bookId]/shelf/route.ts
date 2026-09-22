import {NextRequest,NextResponse} from 'next/server';
import {getDb} from '@/lib/db';
import {setBookArchived} from '@/lib/book-shelf';
export const runtime='nodejs';
export async function PATCH(request:NextRequest,{params}:{params:Promise<{bookId:string}>}){
 const {bookId}=await params;
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(bookId))return NextResponse.json({error:'书籍 ID 不合法'},{status:400});
 let body:unknown;
 try{body=await request.json();}catch{return NextResponse.json({error:'请求必须是有效 JSON'},{status:400});}
 if(!body||typeof body!=='object'||Array.isArray(body)||!('archived' in body)||typeof body.archived!=='boolean')return NextResponse.json({error:'请明确指定下架或恢复状态'},{status:400});
 try{
  if(!setBookArchived(getDb(),bookId,body.archived))return NextResponse.json({error:'书籍不存在，请刷新书架'},{status:404});
  return NextResponse.json({bookId,archived:body.archived},{headers:{'Cache-Control':'no-store'}});
 }catch(error:unknown){console.error('更新书架状态失败',error);return NextResponse.json({error:'书架状态更新失败，请重试；书籍内容未删除'},{status:500});}
}
