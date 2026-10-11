import {NextRequest,NextResponse} from 'next/server';
import {getDb} from '@/lib/db';import {getJuduDataDir} from '@/lib/data-storage';
import {deleteArchivedBook} from '@/lib/book-deletion';import {removeBookDeletionFile} from '@/lib/book-deletion-files';import {BookDeletionError} from '@/lib/book-deletion-store';
export const runtime='nodejs';const inFlight=new Set<string>();
export async function DELETE(request:NextRequest,{params}:{params:Promise<{bookId:string}>}){
 const {bookId}=await params;const headers={'Cache-Control':'no-store'};
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(bookId))return NextResponse.json({error:'书籍 ID 不合法'},{status:400,headers});
 let body:unknown;try{body=await request.json();}catch{return NextResponse.json({error:'请明确确认永久删除当前书籍'},{status:400,headers});}
 if(!body||typeof body!=='object'||Array.isArray(body)||!('confirmBookId'in body)||body.confirmBookId!==bookId)return NextResponse.json({error:'删除确认与书籍身份不匹配'},{status:400,headers});
 try{const dataDir=getJuduDataDir();return NextResponse.json(await deleteArchivedBook({db:getDb(),inFlight,removeFile:file=>removeBookDeletionFile(file,dataDir)},bookId),{headers});}
 catch(cause:unknown){console.error('永久删除书籍失败',cause);return NextResponse.json({error:cause instanceof BookDeletionError?cause.message:'永久删除失败，请重试；未返回删除成功'}, {status:cause instanceof BookDeletionError?cause.status:500,headers});}
}
