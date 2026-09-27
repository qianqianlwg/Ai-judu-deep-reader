"use client";
import {useState} from "react";
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

export type BookSearchPanelProps={expanded?:boolean;editionId?:string;query:string;onQuery:(query:string)=>void;retrieval:string;onRetrieval:(value:string)=>void;status:SearchStatus|null;results:SearchResult[];onSearch:()=>void;onReady:()=>void;onResult:(result:SearchResult)=>void};
export function BookSearchPanel({editionId,query,onQuery,retrieval,onRetrieval,status,results,onSearch,onReady,onResult ,expanded=false}:BookSearchPanelProps){
 const [setupOpen,setSetupOpen]=useState(false);
 const ready=status?.vectorIndexed===true;
 const chooseMode=(mode:string)=>{onRetrieval(mode);if(mode==="keyword")setSetupOpen(false);else if(!ready)setSetupOpen(true);};
 const title=<><svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5"/><path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg><span>知识检索</span><span className="book-search-chevron" aria-hidden="true">⌄</span></>;
 const content=<div className="book-search-content">
   <div className="book-search-modes" role="group" aria-label="检索方式">
    {([['keyword','关键词'],['semantic','语义'],['hybrid','综合']] as const).map(([mode,label])=><button key={mode} type="button" data-retrieval={mode} aria-pressed={retrieval===mode} onClick={()=>chooseMode(mode)}>{label}{mode==='semantic'&&ready&&<span className="book-search-ready" aria-label="语义索引已就绪"/>}</button>)}
   </div>
   <form onSubmit={event=>{event.preventDefault();if(query.trim()&&(retrieval==='keyword'||ready))onSearch();}}>
    <label className="workspace-sr-only" htmlFor="workspace-book-query">搜索当前书籍原文</label>
    <input id="workspace-book-query" type="search" value={query} onChange={event=>onQuery(event.target.value)} placeholder="输入关键词…"/>
    <button type="submit" disabled={!query.trim()||(retrieval!=='keyword'&&!ready)} aria-label="搜索本书" title="搜索本书"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5"/><path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button>
   </form>
   <p className="book-search-hint">{retrieval==='keyword'?'在本书原文中查找，结果可直接定位。':ready?'语义检索已准备好，可用自然语言搜索。':'语义搜索尚未准备好，请先完成本书的授权与索引。'}</p>
   <details className="book-search-options" open={setupOpen} onToggle={event=>setSetupOpen(event.currentTarget.open)}>
    <summary>语义搜索设置<span>{ready?'已就绪':'需准备'}</span></summary>
    <p className="book-search-hint">关键词搜索留在本机；启用语义搜索时，须明确同意把本书文字发送至 SiliconFlow，可能产生费用。</p>
    {setupOpen&&<VectorIndexControls key={editionId} editionId={editionId} onReady={onReady}/>}
    {status&&<p className="book-search-index-detail">已收录 {status.paragraphCount} 段原文{ready?' · 语义搜索可用':''}</p>}
   </details>
   {results.length>0&&<section className="search-results" aria-label="书内搜索结果"><p className="book-search-results-label">{results.length} 处相关内容</p>{results.map(result=><button type="button" key={result.paragraphId} onClick={()=>onResult(result)}><strong>{result.chapterTitle}</strong><span>{result.excerpt}</span><small>定位原文 <span aria-hidden="true">↗</span></small></button>)}</section>}
  </div>;
 // WHY：知识库是独立工作区，标题不是可收起按钮，避免误触让搜索结果瞬间消失。
 return expanded ? <section className="workspace-book-search"><h2 className="book-search-entry">{title}</h2>{content}</section>
   : <details className="workspace-book-search"><summary className="book-search-entry">{title}</summary>{content}</details>;
}
