import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { GuideError } from '@/lib/guide';
import { readGuidePreparation,retryGuidePreparation } from '@/lib/guide-preparation';
export const runtime='nodejs';
type Context={params:Promise<{threadId:string}>};
const headers={'Cache-Control':'no-store'};
async function execute(request:Request,context:Context,retry:boolean){
 try{
  const {threadId}=await context.params,query=new URL(request.url).searchParams,editionId=query.get('editionId'),messageId=query.get('messageId');
  if(!editionId||!messageId||[...query.keys()].some(k=>k!=='editionId'&&k!=='messageId')||query.getAll('editionId').length!==1||query.getAll('messageId').length!==1)throw new GuideError('整理状态参数不正确');
  const scope={threadId,editionId,messageId};return NextResponse.json(retry?retryGuidePreparation(getDb(),scope):readGuidePreparation(getDb(),scope),{headers});
 }catch(error:unknown){
  if(error instanceof GuideError)return NextResponse.json({error:error.message},{status:error.status,headers});
  console.error('读取导图整理状态失败',error);return NextResponse.json({error:'导图整理状态读取失败，请重试。'},{status:500,headers});
 }
}
export async function GET(request:Request,context:Context){return execute(request,context,false);}
export async function POST(request:Request,context:Context){return execute(request,context,true);}
