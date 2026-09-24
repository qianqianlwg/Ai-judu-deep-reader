import { searchParagraphs, searchKeywordCandidates, normalizeSearchQuery, type SearchMatch } from "./book-search";
import { sourceIdForParagraph } from "./citation-validation";
import type { EmbeddingConfig } from "./embedding-provider";
import type { EmbeddingStore } from "./embedding-store";
import { indexParagraphs, vectorIndexStatus } from "./vector-index";
import { searchVectors } from "./vector-search";
import type { createQueryEmbeddingSession } from "./query-embedding";
import type { RetrievalBranch, RetrievalMode, RetrievalReport } from "./retrieval-report";

export type BookRetrievalInput = { query: string; additionalQueries?: string[]; mode?: RetrievalMode; chapterId?: string | null; limit: number; signal?: AbortSignal };
export type RetrievedSource = { sourceId: string; paragraphId: string; chapterId: string; chapterTitle: string; text: string; startOffset: number; endOffset: number; channels: ("keyword" | "semantic")[] };
export type BookRetrievalResult = { results: SearchMatch[]; sources: RetrievedSource[]; retrieval: RetrievalReport };
type Options = { db: EmbeddingStore; editionId: string; config: EmbeddingConfig; vector?: typeof searchVectors; embeddings: ReturnType<typeof createQueryEmbeddingSession>; semanticEnabled?: boolean };
export function createBookRetrieval({db,editionId,config,vector=searchVectors,embeddings,semanticEnabled=true}: Options) {
  return async (input: BookRetrievalInput): Promise<BookRetrievalResult> => {
    const started = Date.now(), mode = input.mode ?? "auto", signal = input.signal;
    signal?.throwIfAborted();
    const queries = [...new Set([input.query,...input.additionalQueries??[]].map(normalizeSearchQuery).filter(Boolean))];
    if (!queries.length || queries.length > 3 || queries.some(q=>q.length>500) || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error("检索参数不合法");
    const paragraphs = indexParagraphs(db,editionId).filter(p=>!input.chapterId||p.chapterId===input.chapterId);
    const candidateLimit = Math.max(input.limit*3,30);
    const wantVector = mode !== "keyword", wantKeyword = mode !== "semantic";
    const unavailable = wantVector ? !semanticEnabled ? "已关闭 AI 自动语义检索" : !config.apiKey.trim() ? "未配置向量服务" : !vectorIndexStatus(db,editionId).vectorIndexed ? "本书索引未完成" : undefined : undefined;
    const jobs: Promise<{branch:RetrievalBranch;matches:SearchMatch[]}>[] = [];
    // WHY：不同查询及不同策略同时发起；所有支路收敛后统一融合，不让某一路失败抹掉已成功的证据。
    for (const query of queries) {
      if (wantKeyword) jobs.push(Promise.resolve().then(()=>{
        signal?.throwIfAborted(); const start=Date.now(); const matches=(mode==="keyword"?searchParagraphs:searchKeywordCandidates)(paragraphs,query,candidateLimit,1);
        return {matches,branch:{query,strategy:"keyword" as const,status:"completed" as const,count:matches.length,durationMs:Date.now()-start}};
      }));
      if (wantVector) jobs.push((async()=>{
        const start=Date.now(); const branch:RetrievalBranch={query,strategy:"semantic",status:"skipped",count:0,durationMs:0};
        if(unavailable)return {matches:[],branch:{...branch,reason:unavailable}};
        const call=embeddings.createCall();
        try {
          const matches=await vector(db,config,{editionId,query,chapterId:input.chapterId??undefined,limit:candidateLimit,hybrid:false,signal},call.embed);
          signal?.throwIfAborted();return {matches,branch:{...branch,status:"completed" as const,count:matches.length,durationMs:Date.now()-start,...call.stats}};
        } catch(error:unknown) {
          signal?.throwIfAborted();
          console.error("向量检索支路失败",{name:error instanceof Error?error.name:"UnknownError"});
          return {matches:[],branch:{...branch,status:"error" as const,durationMs:Date.now()-start,reason:"语义检索暂不可用（连接、额度或本轮预算），可重试或使用关键词检索"}};
        }
      })());
    }
    const outcomes=await Promise.all(jobs); signal?.throwIfAborted();
    const successful=outcomes.filter(o=>o.branch.status==="completed"), strategies=new Set(successful.map(o=>o.branch.strategy));
    const fused=new Map<string,{match:SearchMatch;score:number;keyword:number;similarity:number;channels:Set<"keyword"|"semantic">}>();
    for(const {matches,branch} of successful)matches.forEach((match,rank)=>{
      const prior=fused.get(match.paragraphId),similarity=match.retrieval?.vectorSimilarity??0;
      // WHY：保留最佳语义块的偏移，不被另一条关键词命中覆盖；融合使用排名而非不同量纲的原始分数。
      const chosen=!prior||similarity>prior.similarity?match:prior.match;
      fused.set(match.paragraphId,{match:chosen,score:(prior?.score??0)+1/(61+rank),keyword:Math.max(prior?.keyword??0,branch.strategy==="keyword"?1/(rank+1):0),similarity:Math.max(prior?.similarity??0,similarity),channels:new Set([...(prior?.channels??[]),branch.strategy])});
    });
    const results=[...fused.values()].sort((a,b)=>b.score-a.score||b.similarity-a.similarity||a.match.paragraphId.localeCompare(b.match.paragraphId)).slice(0,input.limit).map(hit=>({...hit.match,sourceId:sourceIdForParagraph(editionId,hit.match.paragraphId),retrieval:{backend:"sqlite" as const,keywordScore:hit.keyword,vectorSimilarity:hit.similarity,rrfScore:hit.score,vectorUsed:hit.similarity>0}}));
    // WHY：只回读当前版本里已命中的正文；将实际提供给模型的片段与偏移一起保存，以便回放及引文复核。
    const current=new Map(indexParagraphs(db,editionId).map(p=>[p.id,p]));
    const sources=results.map(match=>{
      const paragraph=current.get(match.paragraphId);
      if(!paragraph||paragraph.chapterId!==match.chapterId||(input.chapterId&&paragraph.chapterId!==input.chapterId)||paragraph.text!==paragraphs.find(p=>p.id===match.paragraphId)?.text||paragraph.text.slice(match.startOffset,match.endOffset)!==match.matchedText)throw new Error("检索期间正文已变化，请重试");
      let start=Math.max(0,match.startOffset-300),end=Math.min(paragraph.text.length,Math.max(start+1600,match.endOffset));
      if(start>0&&/[\uDC00-\uDFFF]/u.test(paragraph.text[start]))start--;
      if(end<paragraph.text.length&&/[\uDC00-\uDFFF]/u.test(paragraph.text[end]))end++;
      return {sourceId:sourceIdForParagraph(editionId,paragraph.id),paragraphId:paragraph.id,chapterId:paragraph.chapterId,chapterTitle:paragraph.chapterTitle,text:paragraph.text.slice(start,end),startOffset:start,endOffset:end,channels:[...fused.get(paragraph.id)!.channels]};
    });
    return {results,sources,retrieval:{version:1,requestedMode:mode,effectiveMode:strategies.size===2?"hybrid":strategies.has("semantic")?"semantic":strategies.has("keyword")?"keyword":"none",queries,branches:outcomes.map(o=>o.branch),durationMs:Date.now()-started,sourceCount:sources.length,degraded:outcomes.some(o=>o.branch.status!=="completed")}};
  };
}
