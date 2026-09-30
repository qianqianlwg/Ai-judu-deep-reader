'use client';
import { useState } from 'react';
import { semanticProgress } from '@/lib/semantic-progress';
import { EnhancedSourceExcerpt } from "./source-enhanced-text";
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {readAnswerEmphasis,remarkAnswerEmphasis,type AnswerEmphasis} from '@/lib/answer-emphasis';
import type { SemanticReading, SemanticUnit } from '@/lib/semantic-reading';
import type { ReadingAnchor } from '@/lib/reading-anchors';
import { anchorParts } from '@/lib/reading-anchors';
import './semantic-reading.css';
type Props={state:SemanticReading;disabled?:boolean;onOpenSource?:(a:ReadingAnchor)=>void;onReadUnit?:(unit:SemanticUnit)=>void;onRetry?:()=>void;onDiscussUnit?:(unit:SemanticUnit)=>void;onOpenCitation?:(paragraphId:string,quote:string,messageId?:string)=>void};
export function SemanticReadingResult({state,disabled,onOpenSource,onReadUnit,onRetry,onDiscussUnit,onOpenCitation}:Props){
 const label=state.readingStyle==='whole'?'整段句读':'按句意细读';
 const read=state.units.filter(u=>u.action==='read'),skipped=state.units.filter(u=>u.action==='skip');
 const emphasis=(unit:SemanticUnit)=>unit.analysis?.emphasisSource==='agent'?readAnswerEmphasis(unit.content??'',unit.analysis.emphasis):undefined;
 const progress=semanticProgress(state);
 const [expanded,setExpanded]=useState(true);
 const pending=state.pending??(state.phase==='reading'&&!state.units.length?{index:1}:undefined);
 const heading=state.phase==='planning'?'正在思考…':state.phase==='completed'?(read.length?'本次细读完成':'Agent 建议略过这些内容'):state.phase==='interrupted'?(state.units.length?'进度已保留':'本次细读尚未生成'):pending?.error?'正在修正当前句':'正在逐句细读';
 function source(u:SemanticUnit){return <details className='semantic-source'><summary>原文 · {anchorParts(u.anchor).length} 段来源</summary><blockquote>{anchorParts(u.anchor).map((p,i)=><span key={p.paragraphId+':'+p.startOffset}>{i>0?'\n\n':''}<EnhancedSourceExcerpt text={p.selectedText} ranges={(u.sourceEmphasis??[]).filter(m=>m.paragraphId===p.paragraphId&&m.startOffset>=p.startOffset&&m.endOffset<=p.endOffset&&p.selectedText.slice(m.startOffset-p.startOffset,m.endOffset-p.startOffset)===m.quote).map(m=>({start:m.startOffset-p.startOffset,end:m.endOffset-p.startOffset,kind:m.kind}))}/></span>)}</blockquote></details>;}
 return <section className='semantic-reading' aria-label={label+"结果"}>
  <header className={'semantic-progress-card'+(state.phase==='reading'?' is-active':'')}>
   <div className='semantic-heading'><div><span className='semantic-eyebrow'>{label}</span><h3>{heading}</h3></div><span className='semantic-percentage'>{Math.floor(progress.percent)}<small>%</small></span></div>
   <progress className='semantic-progress-bar' aria-label='句读进度' max={100} value={progress.percent}/>
   <div className='semantic-progress-meta'><span>已句读 <strong>{progress.completed}</strong> {state.readingStyle==='whole'?'块':'句'}</span><span>{progress.processed.toLocaleString('zh-CN')} / {progress.total.toLocaleString('zh-CN')} 字</span></div>
  </header>
  {state.phase==='interrupted'&&!state.units.length&&<p className='semantic-note' role='status'>本次尚未生成新的句读块。书页上的已有句读线属于历史记录，不代表本次结果；可重试，不会删除历史。</p>}
  {pending?.error&&<p className='semantic-unit-error' role='status'>{pending.error}{state.phase==='reading'?' · Agent 正在修正当前句':''}</p>}
  <details className='semantic-list' open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
   <summary className='semantic-list-heading'><span className='semantic-list-icon' aria-hidden='true'>⌄</span><span>句读内容</span><small>{progress.completed} {state.readingStyle==='whole'?'块':'句'}</small></summary>
  <div className='semantic-units'>{read.map((unit,index)=><article key={unit.id} className='semantic-unit' data-message-id={unit.id} data-unit-status={unit.status}>
   <div className='semantic-unit-heading'><span className='semantic-unit-number'>{String(index+1).padStart(2,'0')}</span><h4>{unit.label}</h4><span>{unit.status==='completed'?'':unit.status==='streaming'?'生成中':unit.status==='error'?'待继续':'等待'}</span></div>
   {unit.content?<div className='semantic-answer message-content'><Markdown remarkPlugins={[remarkGfm,...(emphasis(unit)?[[remarkAnswerEmphasis,emphasis(unit)!] as [typeof remarkAnswerEmphasis,AnswerEmphasis]]:[])]} skipHtml components={{img:({alt})=><span>[图片未自动加载{alt?'：'+alt:''}]</span>,a:({children,...props})=><a {...props} target='_blank' rel='noopener noreferrer'>{children}</a>}}>{unit.content}</Markdown></div>:unit.status==='streaming'?<p className='semantic-note'>正在释读这段意思…</p>:null}
   {source(unit)}
   {!!unit.analysis?.citations?.length&&<details className='semantic-source'><summary>引用依据 · {unit.analysis.citations.length} 处</summary>{unit.analysis.citations.map((citation,i)=><button type='button' className='semantic-citation' key={i} disabled={!onOpenCitation} onClick={()=>onOpenCitation?.(citation.paragraphId,citation.quote,unit.id)}>“{citation.quote}”</button>)}</details>}
   {unit.error&&<p className='semantic-unit-error' role='status'>{unit.error}</p>}
   <div className='semantic-actions'><button type='button' disabled={!onOpenSource} onClick={()=>onOpenSource?.(unit.anchor)}>定位原文 <span aria-hidden='true'>↗</span></button>{unit.status==='completed'&&onDiscussUnit&&<button type='button' disabled={disabled} onClick={()=>onDiscussUnit(unit)}>追问此块</button>}{unit.status==='completed'&&onReadUnit&&<button type='button' disabled={disabled} onClick={()=>onReadUnit(unit)}>重新句读</button>}{unit.status==='error'&&onRetry&&<button type='button' disabled={disabled} onClick={onRetry}>重试并继续</button>}</div>
  </article>)}
  {state.phase==='reading'&&pending&&<article className='semantic-pending' role='status' aria-label={'正在句读第'+pending.index+'句'}>
   <div className='semantic-unit-heading'><span className='semantic-unit-number'>{String(pending.index).padStart(2,'0')}</span><h4>{pending.error?'正在修正当前句…':'正在整理这句的释读…'}</h4><span className='semantic-working-dot' aria-hidden='true'/></div>
   <div className='semantic-skeleton' aria-hidden='true'><span/><span/><span/><span/></div>
  </article>}
  </div>
  {skipped.length>0&&<details className='semantic-skipped'><summary>略过 {skipped.length} 处 <span>查看原因，也可要求句读</span></summary>{skipped.map(unit=><article key={unit.id} className='semantic-skip-item'><h4>{unit.label}</h4><p>{unit.reason}</p>{source(unit)}<div className='semantic-actions'><button type='button' disabled={!onOpenSource} onClick={()=>onOpenSource?.(unit.anchor)}>定位原文</button><button type='button' disabled={disabled||!onReadUnit} onClick={()=>onReadUnit?.(unit)}>仍然句读</button></div></article>)}</details>}
  </details>
 </section>;
}
