import {NextRequest,NextResponse} from 'next/server';
import {getDb} from '@/lib/db';
import {readEmbeddingConfig} from '@/lib/embedding-store';
import {buildVectorBatch} from '@/lib/vector-index';
export const runtime='nodejs';
export async function POST(request:NextRequest){
 try{const body:unknown=await request.json();if(!body||typeof body!=='object'||!('editionId' in body)||typeof body.editionId!=='string'||!body.editionId.trim()||!('consent' in body)||body.consent!==true)return NextResponse.json({error:'缺少版本或尚未确认将本书文字发送至 SiliconFlow'},{status:400});
  const db=getDb();return NextResponse.json(await buildVectorBatch(db,body.editionId,readEmbeddingConfig(db),request.signal));
 }catch(error:unknown){console.error('建立向量索引失败',{name:error instanceof Error?error.name:'UnknownError'});return NextResponse.json({error:error instanceof Error?error.message:'建立索引失败，可重试继续'},{status:400});}
}
