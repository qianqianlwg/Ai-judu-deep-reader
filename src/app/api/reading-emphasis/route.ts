import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {getDb} from '@/lib/db';
import {readSourceEmphasis,saveSourceEmphasis} from '@/lib/source-enhancement-store';
import {resolveChapterSelection} from '@/lib/semantic-storage';
import {executeSemanticFlow} from '@/lib/agent/semantic-flow';
import {createBookSources} from '@/lib/agent/book-sources';
import {createBookRetrieval} from '@/lib/book-retrieval';
import {readEmbeddingConfig,readAgentRetrievalEnabled} from '@/lib/embedding-store';
import {createQueryEmbeddingSession} from '@/lib/query-embedding';
import type {SemanticReading} from '@/lib/semantic-reading';
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
  const repository=createBookSources(db,data.editionId),embeddingConfig=readEmbeddingConfig(db);
  const retrieve=createBookRetrieval({db,editionId:data.editionId,config:embeddingConfig,embeddings:createQueryEmbeddingSession(embeddingConfig),semanticEnabled:readAgentRetrievalEnabled(db)});
  let state:SemanticReading|undefined;
  // WHY：原文重点操作也复用同一主Agent协议，不留可启动第三个规划Agent的隐藏入口；结果仅在全程成功后替换标注。
  const result=await executeSemanticFlow({db,editionId:data.editionId,config,settings:DEFAULT_CONTEXT_SETTINGS,sources:selected.selectionAnchors,readingStyle:data.readingStyle,context:'本次用户只需在原文展示重点；按统一句读协议提交简短释读及重点，不扩展讲解。',messages:[],detail:'gist',difficulty:'normal',forceRead:true,signal,providedSources:repository.initial(selected.selectionAnchors[0]?.paragraphId??null),read:repository.read,
   search:async input=>{const result=await retrieve({...input,signal});return {sources:result.sources,retrieval:result.retrieval};},
   publish(next){state=next;},commit(){signal.throwIfAborted();},emit(event){if(event.type==='usage')usage=event.usage;},audit:async run=>{if(run.status==='error')console.warn('重点工具未通过核验',{name:run.name});}});
  signal.throwIfAborted();const marks=(state??result.state).units.flatMap(unit=>unit.sourceEmphasis??[]);
  db.exec('BEGIN IMMEDIATE');try{saveSourceEmphasis(db,data.editionId,marks);db.exec('COMMIT');}catch(error:unknown){db.exec('ROLLBACK');throw error;}
  return NextResponse.json({marks:readSourceEmphasis(db,data.editionId),generated:marks.length,usage});
 }catch(error:unknown){console.error('生成原文重点失败',error instanceof Error?error.name:'UnknownError');return NextResponse.json({error:error instanceof SemanticPlanError?error.message:'原文重点未生成，请检查模型工具能力后重试；原有标记保留。'},{status:502});}
}
