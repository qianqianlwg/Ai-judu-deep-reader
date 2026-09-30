'use client';
import { EnhancedSourceExcerpt } from "./source-enhanced-text";
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {readAnswerEmphasis,remarkAnswerEmphasis,type AnswerEmphasis} from '@/lib/answer-emphasis';
import type { SemanticReading, SemanticUnit } from '@/lib/semantic-reading';
import type { ReadingAnchor } from '@/lib/reading-anchors';
import { anchorParts } from '@/lib/reading-anchors';
import './semantic-reading.css';
type Props={state:SemanticReading;disabled?:boolean;onOpenSource?:(a:ReadingAnchor)=>void;onReadUnit?:(a:ReadingAnchor)=>void;onRetry?:()=>void;onDiscussUnit?:(a:ReadingAnchor)=>void;onOpenCitation?:(paragraphId:string,quote:string,messageId?:string)=>void};
export function SemanticReadingResult({state,disabled,onOpenSource,onReadUnit,onRetry,onDiscussUnit,onOpenCitation}:Props){
 const label=state.readingStyle==='whole'?'整段句读':'按句意细读';
 const read=state.units.filter(u=>u.action==='read'),skipped=state.units.filter(u=>u.action==='skip');
 const emphasis=(unit:SemanticUnit)=>readAnswerEmphasis(unit.content??'',unit.analysis?.emphasis);
 const completed=read.filter(u=>u.status==='completed').length;
 function source(u:SemanticUnit){return <details className='semantic-source'><summary>原文 · {anchorParts(u.anchor).length} 段来源</summary><blockquote>{anchorParts(u.anchor).map((p,i)=><span key={p.paragraphId+':'+p.startOffset}>{i>0?'\n\n':''}<EnhancedSourceExcerpt text={p.selectedText} ranges={(u.sourceEmphasis??[]).filter(m=>m.paragraphId===p.paragraphId&&m.startOffset>=p.startOffset&&m.endOffset<=p.endOffset&&p.selectedText.slice(m.startOffset-p.startOffset,m.endOffset-p.startOffset)===m.quote).map(m=>({start:m.startOffset-p.startOffset,end:m.endOffset-p.startOffset,kind:m.kind}))}/></span>)}</blockquote></details>;}
 return <section className='semantic-reading' aria-label={label+"结果"}>
  <header className='semantic-heading'><div><span className='semantic-eyebrow'>{label}</span><h3>{state.phase==='planning'?'正在理解原文，划分句意…':state.phase==='completed'?read.length?'本次细读完成':'Agent 建议略过这些内容':state.phase==='interrupted'?(state.units.length?'进度已保留':'本次细读尚未生成'):'正在逐块句读'}</h3></div>{read.length>0&&<span className='semantic-count'>{completed}<span> / {read.length}</span></span>}</header>
  {state.phase==='interrupted'&&!state.units.length&&<p className='semantic-note' role='status'>分块未通过核验，没有生成新的句读块。书页上的已有句读线属于历史记录，不代表本次细读结果；可重试，不会删除历史。</p>}
  {state.phase==='planning'&&<p className='semantic-note' role='status'>Agent 自行分组；最小单位不代表必须独立成块。</p>}
  {state.units.length>0&&<p className='semantic-note' role='status'>已句读 {completed} 块{skipped.length?` · 略过 ${skipped.length} 处`:''} · 每块都可回到对应原文</p>}
  <div className='semantic-units'>{read.map((unit,index)=><article key={unit.id} className='semantic-unit' data-message-id={unit.id} data-unit-status={unit.status}>
   <div className='semantic-unit-heading'><span className='semantic-unit-number'>{String(index+1).padStart(2,'0')}</span><h4>{unit.label}</h4><span>{unit.status==='completed'?'':unit.status==='streaming'?'生成中':unit.status==='error'?'待继续':'等待'}</span></div>
   {unit.content?<div className='semantic-answer message-content'><Markdown remarkPlugins={[remarkGfm,...(emphasis(unit)?[[remarkAnswerEmphasis,emphasis(unit)!] as [typeof remarkAnswerEmphasis,AnswerEmphasis]]:[])]} skipHtml components={{img:({alt})=><span>[图片未自动加载{alt?'：'+alt:''}]</span>,a:({children,...props})=><a {...props} target='_blank' rel='noopener noreferrer'>{children}</a>}}>{unit.content}</Markdown></div>:unit.status==='streaming'?<p className='semantic-note'>正在释读这段意思…</p>:null}
   {source(unit)}
   {!!unit.analysis?.citations?.length&&<details className='semantic-source'><summary>引用依据 · {unit.analysis.citations.length} 处</summary>{unit.analysis.citations.map((citation,i)=><button type='button' className='semantic-citation' key={i} disabled={!onOpenCitation} onClick={()=>onOpenCitation?.(citation.paragraphId,citation.quote,unit.id)}>“{citation.quote}”</button>)}</details>}
   {unit.error&&<p className='semantic-unit-error' role='status'>{unit.error}</p>}
   <div className='semantic-actions'><button type='button' disabled={!onOpenSource} onClick={()=>onOpenSource?.(unit.anchor)}>定位原文 <span aria-hidden='true'>↗</span></button>{unit.status==='completed'&&onDiscussUnit&&<button type='button' disabled={disabled} onClick={()=>onDiscussUnit(unit.anchor)}>追问此块</button>}{unit.status==='completed'&&onReadUnit&&<button type='button' disabled={disabled} onClick={()=>onReadUnit(unit.anchor)}>重新句读</button>}{unit.status==='error'&&onRetry&&<button type='button' disabled={disabled} onClick={onRetry}>重试并继续</button>}</div>
  </article>)}</div>
  {skipped.length>0&&<details className='semantic-skipped'><summary>略过 {skipped.length} 处 <span>查看原因，也可要求句读</span></summary>{skipped.map(unit=><article key={unit.id} className='semantic-skip-item'><h4>{unit.label}</h4><p>{unit.reason}</p>{source(unit)}<div className='semantic-actions'><button type='button' disabled={!onOpenSource} onClick={()=>onOpenSource?.(unit.anchor)}>定位原文</button><button type='button' disabled={disabled||!onReadUnit} onClick={()=>onReadUnit?.(unit.anchor)}>仍然句读</button></div></article>)}</details>}
 </section>;
}
