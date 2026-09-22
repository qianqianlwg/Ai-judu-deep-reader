"use client";
import {useCallback,useEffect,useId,useMemo,useRef,useState,type RefObject} from "react";
import {AnnotationPopover,type PopoverSource} from "./annotation-popover";
import {ConceptPopoverContent,HistoryPopoverContent} from "./reading-popover-content";
import {clipReaderRect,epubPointToHost,epubRectToHost,insideRect,type ReaderInteraction,type ReaderRect} from "@/lib/reader-interactions";
import type {TextAnnotation} from "@/lib/annotations";
import "./epub-interaction-layer.css";
export type ReferencePreview={title:string;text:string;address?:string;index?:number;fragment?:string};
export type ReaderInteractionDocument={doc:Document;index:number;targets:ReaderInteraction[];scope?:HTMLElement};
export type OriginalInteractionProps={host:RefObject<HTMLDivElement|null>;documents:readonly ReaderInteractionDocument[];book:object;documentsIdentity?:object;relocationSources?:readonly EventTarget[];disabled?:boolean;onOpenAnnotation?:(annotation:TextAnnotation)=>void;previewLink?:(link:Element,index:number,doc:Document)=>Promise<ReferencePreview>;interceptLink?:(link:Element)=>boolean;referenceUnavailableText?:string;onJump:(preview:ReferencePreview)=>Promise<void>;onNotice:(message:string)=>void};
type Located={target:ReaderInteraction;doc:Document;rect:ReaderRect;rects:ReaderRect[]};
type Active={ownerBook:object;ownerDocuments:object;key:string;pinned:boolean;doc:Document;rect:ReaderRect;sourceRect:()=>ReaderRect|null;focus?:()=>void}&({kind:"concept";target:Extract<ReaderInteraction,{kind:"concept"}>}|{kind:"history";target:Extract<ReaderInteraction,{kind:"history"}>}|{kind:"mark";target:Extract<ReaderInteraction,{kind:"mark"}>}|{kind:"link";link:Element;preview:ReferencePreview|null;index:number});
function selectedInSource(doc:Document,scope?:HTMLElement):boolean{
 const selection=doc.defaultView?.getSelection();if(!selection||selection.isCollapsed||!selection.rangeCount)return false;
 const range=selection.getRangeAt(0),parent=range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer as Element:range.commonAncestorContainer.parentElement;
 if(parent?.closest('[data-reader-decoration],.judu-annotation-popover'))return false;
 return !scope||range.intersectsNode(scope);
}
export function OriginalInteractionLayer(props:OriginalInteractionProps){
 const root=useRef<HTMLDivElement>(null),proxy=useRef<HTMLButtonElement>(null),latest=useRef(props),activeRef=useRef<Active|null>(null),hoverKey=useRef("");
 const [located,setLocated]=useState<Located[]>([]),[activeState,setActive]=useState<Active|null>(null),[anchor,setAnchor]=useState<HTMLElement|null>(null);
 const request=useRef(0),ignoreFocus=useRef(false),id=useId();
 const documentsIdentity=props.documentsIdentity??props.documents;
 const active=!props.disabled&&activeState?.ownerBook===props.book&&activeState.ownerDocuments===documentsIdentity?activeState:null;
 const bindAnchor=useCallback((node:HTMLButtonElement|null)=>{proxy.current=node;setAnchor(node);},[]);
 useEffect(()=>{latest.current=props;});
 // WHY：书籍/版本边界变化必须同步清除 Portal 状态，避免上一版本的浮窗在下一次渲染复活。
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{request.current++;activeRef.current=null;setActive(null);hoverKey.current="";},[props.book,documentsIdentity]);
 const targets=useMemo(()=>props.documents.flatMap(({doc,targets})=>targets.map(target=>({doc,target}))),[props.documents]);
 const geometry=useRef<Located[]>([]);
 const restoreFocus=()=>{ignoreFocus.current=true;const trigger=Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button[data-epub-target]')??[]).find(button=>button.dataset.epubTarget===active?.key);if(active?.focus)active.focus();else if(trigger)trigger.focus();else ignoreFocus.current=false;};
 const close=(restore=false)=>{request.current++;setActive(null);activeRef.current=null;if(restore)restoreFocus();};
 const enterCard=(event:{key:string;shiftKey:boolean;preventDefault():void})=>{if(event.key==='ArrowDown'||(event.key==='Tab'&&!event.shiftKey)){const button=root.current?.ownerDocument.getElementById(id)?.querySelector<HTMLButtonElement>('button:not([disabled])');if(button){event.preventDefault();button.focus();}}};
 const openTarget=(item:Located,pinned:boolean)=>{
  if(latest.current.disabled||props.documents.some(source=>source.doc===item.doc&&selectedInSource(source.doc,source.scope)))return;
  if(activeRef.current?.key===item.target.key){if(pinned&&!activeRef.current.pinned){const next={...activeRef.current,pinned:true};activeRef.current=next;setActive(next);}return;}
  if(activeRef.current?.pinned&&!pinned)return;
  request.current++;const next:Active={ownerBook:latest.current.book,ownerDocuments:latest.current.documentsIdentity??latest.current.documents,...item.target,kind:item.target.kind,target:item.target,key:item.target.key,doc:item.doc,rect:item.rect,pinned,sourceRect:()=>geometry.current.find(entry=>entry.target.key===item.target.key&&entry.doc===item.doc)?.rect??null} as Active;
  activeRef.current=next;setActive(next);
 };
 useEffect(()=>{
  const container=props.host.current;if(!container)return;
  let frame:number|undefined,disposed=false;
  const paint=()=>{
   frame=undefined;const bounds=container.getBoundingClientRect();
   const next:Located[]=targets.flatMap(({doc,target})=>{
    const source=Array.from(target.range.getClientRects()).filter(rect=>rect.width>0&&rect.height>0);
    const raw=target.kind==="history" ? source.slice(-1) : source;
    const rects=raw.map(rect=>epubRectToHost(doc,rect)).flatMap(rect=>{const clipped=clipReaderRect(rect,bounds);return clipped?[clipped]:[];});
    if(!rects.length)return [];
    const last=rects[rects.length-1];
    // WHY：末端标识只在真实结束点所在页显示，不把跨页裁剪的假末尾当作句读结尾。
    if(target.kind==="history"&&source.length){const end=epubRectToHost(doc,source[source.length-1]);if(end.right>bounds.right+1||end.bottom>bounds.bottom+1||end.right<=bounds.left)return [];}
    const rect=target.kind==="history"?{left:Math.min(last.right+2,bounds.right-18),right:Math.min(last.right+2,bounds.right-18)+16,top:Math.max(bounds.top,last.bottom-16),bottom:Math.max(bounds.top,last.bottom-16)+16,width:16,height:16}:rects[0];
    return [{target,doc,rect,rects}];
   });
   geometry.current=next;setLocated(next);
   const current=activeRef.current;
   if(current){const rect=current.kind==="link"?clipReaderRect(epubRectToHost(current.doc,current.link.getBoundingClientRect()),bounds):next.find(item=>item.doc===current.doc&&item.target.key===current.key)?.rect;
    if(!rect||(current.doc!==container.ownerDocument&&!current.doc.defaultView?.frameElement?.isConnected)){request.current++;activeRef.current=null;setActive(null);}else{const item=next.find(item=>item.doc===current.doc&&item.target.key===current.key);const updated={...current,rect,...(item?{target:item.target}:{})} as Active;activeRef.current=updated;setActive(updated);}}
  };
  const schedule=()=>{if(frame!==undefined)cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!disposed)paint();});};
  const relocate=()=>{request.current++;activeRef.current=null;setActive(null);hoverKey.current="";schedule();};
  paint();const resize=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);resize?.observe(container);
  window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);for(const target of props.relocationSources??[])target.addEventListener('relocate',relocate);
  for(const {doc} of props.documents){if(doc.body)resize?.observe(doc.body);if(doc.documentElement)resize?.observe(doc.documentElement);doc.defaultView?.addEventListener('resize',schedule);doc.addEventListener('scroll',relocate,true);doc.fonts?.addEventListener('loadingdone',schedule);}
  return()=>{disposed=true;if(frame!==undefined)cancelAnimationFrame(frame);resize?.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);for(const target of props.relocationSources??[])target.removeEventListener('relocate',relocate);for(const {doc}of props.documents){doc.defaultView?.removeEventListener('resize',schedule);doc.removeEventListener('scroll',relocate,true);doc.fonts?.removeEventListener('loadingdone',schedule);}};
 },[props.host,props.relocationSources,props.documents,targets]);
 useEffect(()=>{
  const cleanups=props.documents.map(({doc,index,scope})=>{
   const selected=()=>selectedInSource(doc,scope);
   const linkFor=(target:EventTarget|null)=>{const element=target as Element|null;const link=element?.closest?.('a[href]');return link&&(!scope||scope.contains(link))?link:null;};
   const openLink=(link:Element,pinned:boolean)=>{
    if(latest.current.disabled||selected()||!latest.current.previewLink)return;
    const key='link:'+index+':'+link.getAttribute('href');
    if(activeRef.current?.kind==='link'&&activeRef.current.link===link){if(pinned){const next={...activeRef.current,pinned:true};activeRef.current=next;setActive(next);}return;}
    if(activeRef.current?.pinned&&!pinned)return;
    const bounds=latest.current.host.current?.getBoundingClientRect();if(!bounds)return;
    const rect=clipReaderRect(epubRectToHost(doc,link.getBoundingClientRect()),bounds);if(!rect)return;
    const sequence=++request.current;
    const next:Active={ownerBook:latest.current.book,ownerDocuments:latest.current.documentsIdentity??latest.current.documents,kind:'link',key,doc,rect,pinned,link,preview:null,index,sourceRect:()=>link.isConnected?epubRectToHost(doc,link.getBoundingClientRect()):null,focus:()=>{(link as HTMLElement).focus();}};
    activeRef.current=next;setActive(next);
    void latest.current.previewLink(link,index,doc).then(preview=>{
     if(sequence!==request.current)return;const current=activeRef.current;if(current?.kind!=='link'||current.link!==link)return;const value={...current,preview};activeRef.current=value;setActive(value);
    }).catch((cause:unknown)=>{console.warn('引用预览失败',cause);if(sequence===request.current&&activeRef.current?.kind==='link'){const value={...activeRef.current,preview:{title:'引用预览',text:latest.current.referenceUnavailableText??'引用正文不可用，可通过原书目录查看。'}};activeRef.current=value;setActive(value);}});
   };
   const hit=(event:MouseEvent)=>{if(scope&&(!(event.target instanceof Node)||!scope.contains(event.target)))return;const point=epubPointToHost(doc,event.clientX,event.clientY);return geometry.current.find(item=>item.doc===doc&&latest.current.documents.some(source=>source.doc===doc&&source.scope===scope&&source.index===index&&source.targets.some(target=>target.key===item.target.key))&&item.target.kind!=='history'&&item.rects.some(rect=>insideRect(rect,point.x,point.y)));};
   const move=(event:MouseEvent)=>{
    if(event.buttons||selected()||latest.current.disabled)return;
    const link=linkFor(event.target);if(link){const key='link:'+index+':'+link.getAttribute('href');if(hoverKey.current!==key){hoverKey.current=key;openLink(link,false);}return;}
    const item=hit(event),key=item?.target.key??'';if(hoverKey.current===key)return;hoverKey.current=key;if(item)openTarget(item,false);
   };
   const focused=(event:FocusEvent)=>{if(ignoreFocus.current){ignoreFocus.current=false;return;}const link=linkFor(event.target);if(link)openLink(link,false);};
   const click=(event:MouseEvent)=>{
    if(selected()||latest.current.disabled)return;const link=linkFor(event.target);
    if(link){if(latest.current.interceptLink?.(link)){event.preventDefault();event.stopPropagation();openLink(link,true);}return;}
    const item=hit(event);if(item)openTarget(item,true);
   };
   const keys=(event:KeyboardEvent)=>{if(activeRef.current?.kind==='link'&&activeRef.current.doc===doc&&event.target!==null&&'nodeType'in event.target&&activeRef.current.link.contains(event.target as Node))enterCard(event);};
   const selection=()=>{if(selected()){request.current++;activeRef.current=null;setActive(null);hoverKey.current='';}};
   doc.addEventListener('mousemove',move);doc.addEventListener('mouseover',move);doc.addEventListener('focusin',focused);doc.addEventListener('click',click,true);doc.addEventListener('selectionchange',selection);doc.addEventListener('keydown',keys);
   return()=>{doc.removeEventListener('mousemove',move);doc.removeEventListener('mouseover',move);doc.removeEventListener('focusin',focused);doc.removeEventListener('click',click,true);doc.removeEventListener('selectionchange',selection);doc.removeEventListener('keydown',keys);};
  });return()=>{for(const cleanup of cleanups)cleanup();};
 // WHY：监听读 latest，标注或模型状态更新无需重建已加载 iframe。
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[props.documents]);
 // WHY：disabled 是加载/请求边界；清掉 React 状态而不只清 ref，重新启用时不能复活旧浮窗。
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{if(props.disabled){request.current++;activeRef.current=null;setActive(null);hoverKey.current="";}},[props.disabled]);
 useEffect(()=>{const pending=request;return()=>{pending.current++;};},[]);
 const source=useMemo<PopoverSource|undefined>(()=>active?{document:active.doc,toHostPoint:(x,y)=>epubPointToHost(active.doc,x,y),containsPoint:(x,y)=>{const point=epubPointToHost(active.doc,x,y);const rects=active.kind==='link'?[active.sourceRect()].filter((r):r is ReaderRect=>Boolean(r)):geometry.current.find(item=>item.target.key===active.key&&item.doc===active.doc)?.rects??[];return rects.some(rect=>insideRect(rect,point.x,point.y));}}:undefined,[active]);
 const bounds=props.host.current?.getBoundingClientRect();
 const local=(rect:ReaderRect)=>({left:rect.left-(bounds?.left??0),top:rect.top-(bounds?.top??0),width:rect.width,height:rect.height});
 return <div ref={root} className="epub-interactions original-interactions" data-reader-decoration="" aria-label="原版阅读交互层">
  {located.filter(item=>item.target.kind!=='mark').map(item=><button key={item.target.key} type="button" data-epub-target={item.target.key} className={item.target.kind==='history'?'epub-history-marker':'epub-concept-trigger'} style={local(item.rect)} disabled={props.disabled} aria-label={item.target.kind==='concept'?'查看概念：'+item.target.concept.name:'查看句读历史（'+(item.target.kind==='history'?item.target.annotations.length:0)+'条）'} aria-haspopup="dialog" aria-controls={active?.key===item.target.key?id:undefined} onKeyDown={enterCard} aria-expanded={active?.key===item.target.key} onMouseEnter={event=>{if(!event.buttons){hoverKey.current=item.target.key;openTarget(item,false);}}} onFocus={()=>{if(ignoreFocus.current){ignoreFocus.current=false;return;}openTarget(item,false);}} onClick={()=>openTarget(item,true)}>{item.target.kind==='history'&&<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 3.5h12v9H9l-4 3v-3H4zM7 7h6M7 9.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>}</button>)}
  {active&&<button ref={bindAnchor} type="button" tabIndex={-1} className="epub-popover-anchor" style={local(active.rect)} aria-label="返回原版引用位置"/>}
  {active&&anchor&&<AnnotationPopover id={id} anchor={anchor} source={source} returnFocus={restoreFocus} title={active.kind==='concept'?active.target.concept.name:active.kind==='history'?'句读历史':active.kind==='mark'?(active.target.annotation.kind==='note'?'笔记':'阅读标记'):(active.preview?.title?.trim() || '引用预览')} pinned={active.pinned} onClose={close}>
   {active.kind==='concept'&&<ConceptPopoverContent concept={active.target.concept}/>}
   {active.kind==='history'&&<HistoryPopoverContent annotations={active.target.annotations} disabled={props.disabled||!props.onOpenAnnotation} onOpen={annotation=>{props.onOpenAnnotation?.(annotation);close();}}/>}
   {active.kind==='mark'&&<p>{active.target.annotation.summary||'此标记已保存，可在知识卡片中查看。'}</p>}
   {active.kind==='link'&&<div className="epub-reference-preview">{active.preview?<><p>{active.preview.text}</p>{active.preview.address&&<details className="epub-link-details"><summary>定位详情</summary><p className="epub-link-address">{active.preview.address}</p></details>}{active.preview.index!==undefined&&<button type="button" disabled={props.disabled} onClick={()=>{const preview=active.preview,sequence=request.current,key=active.key;if(preview)void props.onJump(preview).then(()=>{if(sequence===request.current&&activeRef.current?.key===key)close();}).catch((cause:unknown)=>{console.warn('引用跳转失败',cause);if(sequence===request.current)props.onNotice('引用跳转失败，请从原书目录重试。');});}}>跳转到原文</button>}</>:<p role="status">正在读取引用…</p>}</div>}
  </AnnotationPopover>}
 </div>;
}
