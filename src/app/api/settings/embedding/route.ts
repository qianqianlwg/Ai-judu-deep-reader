import {NextRequest,NextResponse} from 'next/server';
import {getDb} from '@/lib/db';
import {readEmbeddingConfig,saveEmbeddingConfig} from '@/lib/embedding-store';
import {EMBEDDING_MODEL,EMBEDDING_URL,EMBEDDING_DIMENSIONS,embedTexts,EmbeddingError} from '@/lib/embedding-provider';
export const runtime='nodejs';
export async function GET(){return NextResponse.json({model:EMBEDDING_MODEL,url:EMBEDDING_URL,dimensions:EMBEDDING_DIMENSIONS,hasApiKey:Boolean(readEmbeddingConfig(getDb()).apiKey)});}
export async function PUT(request:NextRequest){
 try{const body:unknown=await request.json();if(!body||typeof body!=='object'||!('apiKey' in body))return NextResponse.json({error:'请输入 API Key'},{status:400});saveEmbeddingConfig(getDb(),body.apiKey);return GET();}
 catch(error:unknown){console.error('保存向量配置失败',{name:error instanceof Error?error.name:'UnknownError'});return NextResponse.json({error:'保存失败，请检查 API Key 格式'},{status:400});}
}
export async function POST(request:NextRequest){
 try{await embedTexts(readEmbeddingConfig(getDb()),['连接测试'],request.signal);return NextResponse.json({ok:true,message:'向量服务连接成功'});}
 catch(error:unknown){return NextResponse.json({error:error instanceof EmbeddingError?error.message:'连接测试失败'},{status:502});}
}
