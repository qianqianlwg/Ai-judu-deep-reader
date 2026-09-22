import {EMBEDDING_PROFILE,embedTexts,validateVector,type EmbeddingConfig} from './embedding-provider';
import {type EmbeddingStore} from './embedding-store';
import {indexParagraphs,splitVectorChunks,vectorIndexStatus,type EmbedBatch} from './vector-index';
import {searchParagraphs,type SearchMatch} from './book-search';
import {sourceIdForParagraph} from './citation-validation';
export function cosineSimilarity(a:readonly number[],b:readonly number[]):number{
 if(a.length!==b.length||!a.length)throw new Error('向量维度不一致');
 let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return aa&&bb?dot/Math.sqrt(aa*bb):0;
}
export async function searchVectors(db:EmbeddingStore,config:EmbeddingConfig,input:{editionId:string;query:string;chapterId?:string;limit:number;hybrid:boolean;signal?:AbortSignal},embed:EmbedBatch=embedTexts):Promise<SearchMatch[]>{
 const {editionId,query,chapterId,limit}=input,status=vectorIndexStatus(db,editionId);
 if(!status.vectorIndexed)throw new Error('本书向量索引未完成，请先建立索引');
 const paragraphs=indexParagraphs(db,editionId).filter(p=>!chapterId||p.chapterId===chapterId),byId=new Map(paragraphs.map(p=>[p.id,p]));
 const chunks=new Map(paragraphs.flatMap(splitVectorChunks).map(c=>[c.paragraphId+':'+c.start,c]));
 const [queryVector]=await embed(config,['Instruct: Retrieve relevant passages from a book based on the search query.\nQuery: '+query],input.signal);
 const rows=db.prepare('SELECT paragraph_id AS paragraphId,chunk_start AS start,text_hash AS hash,vector_json AS vector FROM paragraph_embeddings WHERE edition_id=? AND profile=?').all(editionId,EMBEDDING_PROFILE) as {paragraphId:string;start:number;hash:string;vector:string}[];
 const best=new Map<string,{match:SearchMatch;score:number}>();
 for(const row of rows){const chunk=chunks.get(row.paragraphId+':'+row.start),p=byId.get(row.paragraphId);if(!chunk||!p||chunk.hash!==row.hash)continue;
  const score=cosineSimilarity(queryVector,validateVector(JSON.parse(row.vector)));
  if(score<=0||(best.get(p.id)?.score??-1)>=score)continue;
  const text=Array.from(chunk.text).slice(0,180).join('');
  best.set(p.id,{score,match:{paragraphId:p.id,chapterId:p.chapterId,chapterTitle:p.chapterTitle,paragraphIndex:p.paragraphIndex,matchedText:text,startOffset:chunk.start,endOffset:chunk.start+text.length,excerpt:text,context:{before:[],after:[]},sourceId:sourceIdForParagraph(editionId,p.id)}});
 }
 const vector=[...best.values()].sort((a,b)=>b.score-a.score).slice(0,Math.max(limit*3,30));
 const keyword=input.hybrid?searchParagraphs(paragraphs,query,Math.max(limit*3,30),1):[];
 const fused=new Map<string,{match:SearchMatch;rrf:number;similarity:number;keyword:number}>();
 vector.forEach((hit,i)=>fused.set(hit.match.paragraphId,{match:hit.match,rrf:1/(61+i),similarity:hit.score,keyword:0}));
 keyword.forEach((match,i)=>{const prior=fused.get(match.paragraphId);fused.set(match.paragraphId,{match:{...match,sourceId:sourceIdForParagraph(editionId,match.paragraphId)},rrf:(prior?.rrf??0)+1/(61+i),similarity:prior?.similarity??0,keyword:1/(i+1)});});
 return [...fused.values()].sort((a,b)=>b.rrf-a.rrf||b.similarity-a.similarity||a.match.paragraphId.localeCompare(b.match.paragraphId)).slice(0,limit).map(hit=>({...hit.match,retrieval:{backend:'sqlite',keywordScore:hit.keyword,vectorSimilarity:hit.similarity,rrfScore:hit.rrf,vectorUsed:true}}));
}
