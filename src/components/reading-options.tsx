'use client';
import { useEffect, useRef, useState } from 'react';
import type { ReadingStyle } from '@/lib/semantic-reading';
import { READING_DIFFICULTY_LABELS, READING_DIFFICULTY_OPTIONS, normalizeReadingDifficulty, type ReadingPreferences } from '@/lib/reading-preferences';
import { READING_DETAIL_OPTIONS, normalizeReadingDetail, readingDetailSpec } from '@/lib/reading-detail';
import type { ReadingAppearancePreferences } from '@/lib/reading-appearance';
import { ReadingStyleControl } from './reading-style-control';
import { ReadingEnhancementControl } from './reading-enhancement-control';
import './reading-options.css';
type Props={style:ReadingStyle;onStyleChange:(v:ReadingStyle)=>void;preferences:ReadingPreferences;onPreferencesChange:(v:ReadingPreferences)=>void;appearance:ReadingAppearancePreferences;onAppearanceChange:(v:ReadingAppearancePreferences)=>void;disabled?:boolean;enhancementStatus?:string;enhancementBusy?:boolean;canEnhance?:boolean;onGenerateEmphasis?:()=>void;};
export function ReadingOptions(p:Props){
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!open)return;const pointer=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}};document.addEventListener('pointerdown',pointer);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',pointer);document.removeEventListener('keydown',key);};},[open]);
 return <div className="reading-options" ref={root}>
  <button ref={trigger} type="button" aria-label="句读选项" aria-expanded={open} onClick={()=>setOpen(!open)}>句读 · 选项</button>
  {open&&<section className="reading-options-panel" aria-label="句读选项设置"><header><strong>句读选项</strong><button type="button" aria-label="关闭句读选项" onClick={()=>{setOpen(false);trigger.current?.focus();}}>×</button></header>
   <fieldset disabled={p.disabled}><legend>划分方式</legend><ReadingStyleControl value={p.style} onChange={p.onStyleChange}/><p>{p.style==='semantic'?'以句子为最小单位；Agent 可合并表达同一个意思的连续句子。':'以自然段为最小单位；Agent 可合并紧密关联的连续段落。'}</p></fieldset>
   <fieldset disabled={p.disabled}><legend>解读设置</legend><label>解读方式<select aria-label="解读方式" value={p.preferences.difficulty} onChange={e=>p.onPreferencesChange({...p.preferences,difficulty:normalizeReadingDifficulty(e.target.value)})}>{READING_DIFFICULTY_OPTIONS.map(v=><option key={v} value={v}>{READING_DIFFICULTY_LABELS[v]}</option>)}</select></label>
   <label>回复长度<select aria-label="回复长度" value={p.preferences.detail} onChange={e=>p.onPreferencesChange({...p.preferences,detail:normalizeReadingDetail(e.target.value)})}>{READING_DETAIL_OPTIONS.map(v=><option key={v} value={v}>{readingDetailSpec(v).label}</option>)}</select></label><p>{p.preferences.difficulty==='beginner'?'小白：先补必要背景、解释术语，再用具体例子说明。':'解读方式与回复长度独立。'} 本书解读设置仅对下一次生成生效。</p></fieldset>
   <ReadingEnhancementControl value={p.appearance} onChange={patch=>p.onAppearanceChange({...p.appearance,...patch})}/>
   <div className="reading-options-emphasis"><p role="status">{p.enhancementStatus??'重点由 Agent 生成；显示开关不调用模型。'}</p>{p.onGenerateEmphasis&&<button type="button" disabled={!p.canEnhance||p.enhancementBusy||p.disabled} onClick={p.onGenerateEmphasis}>{p.enhancementBusy?'正在生成本节重点…':'生成本节重点'}</button>}<small>手动生成使用当前模型并产生用量，只生成重点，不新增句读解释。</small></div>
  </section>}
 </div>;
}
