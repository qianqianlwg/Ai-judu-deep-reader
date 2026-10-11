import { z } from 'zod';
import { GuideError } from './guide';
import type { GuideDb } from './guide-store';
export const guidePreparationSchema=z.object({messageId:z.string(),status:z.enum(['none','waiting','pending','processing','completed','failed']),total:z.number().int().nonnegative(),completed:z.number().int().nonnegative(),failed:z.number().int().nonnegative(),error:z.string().nullable()}).strict();
export type GuidePreparation=z.infer<typeof guidePreparationSchema>;
export function readGuidePreparation(db:GuideDb,scope:{threadId:string;editionId:string;messageId:string}):GuidePreparation{
 const message=db.prepare("SELECT m.status,m.structured_output FROM chat_messages m JOIN reading_threads t ON t.id=m.thread_id WHERE m.id=? AND m.thread_id=? AND t.edition_id=? AND m.role='assistant'").get(scope.messageId,scope.threadId,scope.editionId) as {status:string;structured_output:string}|undefined;
 if(!message)throw new GuideError('这条句读不属于当前会话或书籍版本',404);
 const rows=db.prepare('SELECT status,error FROM guide_sources WHERE thread_id=? AND edition_id=? AND (parent_message_id=? OR message_id=?)').all(scope.threadId,scope.editionId,scope.messageId,scope.messageId) as {status:string;error:string|null}[];
 const total=rows.length,completed=rows.filter(r=>r.status==='completed').length,failed=rows.filter(r=>r.status==='failed').length;
 // WHY：只呈现队列的真实状态，不根据经过时间伪造模型百分比，也不把别的会话来源算进本次整理。
 const metadata:unknown=JSON.parse(message.structured_output);
 const request=metadata&&typeof metadata==='object'&&'_request' in metadata?metadata._request:undefined;
 const lease=request&&typeof request==='object'&&'leaseUntil' in request?request.leaseUntil:undefined;
 const active=message.status==='streaming'&&(typeof lease!=='number'||lease>Date.now());
 const status=!total?'none':active?'waiting':completed===total?'completed':failed?'failed':rows.some(r=>r.status==='processing')?'processing':'pending';
 return {messageId:scope.messageId,status,total,completed,failed,error:rows.find(r=>r.status==='failed')?.error??null};
}
export function retryGuidePreparation(db:GuideDb,scope:{threadId:string;editionId:string;messageId:string}){
 readGuidePreparation(db,scope);
 db.prepare("UPDATE guide_sources SET status='pending',attempts=0,next_attempt=0,error=NULL WHERE status='failed' AND thread_id=? AND edition_id=? AND (parent_message_id=? OR message_id=?)").run(scope.threadId,scope.editionId,scope.messageId,scope.messageId);
 return readGuidePreparation(db,scope);
}
