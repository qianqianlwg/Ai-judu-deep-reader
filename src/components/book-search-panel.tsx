"use client";
import {VectorIndexControls} from './vector-index-controls';
export type SearchResult = {
  paragraphId: string;
  chapterId: string;
  chapterTitle: string;
  excerpt: string;
  matchedText?: string;
  startOffset?: number;
  sourceId?: string;
  retrieval?: { backend: "sqlite"; keywordScore: number; vectorSimilarity: number; rrfScore: number; vectorUsed: boolean };
};
export type SearchStatus = { backend: "sqlite"; editionId: string; paragraphCount: number; indexedCount: number; vectorIndexed: boolean; note: string };

type Props={editionId?:string;query:string;onQuery:(query:string)=>void;retrieval:string;onRetrieval:(value:string)=>void;status:SearchStatus|null;results:SearchResult[];onSearch:()=>void;onReady:()=>void;onResult:(result:SearchResult)=>void};
export function BookSearchPanel({editionId,query,onQuery,retrieval,onRetrieval,status,results,onSearch,onReady,onResult}:Props){return (        <details className="workspace-book-search"><summary>书内搜索</summary>
          <form onSubmit={event => { event.preventDefault(); void onSearch(); }}><label className="workspace-sr-only" htmlFor="workspace-book-query">搜索当前书籍原文</label><input id="workspace-book-query" type="search" value={query} onChange={event => onQuery(event.target.value)} placeholder="搜索本书" /><button type="submit">搜索</button></form>
          <label>检索方式<select aria-label="检索方式" value={retrieval} onChange={event=>onRetrieval(event.target.value)}><option value="keyword">关键词（本地）</option><option value="semantic">语义搜索</option><option value="hybrid">关键词 + 向量</option></select></label>
          <VectorIndexControls key={editionId} editionId={editionId} onReady={onReady}/>
          {status && <div className="search-status" data-testid="search-status"><span className={status.vectorIndexed ? "index-ready" : "index-fallback"}>{status.vectorIndexed ? "向量检索可用" : "关键词检索"} · {status.indexedCount}/{status.paragraphCount} 段</span><small>{status.note}</small></div>}
          {results.length > 0 && <div className="search-results">{results.map(result => <button type="button" key={result.paragraphId} onClick={() => onResult(result)}>{result.chapterTitle}<span>{result.excerpt}</span><small>{result.retrieval?.vectorUsed ? "关键词 + 向量 · " : "关键词 · "}点击跳回原文</small></button>)}</div>}
        </details>);}
