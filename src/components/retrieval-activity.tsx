"use client";
import { useState } from "react";
import { isRecord, type ChatMessage, type ToolActivity } from "@/lib/chat-stream";
import { readRetrievalReport, type RetrievalBranch } from "@/lib/retrieval-report";
import { ProgressiveQuote } from "./progressive-quote";
import styles from "./retrieval-activity.module.css";

type Props = { message: ChatMessage; onOpenCitation?: (paragraphId: string, quote: string, messageId?: string) => void };
type Channel = "keyword" | "semantic" | "reading" | "unrecorded";
type Source = { sourceId: string; paragraphId: string; chapterTitle: string; text: string; channels: ("keyword"|"semantic")[] };
const channelLabels:Record<Channel,string>={keyword:"关键词检索",semantic:"语义检索",reading:"补充阅读",unrecorded:"历史检索来源"};
function sourcesOf(tool:ToolActivity):Source[] {
 const output=isRecord(tool.result)?tool.result:undefined;
 if(!Array.isArray(output?.sources))return [];
 return output.sources.slice(0,24).flatMap(source=>{
  if(!isRecord(source)||typeof source.sourceId!=="string"||typeof source.paragraphId!=="string"||typeof source.chapterTitle!=="string"||typeof source.text!=="string")return [];
  const channels=Array.isArray(source.channels)?source.channels.filter((c):c is "keyword"|"semantic"=>c==="keyword"||c==="semantic"):[];
  return [{sourceId:source.sourceId,paragraphId:source.paragraphId,chapterTitle:source.chapterTitle,text:source.text,channels:[...new Set(channels)]}];
 });
}
function SourceList({sources,channel,message,onOpenCitation}:Props & {sources:Source[];channel:Channel}) {
 const [visible,setVisible]=useState(3);
 return <>
  <ol className={styles.sources} aria-label={`${channelLabels[channel]}来源`}>{sources.slice(0,visible).map((source,index)=><li key={source.sourceId+index}>
   <details className={styles.source}>
    <summary><span className={styles.ordinal}>{index+1}</span><span className={styles.sourceHeading}><strong>{source.chapterTitle}</strong>{source.channels.length>1&&channel!=="reading"&&<span className={styles.tag}>双路命中</span>}<span className={styles.sourcePreview}>{Array.from(source.text.replace(/\s+/gu," ")).slice(0,84).join("")}{Array.from(source.text).length>84?"…":""}</span></span><span className={styles.chevron} aria-hidden="true">⌄</span></summary>
    <div className={styles.sourceBody}><ProgressiveQuote text={source.text}/>{onOpenCitation&&<button type="button" className={styles.sourceLink} onClick={()=>onOpenCitation(source.paragraphId,source.text,message.id)} aria-label={`定位原文：${source.chapterTitle}`}>定位原文 ↗</button>}</div>
   </details>
  </li>)}</ol>
  {sources.length>visible&&<button className={styles.more} type="button" onClick={()=>setVisible(n=>n+3)}>再看 {Math.min(3,sources.length-visible)} 段<span> · 还有 {sources.length-visible} 段参考</span></button>}
  {visible>3&&sources.length>3&&<button className={styles.more} type="button" onClick={()=>setVisible(3)}>收起其余来源</button>}
 </>;
}
function ChannelDetails({channel,branches,sources,message,onOpenCitation,unknownSources=false}:Props & {channel:Channel;branches:RetrievalBranch[];sources:Source[];unknownSources?:boolean}) {
 const title=channelLabels[channel],unavailable=branches.length>0&&branches.every(b=>b.status!=="completed");
 return <details className={styles.channel} data-retrieval-channel={channel}>
  <summary aria-label={`展开${title}`}><span className={styles.channelIcon} aria-hidden="true">{channel==="keyword"?"Aa":channel==="semantic"?"≈":channel==="reading"?"+":"·"}</span><span className={styles.channelTitle}><strong>{title}</strong><small>{channel==="keyword"?"按词句匹配":channel==="semantic"?"按含义匹配":channel==="reading"?"扩展已知来源的上下文":"旧记录未保存具体渠道"}</small></span><span className={styles.channelCount}>{unavailable?"暂不可用":`${sources.length} 段参考`}</span><span className={styles.chevron} aria-hidden="true">⌄</span></summary>
  <div className={styles.channelBody}>
   {branches.length>0&&<ol className={styles.queries} aria-label={`${title}查询`}>{branches.map((branch,index)=><li key={index}><span>{branch.query}</span><small>{branch.status==="completed"?`${branch.count} 个候选`:branch.status==="skipped"?"未启用":"失败"}</small>{branch.reason&&<p className={styles.warning}>{branch.reason}</p>}</li>)}</ol>}
   {channel==="unrecorded"&&<p className={styles.note}>这条历史记录未保存命中渠道，不将其推断为关键词或语义结果。</p>}
   <SourceList sources={sources} channel={channel} message={message} onOpenCitation={onOpenCitation}/>
   {!sources.length&&<p className={styles.note}>{unknownSources&&channel!=="reading"&&channel!=="unrecorded"?"旧记录未保存来源渠道，具体参考见历史检索来源。":unavailable?"本渠道没有可用结果，其他渠道的结果仍保留。":branches.some(b=>b.count>0)?"本渠道有候选，但未进入本次最终参考片段。":"没有找到匹配的参考原文。"}</p>}
   {branches.length>0&&<details className={styles.metrics}><summary>查看执行详情</summary><ul>{branches.map((branch,index)=><li key={index}><span>查询 {index+1}</span><span>{(branch.durationMs/1000).toFixed(2)} 秒{branch.cacheHit?" · 查询缓存命中":branch.promptTokens!==undefined?` · ${branch.promptTokens} 输入 tokens`:""}</span></li>)}</ul></details>}
  </div>
 </details>;
}
function SearchDetails({tool,message,onOpenCitation}:Props & {tool:ToolActivity}) {
 const output=isRecord(tool.result)?tool.result:undefined,report=readRetrievalReport(output?.retrieval),sources=sourcesOf(tool);
 const pending=tool.status==="running"&&message.status==="streaming";
 const queries=Array.isArray(output?.queries)?output.queries.filter((q):q is string=>typeof q==="string").slice(0,3):[];
 const channels:Channel[]=tool.name==="read_source"?["reading"]:["keyword","semantic","unrecorded"];
 return <section className={styles.run} data-tool-id={tool.id}>
  {pending&&<div className={styles.pending}><span>正在准备与执行检索</span>{queries.length>0&&<ul>{queries.map((query,i)=><li key={i}>{query}</li>)}</ul>}</div>}
  {channels.map(channel=>{
   const branches=report?.branches.filter(b=>b.strategy===channel)??[];
   // WHY：渠道来自真实检索命中元数据；旧混合记录没有该字段时独立展示，不能按相似度或猜测分配来源。
   const channelSources=sources.filter(source=>channel==="reading"||channel==="unrecorded"?channel==="reading"||source.channels.length===0:source.channels.includes(channel));
   if(!branches.length&&!channelSources.length)return null;
   return <ChannelDetails key={channel} channel={channel} branches={branches} sources={channelSources} unknownSources={sources.some(source=>source.channels.length===0)} message={message} onOpenCitation={onOpenCitation}/>;
  })}
  {!pending&&!sources.length&&!report&&<p className={styles.note}>{tool.status==="running"?"检索已中断，可重试本轮消息。":tool.status==="error"||output?.ok===false?"未取得可用证据，回答不应视为已查证。":"未找到匹配原文，可换关键词或改写问题。"}</p>}
  {report&&<p className={styles.runMeta}>{report.sourceCount} 段去重参考 · 本轮 {(report.durationMs/1000).toFixed(2)} 秒{report.degraded?" · 部分渠道不可用":""}</p>}
  {output?.displayLimited===true&&<p className={styles.note}>历史片段已截断，完整内容请定位原文查看。</p>}
 </section>;
}
export function RetrievalActivity({message,onOpenCitation}:Props) {
 const tools=(message.tools??[]).filter(tool=>tool.name==="search_book"||tool.name==="read_source");
 if(!tools.length)return null;
 const running=tools.some(t=>t.status==="running")&&message.status==="streaming";
 const interrupted=tools.some(t=>t.status==="running")&&!running;
 const degraded=tools.some(t=>t.status==="error"||(isRecord(t.result)&&(t.result.ok===false||readRetrievalReport(t.result.retrieval)?.degraded)));
 const count=new Set(tools.flatMap(sourcesOf).map(source=>source.sourceId)).size;
 return <details className={styles.card} data-testid="retrieval-activity" data-state={running?"running":interrupted?"interrupted":degraded?"degraded":"completed"}>
  <summary aria-label="查看本书检索详情"><svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5"/><path d="m12 12 5 5" stroke="currentColor" strokeWidth="1.5"/></svg><span className={styles.summaryLabel}>{running?"正在检索本书":interrupted?"检索已中断":degraded?(count?"本书检索 · 部分策略不可用":"本书检索未取得可用证据"):count?"已检索本书":"本书检索 · 未找到匹配"}{!running&&count>0&&<small> · {count} 段参考</small>}</span><span className={styles.chevron} aria-hidden="true">⌄</span></summary>
  <div className={styles.content}>{tools.map(tool=><SearchDetails key={tool.id} tool={tool} message={message} onOpenCitation={onOpenCitation}/>)}<details className={styles.about}><summary>来源与隐私说明</summary><ul><li>仅检索本书；选文与检索来源分别保留。</li><li>同一段可能被两路命中，参考总数按段落去重。</li><li>语义查询发送至已配置的向量服务；原文与向量在本地匹配，不自动上传整书。</li><li>检索结果不代表已遍历全书，也不等于回答已采用全部片段。</li></ul></details></div>
 </details>;
}
