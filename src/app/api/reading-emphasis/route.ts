import {NextRequest,NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {getDb} from '@/lib/db';
import {readSourceEmphasis,saveSourceEmphasis} from '@/lib/source-enhancement-store';
import {resolveChapterSelection} from '@/lib/semantic-storage';
import {planSemanticReading} from '@/lib/agent/semantic-planner';
import {SemanticPlanError} from '@/lib/semantic-plan-input';
import {DEFAULT_CONTEXT_SETTINGS} from '@/lib/context-compaction';
import {readModelChoices,selectRequestModel} from '@/lib/model-choices';
import type {ProviderConfig} from '@/lib/ai-provider';
import type {TokenUsage} from '@/lib/token-usage';
export const runtime='nodejs';
const scope=z.object({bookId:z.string().min(1),editionId:z.string().min(1)});
const input=scope.extend({chapterId:z.string().min(1),model:z.string().optional(),readingStyle:z.enum(['semantic','whole']).default('semantic')}).strict();
function belongs(db:ReturnType<typeof getDb>,bookId:string,editionId:string){return Boolean(db.prepare('SELECT id FROM editions WHERE id=? AND book_id=?').get(editionId,bookId));}
export async function GET(request:NextRequest){
 const parsed=scope.safeParse(Object.fromEntries(request.nextUrl.searchParams));if(!parsed.success)return NextResponse.json({error:'缺少书籍版本'},{status:400});
 const db=getDb(),{bookId,editionId}=parsed.data;if(!belongs(db,bookId,editionId))return NextResponse.json({error:'书籍版本不匹配'},{status:404});
 return NextResponse.json({marks:readSourceEmphasis(db,editionId)});
}
export async function POST(request:NextRequest){
 let data:z.infer<typeof input>;
 try{data=input.parse(await request.json());}catch{return NextResponse.json({error:'重点生成参数无效'},{status:400});}
 const db=getDb();if(!belongs(db,data.bookId,data.editionId))return NextResponse.json({error:'书籍版本不匹配'},{status:404});
 let selected:ReturnType<typeof resolveChapterSelection>,config:ProviderConfig;
 try{
  selected=resolveChapterSelection(db,data.editionId,data.bookId,data.chapterId);
  const row=db.prepare('SELECT provider,base_url,api_key,model FROM ai_provider_configs WHERE id=?').get('default') as {provider:string;base_url:string;api_key:string;model:string}|undefined;
  if(!row?.api_key)throw new Error('请先配置 AI 模型');
  config=selectRequestModel({provider:row.provider==='claude'?'claude':'openai',baseUrl:row.base_url,apiKey:row.api_key,model:row.model},data.model,readModelChoices(db,row.model));
 }catch(error:unknown){return NextResponse.json({error:error instanceof Error?error.message:'无法读取本节'},{status:400});}
 try{
  let usage:TokenUsage|undefined;
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(240000)]);
  // WHY：只在明确的生成操作后调用模型；不向正式会话插入伪句读，也不把外观开关当成生成请求。
  const units=await planSemanticReading({config,sources:selected.selectionAnchors,context:'本次只需规划并标记原文重点，不生成解读。',readingStyle:data.readingStyle,...DEFAULT_CONTEXT_SETTINGS,signal,makeId:randomUUID,onUsage:v=>{usage=v;},audit:async(_args,result,ok)=>{if(!ok)console.warn('重点规划未通过来源核验',result);}});
  signal.throwIfAborted();const marks=units.flatMap(u=>u.sourceEmphasis??[]);
  db.exec('BEGIN IMMEDIATE');try{saveSourceEmphasis(db,data.editionId,marks);db.exec('COMMIT');}catch(error:unknown){db.exec('ROLLBACK');throw error;}
  return NextResponse.json({marks:readSourceEmphasis(db,data.editionId),generated:marks.length,usage});
 }catch(error:unknown){console.error('生成原文重点失败',error instanceof Error?error.name:'UnknownError');return NextResponse.json({error:error instanceof SemanticPlanError?error.message:'原文重点未生成，请检查模型工具能力后重试；原有标记保留。'},{status:502});}
}
