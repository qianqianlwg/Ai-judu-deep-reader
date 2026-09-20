"use client";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_READING_APPEARANCE, READING_THEMES, READING_FONTS, normalizeReadingAppearance, type ReadingAppearancePreferences } from "@/lib/reading-appearance";
import styles from "./reader-options.module.css";
export function ReaderOptions({ value, onChange }: { value: ReadingAppearancePreferences; onChange(value: ReadingAppearancePreferences): void }) {
  const [open,setOpen]=useState(false);const root=useRef<HTMLDivElement>(null);const trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!open)return;
    const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};
  },[open]);
  const change=(patch:Partial<ReadingAppearancePreferences>)=>onChange(normalizeReadingAppearance({...value,...patch}));
  return <div ref={root} className={styles.root}>
    <button ref={trigger} type="button" aria-label="更多阅读选项" aria-expanded={open} onClick={()=>setOpen(!open)}>Aa · 选项</button>
    {open&&<div className={styles.panel} role="region" aria-label="阅读选项">
      <header><strong>阅读外观</strong><button type="button" aria-label="关闭阅读选项" onClick={()=>{setOpen(false);trigger.current?.focus();}}>×</button></header>
      <label>主题<select aria-label="阅读主题" value={value.theme} onChange={e=>change({theme:e.target.value as ReadingAppearancePreferences['theme']})}>{READING_THEMES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
      <label>字体<select aria-label="阅读字体" value={value.font} onChange={e=>change({font:e.target.value as ReadingAppearancePreferences['font']})}>{READING_FONTS.map(f=><option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
      <label>字号 <output>{value.fontSize}px</output><input aria-label="阅读字号" type="range" min="14" max="32" value={value.fontSize} onChange={e=>change({fontSize:Number(e.target.value)})}/></label>
      <label>行距<select aria-label="阅读行距" value={value.lineHeight} onChange={e=>change({lineHeight:Number(e.target.value)})}>{Array.from({length:11},(_,i)=>Number((1.4+i/10).toFixed(1))).map(n=><option key={n} value={n}>{n.toFixed(1)} 倍</option>)}</select></label>
      <label>列宽<select aria-label="阅读列宽" value={value.columnWidth} onChange={e=>change({columnWidth:e.target.value==='auto'?'auto':Number(e.target.value) as 520|650|780})}><option value="520">窄 · 520px</option><option value="650">适中 · 650px</option><option value="780">宽 · 780px</option><option value="auto">自适应</option></select></label>
      <label>对齐<select aria-label="阅读对齐" value={value.textAlign} onChange={e=>change({textAlign:e.target.value==='justify'?'justify':'left'})}><option value="left">左对齐</option><option value="justify">两端对齐</option></select></label>
      <p>即时应用并保存。列宽用于精读，原版布局以书籍为准。</p>
      <footer><button type="button" onClick={()=>onChange({...DEFAULT_READING_APPEARANCE})}>恢复默认外观</button><a href="/settings">全部设置 →</a></footer>
    </div>}
  </div>;
}
