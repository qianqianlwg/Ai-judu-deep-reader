'use client';
import {useEffect,useRef,useState} from 'react';
import type {LibraryChapter} from '@/lib/library';
import type {ReadingSelection} from '@/lib/reader-selection';
import {selectionFromParts} from '@/lib/reader-selection';
import {MAX_SECTION_CHARACTERS,type ReadingStyle} from '@/lib/semantic-reading';
import './semantic-reading.css';
import './reading-options.css';
type Props={chapter?:LibraryChapter;readingStyle?:ReadingStyle;disabled?:boolean;onStart:(selection:ReadingSelection,chapterId:string)=>void;onOpenExisting?:()=>void;className?:string;style?:React.CSSProperties};
export function SectionReadingAction({chapter,readingStyle='semantic',disabled,onStart,onOpenExisting,className,style}:Props){
 const [open,setOpen]=useState(false),[hover,setHover]=useState(false),dialog=useRef<HTMLDialogElement>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),trigger=useRef<HTMLButtonElement>(null),ignoreFocus=useRef(false);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 useEffect(()=>{if(open){const element=dialog.current;element?.showModal();return()=>element?.close();}},[open]);
 const show=()=>{clearTimeout(timer.current);if(onOpenExisting&&!disabled)setHover(true);};
 const hide=()=>{clearTimeout(timer.current);timer.current=setTimeout(()=>setHover(false),180);};
 if(!chapter?.paragraphs.length)return null;
 const length=chapter.paragraphs.reduce((n,p)=>n+Array.from(p.text).length,0)+Math.max(0,chapter.paragraphs.length-1)*2;
 const tooLarge=length>MAX_SECTION_CHARACTERS||chapter.paragraphs.length>256;
 const label=readingStyle==='whole'?'整段句读':'按句意细读';
 return <><span className={'section-action-wrap '+(className??'')} style={style} onMouseEnter={show} onMouseLeave={hide} onFocus={()=>{if(ignoreFocus.current){ignoreFocus.current=false;return;}show();}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))hide();}} onKeyDown={e=>{if(e.key==='Escape'){clearTimeout(timer.current);setHover(false);if(trigger.current&&trigger.current.ownerDocument.activeElement!==trigger.current){ignoreFocus.current=true;trigger.current.focus();}e.stopPropagation();}}}>
 <button ref={trigger} className="section-reading-action" type="button" disabled={disabled} title={label+'：'+chapter.title} aria-haspopup={onOpenExisting?'dialog':undefined} aria-expanded={onOpenExisting?hover:undefined} onClick={()=>onOpenExisting?show():setOpen(true)}>{onOpenExisting?'查看本节句读':'句读本节'}</button>
 {onOpenExisting&&hover&&!open&&<span className="section-history-menu" role="dialog" aria-label="本节句读操作"><div><small>当前：{label}</small><button type="button" onClick={()=>{setHover(false);onOpenExisting();}}>查看已有句读</button><button type="button" disabled={disabled} onClick={()=>{setHover(false);setOpen(true);}}>按当前设置重新句读</button></div></span>}
 </span>
 {open&&<dialog ref={dialog} className="section-native-dialog" aria-label="确认本节句读" onCancel={()=>setOpen(false)} onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}><section className="section-scope-card"><span className="semantic-eyebrow">本节 · {label}</span><h3>{chapter.title}</h3><p>{chapter.paragraphs.length} 段 · {length.toLocaleString()} 字符。{readingStyle==='whole'?'以自然段为最小单位，可合并紧密关联的连续段落。':'以句子为最小单位，可合并表达同一意思的连续句子。'}由 Agent 决定分块，直白内容可略过并说明原因。</p><p>图片与图表不在文字解读范围内。逐块生成并保留进度，随时可以停止；使用当前配置的模型与检索授权。重新句读保留旧记录。</p>{tooLarge&&<p role="status">本节超出当前处理上限，请选择较小范围；不会截断原文。</p>}<div className="semantic-actions"><button type="button" autoFocus onClick={()=>setOpen(false)}>暂不开始</button><button type="button" disabled={tooLarge||disabled} onClick={()=>{setOpen(false);onStart(selectionFromParts(chapter.paragraphs.map(p=>({paragraphId:p.id,startOffset:0,endOffset:p.text.length,text:p.text}))),chapter.id);}}>开始本节句读</button></div></section></dialog>}</>;
}
