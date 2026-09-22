import {createHash,randomUUID} from 'node:crypto';
import {embedTexts,EMBEDDING_PROFILE,type EmbeddingConfig} from './embedding-provider';
import {ensureEmbeddingSchema,type EmbeddingStore} from './embedding-store';
export type IndexParagraph={id:string;chapterId:string;chapterTitle:string;paragraphIndex:number;text:string};
export type VectorChunk={paragraphId:string;start:number;end:number;text:string;hash:string};
export function splitVectorChunks(paragraph:IndexParagraph):VectorChunk[]{
 const characters=Array.from(paragraph.text),chunks:VectorChunk[]=[];let start=0;
 for(let i=0;i<characters.length;i+=1200){const text=characters.slice(i,i+1200).join(''),end=start+text.length;if(text.trim())chunks.push({paragraphId:paragraph.id,start,end,text,hash:createHash('sha256').update(text).digest('hex')});start=end;}
 return chunks;
}
export function indexParagraphs(db:EmbeddingStore,editionId:string):IndexParagraph[]{
 return db.prepare('SELECT p.id,p.text,p.chapter_id AS chapterId,c.title AS chapterTitle,p.order_index AS paragraphIndex FROM paragraphs p JOIN chapters c ON c.id=p.chapter_id WHERE c.edition_id=? ORDER BY c.order_index,p.order_index').all(editionId) as IndexParagraph[];
}
function chunkKey(chunk:Pick<VectorChunk,'paragraphId'|'start'|'hash'>){return chunk.paragraphId+':'+chunk.start+':'+chunk.hash;}
export function indexedKeys(db:EmbeddingStore,editionId:string):Set<string>{
 return new Set((db.prepare('SELECT paragraph_id AS paragraphId,chunk_start AS start,text_hash AS hash FROM paragraph_embeddings WHERE edition_id=? AND profile=?').all(editionId,EMBEDDING_PROFILE) as Pick<VectorChunk,'paragraphId'|'start'|'hash'>[]).map(chunkKey));
}
export function vectorIndexStatus(db:EmbeddingStore,editionId:string){
 ensureEmbeddingSchema(db);const paragraphs=indexParagraphs(db,editionId).filter(p=>p.text.trim()),chunks=paragraphs.flatMap(splitVectorChunks),keys=indexedKeys(db,editionId);
 const indexed=chunks.filter(chunk=>keys.has(chunkKey(chunk))),complete=chunks.length>0&&indexed.length===chunks.length;
 const indexedCount=paragraphs.filter(p=>splitVectorChunks(p).every(chunk=>keys.has(chunkKey(chunk)))).length;
 return {backend:'sqlite' as const,editionId,paragraphCount:paragraphs.length,indexedCount,chunkCount:chunks.length,indexedChunkCount:indexed.length,vectorIndexed:complete,partial:indexed.length>0&&!complete,note:complete?'本地向量索引已就绪；语义检索会将查询发送至 SiliconFlow。':chunks.length?'尚未完成本书向量索引，可建立或继续索引。':'本书没有可索引文字，扫描页或图片需先 OCR。'};
}
export type EmbedBatch=(config:EmbeddingConfig,texts:readonly string[],signal?:AbortSignal)=>Promise<number[][]>;
export async function buildVectorBatch(db:EmbeddingStore,editionId:string,config:EmbeddingConfig,signal?:AbortSignal,embed:EmbedBatch=embedTexts){
 ensureEmbeddingSchema(db);
 if(!db.prepare('SELECT id FROM editions WHERE id=?').get(editionId))throw new Error('书籍版本不存在');
 if(!config.apiKey)throw new Error('请先在设置中保存向量模型 API Key');
 const token=randomUUID(),now=Date.now();
 // WHY：持久租约跨进程防止重复付费；每批提交后释放，取消/重启可从已完成切块继续。
 const lease=db.prepare('INSERT INTO embedding_build_leases(edition_id,token,expires_at) VALUES(?,?,?) ON CONFLICT(edition_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE embedding_build_leases.expires_at<? RETURNING token').get(editionId,token,now+90000,now);
 if(!lease)throw new Error('本书正在建立索引，请等待当前批次完成后重试');
 try{
  const paragraphs=indexParagraphs(db,editionId),keys=indexedKeys(db,editionId),pending=paragraphs.flatMap(splitVectorChunks).filter(chunk=>!keys.has(chunkKey(chunk))).slice(0,8);
  if(pending.length){
   const vectors=await embed(config,pending.map(chunk=>chunk.text),signal);signal?.throwIfAborted();
   const current=new Set(indexParagraphs(db,editionId).flatMap(splitVectorChunks).map(chunkKey));
   if(pending.some(chunk=>!current.has(chunkKey(chunk))))throw new Error('书籍内容已变化，请重新建立索引');
   db.exec('BEGIN IMMEDIATE');
   try{for(let i=0;i<pending.length;i++){const c=pending[i];db.prepare('INSERT INTO paragraph_embeddings(edition_id,paragraph_id,chunk_start,chunk_end,text_hash,profile,vector_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(edition_id,paragraph_id,chunk_start,profile) DO UPDATE SET chunk_end=excluded.chunk_end,text_hash=excluded.text_hash,vector_json=excluded.vector_json').run(editionId,c.paragraphId,c.start,c.end,c.hash,EMBEDDING_PROFILE,JSON.stringify(vectors[i]));}db.exec('COMMIT');}catch(error:unknown){db.exec('ROLLBACK');throw error;}
  }
  return {...vectorIndexStatus(db,editionId),processed:pending.length};
 }finally{db.prepare('DELETE FROM embedding_build_leases WHERE edition_id=? AND token=?').run(editionId,token);}
}
