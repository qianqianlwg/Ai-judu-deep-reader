'use client';
import {useEffect,useRef,useState} from 'react';
import type {LibraryChapter} from '@/lib/library';
import type {ReadingSelection} from '@/lib/reader-selection';
import {selectionFromParts} from '@/lib/reader-selection';
import {MAX_SECTION_CHARACTERS} from '@/lib/semantic-reading';
import './semantic-reading.css';
export function SectionReadingAction({chapter,disabled,onStart,onOpenExisting,className,style}:{chapter?:LibraryChapter;disabled?:boolean;onStart:(selection:ReadingSelection,chapterId:string)=>void;onOpenExisting?:()=>void;className?:string;style?:React.CSSProperties}){
 const [open,setOpen]=useState(false),dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(open){const element=dialog.current;element?.showModal();return()=>element?.close();}},[open]);
 if(!chapter?.paragraphs.length)return null;
 const length=chapter.paragraphs.reduce((n,p)=>n+Array.from(p.text).length,0)+Math.max(0,chapter.paragraphs.length-1)*2;
 const tooLarge=length>MAX_SECTION_CHARACTERS||chapter.paragraphs.length>256;
 return <><button className={'section-reading-action '+(className??'')} style={style} type='button' disabled={disabled} title={'按句意细读：'+chapter.title} onClick={()=>onOpenExisting?onOpenExisting():setOpen(true)}>{onOpenExisting?'查看本节句读':'句读本节'}</button>
 {open&&<dialog ref={dialog} className='section-native-dialog' aria-label='确认本节句读' onCancel={()=>setOpen(false)} onClick={event=>{if(event.target===event.currentTarget)setOpen(false);}}><section className='section-scope-card'><span className='semantic-eyebrow'>本节 · 按句意细读</span><h3>{chapter.title}</h3><p>{chapter.paragraphs.length} 段 · {length.toLocaleString()} 字符。Agent 将自行划分完整意思，直白内容可略过并说明原因。</p><p>图片与图表不在文字解读范围内。逐块生成并保留进度，随时可以停止；会使用当前配置的模型与检索授权。</p>{tooLarge&&<p role='status'>本节超出当前处理上限，请先选择较小范围句读；不会截断原文。</p>}<div className='semantic-actions'><button type='button' autoFocus onClick={()=>setOpen(false)}>暂不开始</button><button type='button' disabled={tooLarge||disabled} onClick={()=>{setOpen(false);onStart(selectionFromParts(chapter.paragraphs.map(p=>({paragraphId:p.id,startOffset:0,endOffset:p.text.length,text:p.text}))),chapter.id);}}>开始本节细读</button></div></section></dialog>}</>;
}
