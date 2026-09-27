"use client";

import { useEffect, useId, useRef, useState } from "react";
import { fetchKnowledgeMaterials, type KnowledgeMaterial, type MaterialKind, type MaterialsResponse } from "@/lib/knowledge-materials";
import { BookSearchPanel, type BookSearchPanelProps } from "./book-search-panel";
import { VectorIndexControls } from "./vector-index-controls";
import type { MessageAnchor } from "@/lib/chat-stream";

type Filter = "all" | "source" | "excerpt" | "understanding";
export type KnowledgeLibraryProps = {
  editionId: string | null;
  bookTitle?: string;
  refreshToken?: string | number;
  onReturnReading: () => void;
  onRefreshRequested?: () => void;
  advancedSearch?: BookSearchPanelProps;
  onOpenSource?: (anchor: MessageAnchor) => void;
  onOpenMaterial?: (item: KnowledgeMaterial) => void;
  onOpenConversationMaterial?: (item: KnowledgeMaterial) => void;
  onOpenConversation?: (threadId: string, messageId: string | null) => void;
};
const labels: Record<Filter, string> = { all: "全部", source: "原书", excerpt: "我的摘录", understanding: "AI 句读" };
const kindLabel: Record<MaterialKind, string> = { source: "原书资料", passage: "原文命中", excerpt: "我的摘录", understanding: "AI 句读" };
function formatDate(value: string): string { const date=new Date(value); return Number.isNaN(date.valueOf())?"时间未知":date.toLocaleDateString("zh-CN",{year:"numeric",month:"short",day:"numeric"}); }
function displayBody(item: KnowledgeMaterial): string { return item.body.trim()===item.quote.trim()?"":item.body; }
function buildParams(scope: "current"|"all",editionId:string|null,query:string,filter:Filter): URLSearchParams { const params=new URLSearchParams({scope,q:query.trim(),kind:filter,retrieval:"keyword",offset:"0",limit:"60"}); if(scope==="current"&&editionId)params.set("editionId",editionId); return params; }
export function KnowledgeLibrary({editionId,bookTitle,refreshToken,onReturnReading,onRefreshRequested,advancedSearch,onOpenSource,onOpenMaterial,onOpenConversation,onOpenConversationMaterial}: KnowledgeLibraryProps) {
  const [scope,setScope]=useState<"current"|"all">("current");
  const [filter,setFilter]=useState<Filter>("all");
  const [query,setQuery]=useState("");
  const [data,setData]=useState<MaterialsResponse|null>(null);
  const [retry,setRetry]=useState(0);
  const [error,setError]=useState("");
  const [moreBusy,setMoreBusy]=useState(false);
  const moreController=useRef<AbortController|null>(null);
  const id=useId();
  useEffect(()=>{ if(scope==="current"&&!editionId)return; const controller=new AbortController(); const params=buildParams(scope,editionId,query,filter); void fetchKnowledgeMaterials(params,controller.signal).then(value=>{if(!controller.signal.aborted){setData(value);setError("");}}).catch((cause:unknown)=>{if(!controller.signal.aborted){console.error("知识库材料加载失败",cause);setError(cause instanceof Error?cause.message:"知识库材料加载失败，请重试");}}); return()=>{controller.abort();moreController.current?.abort();}; },[scope,editionId,query,filter,refreshToken,retry]);
  async function loadMore(){
    if(!data||moreBusy||data.items.length>=data.total)return;
    const controller=new AbortController();moreController.current=controller;setMoreBusy(true);
    const params=buildParams(scope,editionId,query,filter);params.set("offset",String(data.items.length));
    try{const next=await fetchKnowledgeMaterials(params,controller.signal);if(!controller.signal.aborted)setData(current=>current&&current.scope===next.scope&&current.editionId===next.editionId&&current.query===next.query?{...next,items:[...current.items,...next.items]}:current);}
    catch(cause:unknown){if(!controller.signal.aborted){console.error("加载更多知识材料失败",cause);setError(cause instanceof Error?cause.message:"加载更多失败，请重试");}}
    finally{if(moreController.current===controller){moreController.current=null;setMoreBusy(false);}}
  }
  const visibleData=data&&data.scope===scope&&data.editionId===(scope==="current"?editionId:null)&&data.query===query.trim()?data:null;
  const count=(kind:Filter)=>kind==="all"?((visibleData?.counts.source??0)+(visibleData?.counts.excerpt??0)+(visibleData?.counts.understanding??0)):kind==="source"?(visibleData?.counts.source??0):(visibleData?.counts[kind]??0);
  return <section className="knowledge-library" aria-label="知识库工作区">
    <header className="knowledge-library-heading"><div><p>来源、摘录与理解</p><h1>知识库</h1><span>{scope==="current"?(bookTitle??"当前书籍"):"全部已导入书籍"}</span></div><div className="knowledge-library-heading-actions"><button type="button" aria-label="刷新本书知识" onClick={()=>{setRetry(value=>value+1);onRefreshRequested?.();}}>刷新</button><button type="button" onClick={onReturnReading}>返回阅读</button></div></header>
    <div className="knowledge-library-toolbar">
      <div className="knowledge-library-scope" role="group" aria-label="知识范围"><button type="button" aria-pressed={scope==="current"} onClick={()=>{setData(null);setScope("current");}} disabled={!editionId}>当前书</button><button type="button" aria-pressed={scope==="all"} onClick={()=>{setData(null);setScope("all");}}>全部书籍</button></div>
      <label className="knowledge-library-search"><span className="workspace-sr-only">搜索知识库</span><input id={id+"-query"} type="search" value={query} onChange={event=>{setData(null);setQuery(event.target.value);}} placeholder="搜索书名、正文、摘录和句读…"/></label>
    </div>
    {advancedSearch&&scope==="current"&&editionId&&<details className="knowledge-advanced-search"><summary>本书原文 · 语义与综合检索</summary><p>仅搜索当前书的原文；语义检索会将查询发送至已配置的向量服务。</p><BookSearchPanel {...advancedSearch} expanded /></details>}
    <nav className="knowledge-library-filters" aria-label="资料类型">{(Object.keys(labels) as Filter[]).map(value=><button key={value} type="button" aria-pressed={filter===value} onClick={()=>{setData(null);setFilter(value);}}>{labels[value]}<span>{count(value)}</span></button>)}</nav>
    <div className="knowledge-library-body">
      {scope==="current"&&!editionId&&<div className="knowledge-library-empty"><h2>先打开一本书</h2><p>选择书籍后，这里会汇集原书资料、个人摘录和 AI 句读。</p></div>}
      {error&&<div className="knowledge-library-empty" role="alert"><h2>知识库暂时无法读取</h2><p>{error}</p><button type="button" onClick={()=>setRetry(value=>value+1)}>重试</button></div>}
      {!error&&(editionId||scope==="all")&&!visibleData&&<div className="knowledge-library-empty" role="status">正在整理知识材料…</div>}
      {!error&&(editionId||scope==="all")&&visibleData&&visibleData.items.length===0&&<div className="knowledge-library-empty"><h2>{query?"没有找到相关材料":"还没有可展示的材料"}</h2><p>{query?"换个词试试，或切换到全部书籍。":"阅读时留下标注或完成一次句读后，材料会自动出现在这里。"}</p></div>}
      {!error&&visibleData&&visibleData.warnings.length>0&&<p className="knowledge-library-warning" role="status">{visibleData.warnings.join("；")}</p>}
      {!error&&visibleData&&visibleData.items.length>0&&<><p className="knowledge-library-result-count">显示 {visibleData.items.length} / {visibleData.total} 条 · 本地关键词检索</p><div className="knowledge-material-grid">{visibleData.items.map(item=><MaterialCard key={item.id} item={item} onOpenSource={onOpenSource} onOpenMaterial={onOpenMaterial} onOpenConversation={onOpenConversation} onOpenConversationMaterial={onOpenConversationMaterial} onIndexReady={()=>setRetry(value=>value+1)}/>)}</div>{visibleData.items.length<visibleData.total&&<button className="knowledge-library-more" type="button" disabled={moreBusy} onClick={()=>void loadMore()}>{moreBusy?"加载中…":"加载更多"}</button>}</>}
    </div>
  </section>;
}
function MaterialCard({item,onOpenSource,onOpenMaterial,onOpenConversation,onOpenConversationMaterial,onIndexReady}:{item:KnowledgeMaterial;onOpenSource?: (anchor: MessageAnchor)=>void;onOpenMaterial?: (item:KnowledgeMaterial)=>void;onOpenConversation?: (threadId:string,messageId:string|null)=>void;onOpenConversationMaterial?: (item:KnowledgeMaterial)=>void;onIndexReady:()=>void}) {
  const body=displayBody(item); return <article className={"knowledge-material-card material-"+item.kind} data-material-kind={item.kind} data-record-id={item.id}>
    <header><span className="knowledge-material-badge">{kindLabel[item.kind]}</span><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></header>
    <div className="knowledge-material-source"><strong>{item.kind==="source"?item.source.fileName:item.source.bookTitle}</strong>{item.chapterTitle&&<><span>·</span><span>{item.chapterTitle}</span></>}</div>
    <h2>{item.title}</h2>
    {item.quote&&<PreviewText text={item.quote} quote/>}
    {body&&<PreviewText text={body}/>}
    {item.concepts.length>0&&<div className="knowledge-material-concepts">{item.concepts.slice(0,4).map(concept=><span key={concept.name}>{concept.name}{concept.text?" · "+concept.text:""}</span>)}</div>}
    {item.kind==="source"&&<SourceIndexSetup editionId={item.source.editionId} onReady={onIndexReady}/>}
    <footer>{item.anchor&&(onOpenMaterial||onOpenSource)&&<button type="button" aria-label="打开原文" onClick={()=>onOpenMaterial?onOpenMaterial(item):onOpenSource?.(item.anchor as MessageAnchor)}>打开原文</button>}{item.conversation&&(onOpenConversationMaterial||onOpenConversation)&&<button type="button" aria-label="打开句读" onClick={()=>onOpenConversationMaterial?onOpenConversationMaterial(item):onOpenConversation?.(item.conversation!.threadId,item.conversation!.messageId)}>打开句读</button>}{item.kind==="source"&&(onOpenMaterial?<button type="button" onClick={()=>onOpenMaterial(item)}>打开书籍</button>:<span>正文已纳入本地检索</span>)}{!item.anchor&&item.locationReason&&<span>{item.locationReason}</span>}</footer>
  </article>;
}
function PreviewText({text,quote=false}:{text:string;quote?:boolean}) {
  const preview=Array.from(text).slice(0,200).join("");
  if(preview.length===text.length)return quote?<blockquote>{text}</blockquote>:<p>{text}</p>;
  return <details className="knowledge-material-preview"><summary><span>{preview}…</span><small>展开全文</small></summary>{quote?<blockquote>{text}</blockquote>:<p>{text}</p>}</details>;
}
function SourceIndexSetup({editionId,onReady}:{editionId:string;onReady:()=>void}){
  const [open,setOpen]=useState(false);
  // WHY：仅在用户展开时读取索引状态；跨书资料列表不同时请求每本书的向量服务。
  return <details className="knowledge-material-index" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>语义索引准备</summary>{open&&<VectorIndexControls editionId={editionId} onReady={onReady}/>}</details>;
}
