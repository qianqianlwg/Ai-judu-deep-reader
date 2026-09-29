'use client';
import {useEffect,useState,type RefObject} from 'react';
import type {LibraryBookContent,LibraryChapter} from '@/lib/library';
import type {ReadingSelection} from '@/lib/reader-selection';
import type {EpubInteractionDocument} from './epub-interaction-layer';
import {epubRectToHost,clipReaderRect} from '@/lib/reader-interactions';
import {SectionReadingAction} from './section-reading-action';
type Props={host:RefObject<HTMLDivElement|null>;documents:readonly EpubInteractionDocument[];book:LibraryBookContent;changes:EventTarget;disabled?:boolean;onStart:(selection:ReadingSelection,chapterId:string)=>void;onOpenExisting?:(chapterId:string)=>undefined|(()=>void)};
type Positioned={chapter:LibraryChapter;left:number;top:number};
// WHY：标题入口在应用覆盖层定位；不向原书插入节点，不改写 CFI、分页或 shadow root。
export function EpubSectionActions({host,documents,book,changes,disabled,onStart,onOpenExisting}:Props){
 const [positions,setPositions]=useState<Positioned[]>([]);
 useEffect(()=>{let frame=0;
  const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
   const container=host.current,bounds=container?.getBoundingClientRect();if(!container||!bounds)return;
   const next:Positioned[]=[];
   for(const item of documents){
    const first=item.maps[0]?.paragraph.id,chapter=book.chapters.find(c=>c.paragraphs.some(p=>p.id===first));if(!chapter)continue;
    const normal=(text:string)=>text.replace(/\s/gu,'');
    const headings=Array.from(item.doc.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(h=>normal(h.textContent??'')===normal(chapter.title));
    if(headings.length!==1)continue;const range=item.doc.createRange();range.selectNodeContents(headings[0]);
    const rect=epubRectToHost(item.doc,range.getBoundingClientRect()),visible=clipReaderRect(rect,bounds);
    if(!visible||visible.height<8||rect.right+88>bounds.right||rect.left<bounds.left)continue;
    next.push({chapter,left:rect.right-bounds.left+8+container.offsetLeft,top:rect.top-bounds.top+Math.max(0,(rect.height-28)/2)+container.offsetTop});
   }
   setPositions(next);
  });};
  update();changes.addEventListener('relocate',update);window.addEventListener('resize',update);
  const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(update);if(host.current)observer?.observe(host.current);
  return()=>{cancelAnimationFrame(frame);changes.removeEventListener('relocate',update);window.removeEventListener('resize',update);observer?.disconnect();};
 },[host,documents,book,changes]);
 return <>{positions.map(item=><SectionReadingAction key={item.chapter.id} chapter={item.chapter} disabled={disabled} className='epub-section-action' style={{left:item.left,top:item.top}} onStart={onStart} onOpenExisting={onOpenExisting?.(item.chapter.id)}/>)}</>;
}
