"use client";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { countReadingCharacters } from "@/lib/reading-detail";
import type { ReadingMarkColor } from "@/lib/reading-marks";
import "./selection-actions.css";
const COLORS = [{id:"yellow",label:"黄色"},{id:"green",label:"绿色"},{id:"blue",label:"蓝色"},{id:"pink",label:"粉色"},{id:"orange",label:"橙色"}] as const;
export type SelectionActionsProps = { left:number; top:number; disabled?:boolean; analyzeDisabled?:boolean; reason?:string; selectedText?:string; paragraphCount?:number; onExtend?:()=>void; onClose?:()=>void; onAnalyze:()=>void; onHighlight:(color:ReadingMarkColor)=>void; onFavorite:()=>void; onNote:(text:string)=>void };
export function SelectionActions({left,top,disabled=false,analyzeDisabled=false,reason,selectedText,paragraphCount=1,onExtend,onClose,onAnalyze,onHighlight,onFavorite,onNote}:SelectionActionsProps){
  const ref=useRef<HTMLDivElement>(null), [noteOpen,setNoteOpen]=useState(false), [draft,setDraft]=useState("");
  useLayoutEffect(()=>{
    const fit=()=>{const el=ref.current;if(!el)return;const width=el.getBoundingClientRect().width,height=el.getBoundingClientRect().height;
      el.style.left=Math.max(10,Math.min(window.innerWidth-width-10,left-width/2))+"px";
      el.style.top=Math.max(10,Math.min(window.innerHeight-height-10,top-height))+"px";};
    fit();window.addEventListener("resize",fit);return()=>window.removeEventListener("resize",fit);
  },[left,top,noteOpen]);
  function submit(event:FormEvent){event.preventDefault();const text=draft.trim();if(!text)return;onNote(text);setDraft("");setNoteOpen(false);}
  return <div ref={ref} className="selection-actions-popover" role="toolbar" aria-label="选中文本操作" data-reader-decoration="" onMouseUp={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key==="Escape")onClose?.();}}>
    {selectedText && <details className="selection-preview"><summary>已选 {countReadingCharacters(selectedText)} / 1000 字 · {paragraphCount} 段</summary><blockquote>{selectedText}</blockquote></details>}
    <div className="selection-primary-actions">
      <div className="selection-colors" aria-label="标注颜色">{COLORS.map(color=><button type="button" key={color.id} className={"selection-color selection-color-"+color.id} disabled={disabled} aria-label={color.label+"标亮"} title={color.label+"标亮"} onClick={()=>onHighlight(color.id)}/>)}</div>
      <button type="button" disabled={disabled||analyzeDisabled} title={reason} onClick={onAnalyze}>句读一下</button>
      <button type="button" disabled={disabled} onClick={()=>setNoteOpen(value=>!value)}>添加笔记</button>
      <button type="button" disabled={disabled} onClick={onFavorite}>收藏</button>
      {onExtend && <button type="button" disabled={disabled||countReadingCharacters(selectedText??"")>=1000} onClick={onExtend}>继续选取</button>}
      <button type="button" aria-label="关闭选文操作" onClick={onClose}>×</button>
    </div>
    {reason&&<small role="status">{reason}；仍可标亮、笔记或收藏。</small>}
    {noteOpen&&<form className="selection-note-form" onSubmit={submit}><textarea autoFocus aria-label="笔记内容" value={draft} onChange={event=>setDraft(event.target.value)} placeholder="写下你的想法…"/><div><button type="button" onClick={()=>setNoteOpen(false)}>取消</button><button type="submit" disabled={!draft.trim()||disabled}>保存笔记</button></div></form>}
  </div>;
}
