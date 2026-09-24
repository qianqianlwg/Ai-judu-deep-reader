"use client";
import { useState } from "react";
import { anchorParts, joinAnchorText } from "@/lib/reading-anchors";
import type { ChatMessage, MessageAnchor } from "@/lib/chat-stream";
import { ProgressiveQuote } from "./progressive-quote";
import styles from "./message-source-card.module.css";

type Props={anchor:MessageAnchor;messageId?:string;role:ChatMessage["role"];onOpenSource?:(anchor:MessageAnchor)=>void;onOpenCitation?:(paragraphId:string,quote:string,messageId?:string)=>void};
function Card({anchor,messageId,role,onOpenSource,onOpenCitation}:Props) {
 const [visible,setVisible]=useState(3),parts=anchorParts(anchor),text=joinAnchorText(parts);
 const preview=Array.from(text.replace(/\s+/gu," ").trim()).slice(0,72).join("");
 const label=role==="user"?"本次选文":"句读原文";
 return <div className={styles.card} data-testid="message-source" data-source-paragraph={anchor.paragraphId} data-source-channel="selection">
  <details className={styles.details}>
   <summary aria-label={`展开${label}`}><span className={styles.heading}><span className={styles.label}>{label}</span><span className={styles.meta}>{parts.length} 段 · {Array.from(text).length} 字</span><span className={styles.chevron} aria-hidden="true">⌄</span></span><span className={styles.preview}>{preview}{Array.from(text).length>72?"…":""}</span></summary>
   <div className={styles.content}><p className={styles.caption}>{role==="user"?"由你选中的原文":"本次句读对应的原文"}，与 AI 检索来源分开保留。</p>
    <ol className={styles.fragments} aria-label="选文片段">{parts.slice(0,visible).map((part,index)=><li key={part.paragraphId+':'+part.startOffset}>
     {parts.length===1?<ProgressiveQuote text={part.selectedText}/>:<details className={styles.fragment}>
      <summary aria-label={`展开选文片段 ${index+1}`}><span className={styles.fragmentHeader}><span>片段 {index+1}</span><span>{Array.from(part.selectedText).length} 字 <span className={styles.chevron} aria-hidden="true">⌄</span></span></span><span className={styles.fragmentPreview}>{Array.from(part.selectedText.replace(/\s+/gu," ")).slice(0,84).join("")}{Array.from(part.selectedText).length>84?"…":""}</span></summary>
      <ProgressiveQuote text={part.selectedText}/>
     </details>}
    </li>)}</ol>
    {parts.length>visible&&<button className={styles.more} type="button" onClick={()=>setVisible(count=>count+3)}>再看 {Math.min(3,parts.length-visible)} 段<span> · 还有 {parts.length-visible} 段</span></button>}
    {visible>3&&parts.length>3&&<button className={styles.more} type="button" onClick={()=>setVisible(3)}>收起其余片段</button>}
    <footer className={styles.footer}><span>原文保留，不自动改写</span><button type="button" disabled={!onOpenSource&&!onOpenCitation} aria-label={`定位${label}`} onClick={()=>{if(onOpenSource)onOpenSource(anchor);else onOpenCitation?.(anchor.paragraphId,anchor.selectedText,messageId);}}>定位原文 ↗</button></footer>
   </div>
  </details>
 </div>;
}
export function MessageSourceCard(props:Props) {
 // WHY：切换历史选文时重置展开配额，不能沿用另一条长选文的展开状态。
 return <Card key={props.messageId+':'+props.anchor.paragraphId+':'+props.anchor.startOffset} {...props}/>;
}
