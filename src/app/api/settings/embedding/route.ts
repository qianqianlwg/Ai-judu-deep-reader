import {NextRequest,NextResponse} from 'next/server';
import {getDb} from '@/lib/db';
import {readEmbeddingConfig,saveEmbeddingConfig,readAgentRetrievalEnabled,saveAgentRetrievalEnabled} from '@/lib/embedding-store';
import {EMBEDDING_MODEL,EMBEDDING_URL,EMBEDDING_DIMENSIONS,embedTexts,EmbeddingError} from '@/lib/embedding-provider';
export const runtime='nodejs';
export async function GET(){return NextResponse.json({model:EMBEDDING_MODEL,url:EMBEDDING_URL,dimensions:EMBEDDING_DIMENSIONS,hasApiKey:Boolean(readEmbeddingConfig(getDb()).apiKey),agentSemanticEnabled:readAgentRetrievalEnabled(getDb())});}
export async function PUT(request:NextRequest){
 try{const body:unknown=await request.json();if(!body||typeof body!=='object'||(!('apiKey' in body)&&!('agentSemanticEnabled' in body)))return NextResponse.json({error:'缺少向量配置'},{status:400});if('agentSemanticEnabled' in body&&typeof body.agentSemanticEnabled!=='boolean')return NextResponse.json({error:'自动检索设置不合法'},{status:400});const db=getDb();if('apiKey' in body)saveEmbeddingConfig(db,body.apiKey);if('agentSemanticEnabled' in body)saveAgentRetrievalEnabled(db,body.agentSemanticEnabled);return GET();}
 catch(error:unknown){console.error('保存向量配置失败',{name:error instanceof Error?error.name:'UnknownError'});return NextResponse.json({error:'保存失败，请检查 API Key 格式'},{status:400});}
}
export async function POST(request:NextRequest){
 try{await embedTexts(readEmbeddingConfig(getDb()),['连接测试'],request.signal);return NextResponse.json({ok:true,message:'向量服务连接成功'});}
 catch(error:unknown){return NextResponse.json({error:error instanceof EmbeddingError?error.message:'连接测试失败'},{status:502});}
}
