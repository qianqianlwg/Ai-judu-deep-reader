import { randomUUID } from 'node:crypto';
import { readTimedGuideNodes } from './guide-timeline-store';
import { applyGuidePatch,GuideError,type GuideNode,type GuidePatch } from './guide';
import { guideHead,guideSourceIds,guideTransaction,saveGuideRevision,type GuideDb } from './guide-store';
import { readGuideSources,type GuideSource } from './guide-sources';
import { guideBatchInputTokens, selectGuideBatch, type GuideBatchCapacity } from './guide-batch';
export type GuideJob={message_id:string;book_id:string;lease_token:string;attempts:number;sourceIds?:string[];capacity?:GuideBatchCapacity};
export type GuidePlanInput={bookId:string;nodes:GuideNode[];capacity?:GuideBatchCapacity;source:GuideSource;sources?:GuideSource[];readSources:(ids:string[])=>GuideSource[];signal:AbortSignal};
export type GuidePlanner=(input:GuidePlanInput)=>Promise<{patch:GuidePatch;usage?:unknown}>;
export function claimGuideJob(db:GuideDb,now=Date.now(),capacity?:GuideBatchCapacity | ((bookId:string)=>GuideBatchCapacity)):GuideJob|null{
 return guideTransaction(db,()=>{
  db.prepare("UPDATE guide_sources SET status='pending',lease_token=NULL,lease_until=0 WHERE status='processing' AND lease_until<?").run(now);
  // WHY：主Agent逐句登记来源，但父消息仍在生成时不触发子Agent；一次领取本次已完成句读的全部待整理来源。
  const row=db.prepare("SELECT message_id,book_id,parent_message_id,attempts FROM guide_sources s WHERE status='pending' AND next_attempt<=? AND NOT EXISTS(SELECT 1 FROM guide_sources other WHERE other.book_id=s.book_id AND other.status='processing') AND NOT EXISTS(SELECT 1 FROM chat_messages parent WHERE parent.id=s.parent_message_id AND parent.status='streaming' AND (NOT json_valid(parent.structured_output) OR json_extract(parent.structured_output,'$._request.leaseUntil') IS NULL OR json_extract(parent.structured_output,'$._request.leaseUntil')>?)) ORDER BY created_at,message_id LIMIT 1").get(now,now) as {message_id:string;book_id:string;parent_message_id:string|null;attempts:number}|undefined;
  if(!row)return null;
  // WHY：旧式独立句读和逐句来源一起按书合批；仍在生成且父租约有效的来源不能提前消费。
  const candidates=db.prepare("SELECT message_id,attempts FROM guide_sources s WHERE book_id=? AND status='pending' AND next_attempt<=? AND NOT EXISTS(SELECT 1 FROM chat_messages parent WHERE parent.id=s.parent_message_id AND parent.status='streaming' AND (NOT json_valid(parent.structured_output) OR json_extract(parent.structured_output,'$._request.leaseUntil') IS NULL OR json_extract(parent.structured_output,'$._request.leaseUntil')>?)) ORDER BY created_at,message_id LIMIT 64").all(row.book_id,now,now) as {message_id:string;attempts:number}[];
  const sources=readGuideSources(db,row.book_id,candidates.map(candidate=>candidate.message_id));
  const validIds=new Set(sources.filter(source=>source.analysisText?.trim()).map(source=>source.id));
  for(const candidate of candidates)if(!validIds.has(candidate.message_id))db.prepare("UPDATE guide_sources SET status='failed',error=? WHERE message_id=? AND status='pending'").run('主Agent已完成的分析或来源快照缺失，请恢复来源后重试；已有导图未修改。',candidate.message_id);
  const available=sources.filter(source=>validIds.has(source.id));
  if(!available.length)return null;
  const head=guideHead(db,row.book_id),nodes=readTimedGuideNodes(db,head.current_revision);
  const budget=typeof capacity==='function'?capacity(row.book_id):capacity;
  const selected=budget?selectGuideBatch(nodes,available,budget):available;
  if(!selected.length){
   db.prepare("UPDATE guide_sources SET status='failed',error=? WHERE message_id=?").run('框架投影与本则完整句读超过导图输入容量，请提高输入预算后重试；原文和释读未截断。',available[0].id);return null;
  }
  const selectedIds=new Set(selected.map(source=>source.id)),rows=candidates.filter(candidate=>selectedIds.has(candidate.message_id));
  const job:GuideJob={message_id:rows[0].message_id,book_id:row.book_id,lease_token:randomUUID(),attempts:Math.max(...rows.map(r=>r.attempts))+1,sourceIds:rows.map(r=>r.message_id),...(budget?{capacity:budget}:{})};
  // WHY：批次中每则来源各自累计失败次数，新入队来源不能继承旧来源的三次失败预算。
  for(const item of rows)db.prepare("UPDATE guide_sources SET status='processing',attempts=?,lease_token=?,lease_until=?,error=NULL WHERE message_id=?").run(item.attempts+1,job.lease_token,now+300000,item.message_id);
  return job;
 });
}
export async function runGuideJob(db:GuideDb,job:GuideJob,plan:GuidePlanner):Promise<void>{
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),240000),ids=job.sourceIds??[job.message_id];
 try{
  const head=guideHead(db,job.book_id),nodes=readTimedGuideNodes(db,head.current_revision),sources=readGuideSources(db,job.book_id,ids);
  if(sources.length!==ids.length||sources.some(s=>!s.id||!s.analysisText?.trim()))throw new GuideError('主Agent已完成分析或来源ID缺失，未整理导图。');
  if(job.capacity&&guideBatchInputTokens(nodes,sources,job.capacity)>job.capacity.maxInputTokens)throw new GuideError('导图框架更新后超出本批输入容量，请提高预算后重试；分析未截断。');
  const result=await plan({bookId:job.book_id,nodes,source:sources[0],sources,capacity:job.capacity,readSources:other=>readGuideSources(db,job.book_id,other),signal:controller.signal});
  controller.signal.throwIfAborted();
  guideTransaction(db,()=>{
   // WHY：批次里的所有来源都必须仍持有本轮租约；图版本变化交回新版本重试，不能覆盖用户在整理期间的编辑。
   for(const id of ids)if(!db.prepare("SELECT message_id FROM guide_sources WHERE message_id=? AND status='processing' AND lease_token=? AND lease_until>?").get(id,job.lease_token,Date.now()))throw new GuideError('导图整理任务租约已被替代',409);
   if(guideHead(db,job.book_id).version!==head.version)throw new GuideError('导图已被编辑，将基于新版本继续整理',409);
   const next=applyGuidePatch(nodes,result.patch,guideSourceIds(db,job.book_id));
   // WHY：持久化边界再次保证每则已消费来源确实落在Agent提交的节点依据里，不由程序补引用。
   const represented=new Set(next.flatMap(node=>node.sourceIds));
   if(ids.some(id=>!represented.has(id)))throw new GuideError('本批存在尚未纳入导图依据的来源，未标记为已完成。');
   if(JSON.stringify(next)!==JSON.stringify(nodes))saveGuideRevision(db,job.book_id,head.version,next,'ai',result.patch.reason,result.usage);
   for(const id of ids)db.prepare("UPDATE guide_sources SET status='completed',completed_at=?,lease_token=NULL,lease_until=0,error=NULL WHERE message_id=? AND lease_token=?").run(new Date().toISOString(),id,job.lease_token);
  });
 }catch(error:unknown){
  const conflict=error instanceof GuideError&&error.status===409;
  const message=error instanceof GuideError?error.message:'思维导图整理未完成，请检查模型连接后重试；句读和已有导图不受影响。';
  console.error('导图整理失败',{messageId:job.message_id,name:error instanceof Error?error.name:'UnknownError',conflict});
  guideTransaction(db,()=>{for(const id of ids){
   const source=db.prepare("SELECT attempts FROM guide_sources WHERE message_id=? AND lease_token=?").get(id,job.lease_token) as {attempts:number}|undefined;
   if(!source)continue;
   const retry=conflict||source.attempts<3;
   db.prepare("UPDATE guide_sources SET status=?,attempts=?,lease_token=NULL,lease_until=0,next_attempt=?,error=? WHERE message_id=? AND lease_token=?").run(retry?'pending':'failed',conflict?Math.max(0,source.attempts-1):source.attempts,Date.now()+(conflict?1000:5000*source.attempts),message,id,job.lease_token);
  }});
 }finally{clearTimeout(timeout);}
}
