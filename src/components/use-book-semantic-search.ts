"use client";
import {useEffect,useRef,useState} from "react";
import {readRetrievalReport} from "@/lib/retrieval-report";
import type {SearchResult,SearchStatus,BookSearchPanelProps} from "./book-search-panel";

type Resource<T>={editionId:string;value:T};
export function useBookSemanticSearch(editionId:string|undefined,onNotice:(text:string)=>void):Omit<BookSearchPanelProps,"editionId"|"expanded"|"onResult">&{results:SearchResult[]}{
 const [query,setQuery]=useState("");
 const [retrieval,setRetrieval]=useState("keyword");
 const [results,setResults]=useState<Resource<SearchResult[]>|null>(null);
 const [status,setStatus]=useState<Resource<SearchStatus>|null>(null);
 const [revision,setRevision]=useState(0);
 const activeSearch=useRef<AbortController|null>(null);
 useEffect(()=>{
  if(!editionId)return;
  const controller=new AbortController();
  void fetch("/api/search/status?engine=local-vector&editionId="+encodeURIComponent(editionId),{signal:controller.signal})
   .then(async response=>{if(!response.ok)throw new Error("读取检索状态失败");return response.json() as Promise<SearchStatus>;})
   .then(value=>{if(!controller.signal.aborted)setStatus({editionId,value});})
   .catch((cause:unknown)=>{if(!controller.signal.aborted){console.error("读取本书语义检索状态失败",cause);onNotice("语义检索状态读取失败，请重试");}});
  return()=>{controller.abort();activeSearch.current?.abort();};
 },[editionId,revision,onNotice]);
 async function search(){
  if(!editionId||!query.trim())return;
  const target=editionId;activeSearch.current?.abort();const controller=new AbortController();activeSearch.current=controller;
  try{
   const params=new URLSearchParams({editionId:target,q:query.trim(),retrieval,context:"1"});
   const response=await fetch("/api/search?"+params,{signal:controller.signal});
   const data=await response.json() as {results?:SearchResult[];retrieval?:unknown;error?:string};
   if(!response.ok)throw new Error(data.error??"本书检索失败");
   if(controller.signal.aborted)return;setResults({editionId:target,value:data.results??[]});
   const report=readRetrievalReport(data.retrieval);
   onNotice(`找到 ${data.results?.length??0} 处原文${report?.degraded?"；部分检索策略不可用，已保留可用结果":""}`);
  }catch(cause:unknown){if(!controller.signal.aborted){console.error("本书高级检索失败",cause);onNotice(cause instanceof Error?cause.message:"本书检索失败，请重试");}}
 }
 // WHY：索引结果按版本隔离，过时的跨书响应不会被当成当前书的来源使用。
 return {query,onQuery:(value:string)=>{activeSearch.current?.abort();setQuery(value);setResults(null);},retrieval,onRetrieval:(value:string)=>{activeSearch.current?.abort();setRetrieval(value);setResults(null);},status:status&&status.editionId===editionId?status.value:null,
  results:results&&results.editionId===editionId?results.value:[],onSearch:()=>void search(),onReady:()=>setRevision(value=>value+1)};
}
