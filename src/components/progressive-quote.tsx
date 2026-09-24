"use client";
import { useState } from "react";
import styles from "./progressive-quote.module.css";

// WHY：仅按原有换行或明确编号分段，不改写、不补省略字句；所有片段拼接后仍是逐字原文。
export function quoteBlocks(text: string): string[] {
 const markers=[...text.matchAll(/[（(](?:[1-9]\d?|[一二三四五六七八九十]{1,3})[）)]/gu)];
 const cuts=new Set<number>([0,text.length]);
 for(const match of text.matchAll(/\n+/gu))cuts.add(match.index+match[0].length);
 if(markers.length>=2)for(const marker of markers)cuts.add(marker.index);
 const positions=[...cuts].sort((a,b)=>a-b);
 return positions.slice(0,-1).map((start,i)=>text.slice(start,positions[i+1])).filter(Boolean);
}
function QuoteBody({text,previewCharacters=220}:{text:string;previewCharacters?:number}) {
 const [full,setFull]=useState(false),characters=Array.from(text),long=characters.length>previewCharacters;
 const displayed=full||!long?text:characters.slice(0,previewCharacters).join("");
 return <div className={styles.quote} data-expanded={full}>
  <blockquote className={styles.body} tabIndex={full&&long?0:undefined} aria-label="原文内容">{quoteBlocks(displayed).map((block,index)=><p key={index}>{block}</p>)}</blockquote>
  {long&&<div className={styles.controls}><span>{full?`共 ${characters.length} 字`:`节选 · 前 ${previewCharacters} / ${characters.length} 字`}</span><button type="button" aria-expanded={full} onClick={()=>setFull(value=>!value)}>{full?"收起长原文":"展开完整原文"}</button></div>}
 </div>;
}
export function ProgressiveQuote(props:{text:string;previewCharacters?:number}) {
 return <QuoteBody key={props.text} {...props}/>;
}
