"use client";
import { useEffect, useRef, useState } from "react";
import type { LibraryBookContent, LibraryChapter } from "@/lib/library";
import type { TextAnnotation, ConceptDetail } from "@/lib/annotations";
import type { ReadingAnchor } from "@/lib/pagination";
import type { ReadingSelection } from "@/lib/reader-selection";
import type { ReadingAppearancePreferences } from "@/lib/reading-appearance";
import { getReadingTextStyle, READING_THEMES } from "@/lib/reading-appearance";
import { createFoliateView, loadEpub } from "@/lib/epub-loader";
import { rangeForEpubPosition, anchorFromEpubRange, mapEpubDocument, sameEpubResource, readLimitedEpubSelection, type EpubParagraphMap } from "@/lib/epub-source-map";
import { paintEpubAnnotations, supportsEpubHighlights } from "@/lib/epub-annotations";
import { originalPositionKey, readOriginalPosition, convertedPositionKey, readConvertedPosition, sameReadingAnchor } from "@/lib/epub-position";
import { resolveConvertedEpub, verifyConvertedEpub, type ConvertedEpubArtifact } from "@/lib/converted-epub-artifact";
import type { FoliateTocItem } from "@/lib/foliate-types";
import type { EpubLinkPreview } from "@/lib/epub-link-preview";
import { EpubInteractionLayer, type EpubInteractionDocument } from "./epub-interaction-layer";
import "./epub-reader.css";
import {mapMobiDocument} from "@/lib/mobi-browser-source-map";
import {isFb2Format} from "@/lib/fb2-format";

type View = Awaited<ReturnType<typeof createFoliateView>>;
type EpubBook = Awaited<ReturnType<typeof loadEpub>>;
type LoadedDocument = { doc: Document; index: number; maps: EpubParagraphMap[]; cleanup(): void; paintCleanup(): void };
type Session = { sourceBook: LibraryBookContent; artifact: ConvertedEpubArtifact | null; view: View; book: EpubBook; documents: Map<number, LoadedDocument>; anchor: ReadingAnchor | null; shouldSave: boolean; navigating: number; closed: boolean };
export type EpubReaderProps = {
  book: LibraryBookContent; anchor: ReadingAnchor | null; appearance: ReadingAppearancePreferences;
  annotations: readonly TextAnnotation[]; concepts: readonly ConceptDetail[]; disabled?: boolean;
  onSelect(selection: ReadingSelection, box: {left:number;top:number}): void;
  onOpenAnnotation?(annotation: TextAnnotation): void;
  onStartSelection?(): void; onClearSelection?(): void; onPosition(anchor: ReadingAnchor): void; onNotice(message: string): void; onFallback(): void;
};
const chapterFor = (book: LibraryBookContent, href: string | undefined): LibraryChapter | undefined => book.chapters.find(chapter => sameEpubResource(chapter.sourceHref, href));

async function bounded<T>(work:Promise<T>, milliseconds=20000):Promise<T> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try { return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("原版渲染超时，请重试或切回精读。")),milliseconds);})]); }
  finally {clearTimeout(timer);}
}
function documentMaps(doc:Document, index:number, session:Session, book:LibraryBookContent):EpubParagraphMap[] {
  const section=session.book.sections[index];
  const chapter=chapterFor(book,section?.id ?? section?.href);
  return chapter ? book.edition?.fileType===".mobi"?mapMobiDocument(doc,chapter):mapEpubDocument(doc,chapter,isFb2Format(book.edition?.fileType??"")?"[data-fb2-paragraph]":undefined) : [];
}
export function appearanceCss(appearance:ReadingAppearancePreferences):string {
  const style=getReadingTextStyle(appearance), theme=READING_THEMES.find(item=>item.id===appearance.theme)!;
  return `html{color-scheme:${theme.scheme};}body{color:${theme.text};background:${theme.paper};font-family:${style.fontFamily};font-size:${appearance.fontSize}px;line-height:${appearance.lineHeight};text-align:${appearance.textAlign};letter-spacing:${appearance.letterSpacing}em;}img,svg{max-width:100%;}a{cursor:pointer;}`;
}

export function EpubReader(props:EpubReaderProps) {
  const host=useRef<HTMLDivElement>(null), latest=useRef(props), sessionRef=useRef<Session|null>(null);
  const [status,setStatus]=useState(props.book.edition?.fileType === ".umd" ? "正在加载 UMD 转换版…" : "正在加载 EPUB 原版…"), [error,setError]=useState(""), [ready,setReady]=useState(false);
  const [progress,setProgress]=useState(""), [retry,setRetry]=useState(0);
  const [session,setSession]=useState<Session|null>(null);
  const [documents,setDocuments]=useState<EpubInteractionDocument[]>([]);
  const {book}=props;
  const converted = book.edition?.fileType === ".umd";
  const modeLabel = converted ? "转换版" : "原版";
  const readerLabel = converted ? "UMD 转换版" : (book.edition?.fileType===".mobi"?"MOBI":isFb2Format(book.edition?.fileType??"") ? "FB2" : "EPUB") + " 原版";
  const conversionState = resolveConvertedEpub(book);
  useEffect(()=>{latest.current=props;});

  function fail(cause:unknown) { setReady(false); console.error(readerLabel+"阅读失败",cause); setError(cause instanceof Error ? cause.message : modeLabel+"阅读暂不可用，请切回精读或重试。"); }
  // WHY：异步任务完成/失败时再次核对会话；旧派生版本不能覆盖新版本UI、目录或位置。
  const currentSession=(s:Session)=>!s.closed&&sessionRef.current===s;
  function failSession(s:Session,cause:unknown){if(currentSession(s))fail(cause);else console.warn("已忽略过期阅读会话的错误",cause);}
  function savePosition(s:Session,cfi:string) {
    if(!currentSession(s))return;
    const source=s.sourceBook;
    if(!source.editionId || !cfi.startsWith("epubcfi("))return;
    try {
      // WHY：CFI属于实际渲染的派生字节，独立key与双hash防止原UMD/旧转换记录污染恢复位置。
      if(s.artifact){const {sourceHash,fileHash,converterVersion}=s.artifact.conversion;localStorage.setItem(convertedPositionKey(source.editionId),JSON.stringify({version:1,kind:"umd-epub",sourceHash,fileHash,converterVersion,cfi,anchor:s.anchor}));}
      else localStorage.setItem(originalPositionKey((s.book.positionIdentity?"mobi:":"")+source.editionId),JSON.stringify({version:1,originalHash:s.book.positionIdentity ?? source.edition?.originalHash ?? "",cfi,anchor:s.anchor}));
    }
    catch(cause:unknown){console.error("原版阅读位置保存失败",cause);latest.current.onNotice("原版阅读位置保存失败，请检查浏览器存储。");}
  }

  useEffect(()=>{
    let cancelled=false, owned:Session|null=null, pendingBook:EpubBook|null=null;
    const controller=new AbortController();
    const display=host.current;
    if(!display || !book.editionId)return;
    const teardown=()=>{
      if(!owned){pendingBook?.destroy?.();pendingBook=null;return;}if(owned.closed)return;owned.closed=true;
      for(const loaded of owned.documents.values()){loaded.cleanup();loaded.paintCleanup();}
      owned.documents.clear(); owned.view.close();owned.view.remove();owned.book.destroy?.();
      if(sessionRef.current===owned)sessionRef.current=null;
    };
    void (async()=>{
      setReady(false);setError("");setStatus("正在加载 "+readerLabel+"…");setDocuments([]);
      const source=resolveConvertedEpub(book);
      if(source.kind==="invalid")throw new Error(source.message);
      const artifact=source.kind==="ready"?source.artifact:null;
      const mobi=book.edition?.fileType===".mobi";
      const response=await fetch(artifact?.url ?? `/api/books/${encodeURIComponent(book.id)}/${mobi?"mobi-layout":"original"}?editionId=${encodeURIComponent(book.editionId!)}`,{signal:controller.signal,cache:"no-store"});
      if(!response.ok) {
        let message=(artifact?"转换文件":"原文件")+"读取失败（HTTP "+response.status+"），可切回精读。";
        if(response.headers.get("content-type")?.includes("json")) {const body:unknown=await response.json();if(body&&typeof body==="object"&&"error"in body&&typeof body.error==="string")message=body.error;}
        throw new Error(message);
      }
      setStatus("正在校验并准备"+modeLabel+"章节…");
      let epub:EpubBook;
      if(mobi){
        const loaded=await(await import("@/lib/mobi-loader")).loadMobiPublication(response,book.edition?.originalHash??"");epub=loaded.book;
        if(!cancelled&&loaded.warnings.length)latest.current.onNotice(loaded.warnings.join(" "));
      }else{
        let bytes:Blob;
        if(artifact){const buffer=await response.arrayBuffer();if(cancelled)return;await verifyConvertedEpub(buffer,artifact);bytes=new Blob([buffer],{type:"application/epub+zip"});}
        else bytes=await response.blob();
        if(cancelled)return;
        // WHY：保留上游原生blob加载；MOBI只更换输入适配器，精读交互与视图生命周期继续复用。
        epub=isFb2Format(book.edition?.fileType??"")?await(await import("@/lib/fb2-loader")).loadFb2(bytes,book.edition!.fileType):await loadEpub(bytes);
      }
      pendingBook=epub;
      if(cancelled){epub.destroy?.();return;}
      const view=await createFoliateView();
      if(cancelled){epub.destroy?.();view.close();return;}
      const s:Session={sourceBook:book,artifact,view,book:epub,documents:new Map(),anchor:latest.current.anchor,shouldSave:false,navigating:0,closed:false};
      owned=s;pendingBook=null;sessionRef.current=s;
      view.style.cssText="display:block;width:100%;height:100%;";view.setAttribute("aria-label",readerLabel+"内容");display.append(view);
      view.addEventListener("external-link",event=>{event.preventDefault();latest.current.onNotice("为保护本地书库，已阻止书籍打开外部链接。");});
      view.addEventListener("load",event=>{
        const {doc,index}=(event as CustomEvent<{doc:Document;index:number}>).detail;
        if(cancelled || !doc?.body || !Number.isInteger(index))return;
        const old=s.documents.get(index);old?.cleanup();old?.paintCleanup();
        const maps=documentMaps(doc,index,s,book);
        if(isFb2Format(book.edition?.fileType??"")&&!chapterFor(book,s.book.sections[index]?.id)?.paragraphs.length)latest.current.onNotice("本章为图片内容，可查看原版；没有文字来源时不能直接句读，OCR尚未启用。");
        if(!supportsEpubHighlights(doc))latest.current.onNotice("当前浏览器不支持原版高亮图层，标注仍会保存，可切回精读查看。 ");
        let lastSelectionKey="";
        const onSelection=()=>{
          if(latest.current.disabled)return;
          const selection=doc.defaultView?.getSelection();if(!selection?.rangeCount || selection.isCollapsed)return;
          const snapshot=readLimitedEpubSelection(selection,maps,()=>latest.current.onNotice("最多选择 1000 字，选区已限制到上限。"));
          if(!snapshot){lastSelectionKey="";latest.current.onClearSelection?.();latest.current.onNotice("选区包含尚未建立文本来源的内容，不能可靠保存句读位置；请重新选择正文。此次未提交任何选文。");return;}
          const key=JSON.stringify(snapshot);if(key===lastSelectionKey)return;lastSelectionKey=key;
          const range=selection.getRangeAt(0);
          const rect=range.getBoundingClientRect(),frame=doc.defaultView?.frameElement?.getBoundingClientRect();
          s.anchor={paragraphId:snapshot.paragraphId,offset:snapshot.startOffset};savePosition(s,view.getCFI(index,range));
          const frameElement=doc.defaultView?.frameElement;
          const scaleX=frame && frameElement?.clientWidth ? frame.width/frameElement.clientWidth : 1;
          const scaleY=frame && frameElement?.clientHeight ? frame.height/frameElement.clientHeight : 1;
          latest.current.onSelect(snapshot,{left:(frame?.left??0)+(rect.left+rect.width/2)*scaleX,top:Math.max(58,(frame?.top??0)+rect.top*scaleY-8)});
        };
        let selectionTimer:ReturnType<typeof setTimeout>|undefined;
        const scheduleSelection=()=>{clearTimeout(selectionTimer);selectionTimer=setTimeout(onSelection,100);};
        const startSelection=()=>{lastSelectionKey="";clearTimeout(selectionTimer);(latest.current.onStartSelection??latest.current.onClearSelection)?.();};
        doc.addEventListener("pointerdown",startSelection);
        doc.addEventListener("selectionchange",scheduleSelection);
        doc.addEventListener("mouseup",onSelection);doc.addEventListener("keyup",onSelection);doc.addEventListener("touchend",onSelection);
        const loaded:LoadedDocument={doc,index,maps,paintCleanup:()=>{},cleanup:()=>{clearTimeout(selectionTimer);doc.removeEventListener("pointerdown",startSelection);doc.removeEventListener("selectionchange",scheduleSelection);doc.removeEventListener("mouseup",onSelection);doc.removeEventListener("keyup",onSelection);doc.removeEventListener("touchend",onSelection);}};
        loaded.paintCleanup=paintEpubAnnotations(doc,maps,latest.current.annotations,latest.current.concepts);s.documents.set(index,loaded);
        setDocuments([...s.documents.values()]);
      });
      view.addEventListener("relocate",event=>{
        if(cancelled)return;
        const detail=(event as CustomEvent<{cfi?:string;index?:number;section?:{current:number};fraction?:number;range?:Range}>).detail;
        const section=detail.section?.current ?? detail.index ?? [...s.documents.values()].find(loaded=>loaded.doc===detail.range?.startContainer.ownerDocument)?.index ?? 0;
        setProgress(`章节 ${section+1} / ${epub.sections.length}${typeof detail.fraction==="number"&&Number.isFinite(detail.fraction)?" · "+Math.round(detail.fraction*100)+"%":""}`);
        if(!s.shouldSave)return;s.shouldSave=false;
        const loaded=s.documents.get(section);
        const anchor=loaded&&detail.range ? anchorFromEpubRange(detail.range,loaded.maps) : null;
        if(anchor){s.anchor=anchor;latest.current.onPosition(anchor);}
        if(detail.cfi)savePosition(s,detail.cfi);
      });
      setStatus("正在装配原版阅读器…");
      await bounded(view.open(epub)); if(cancelled)return;
      view.renderer?.setStyles(appearanceCss(latest.current.appearance));
      // WHY：触摸/滚动翻页来自 renderer 而非工具栏。只记录主动位移，字体 reflow 不覆盖 canonical 锚点。
      view.renderer.addEventListener("relocate",event=>{
        const reason=(event as CustomEvent<{reason?:string}>).detail?.reason;
        if(reason && ["page","snap","scroll"].includes(reason))s.shouldSave=true;
      },true);
      setStatus("正在加载"+modeLabel+"章节…");
      let saved=null;
      try{saved=artifact?readConvertedPosition(localStorage.getItem(convertedPositionKey(book.editionId!)),artifact.conversion):readOriginalPosition(localStorage.getItem(originalPositionKey((epub.positionIdentity?"mobi:":"")+book.editionId!)),epub.positionIdentity ?? book.edition?.originalHash ?? "");}catch(cause:unknown){console.warn("无法读取原版位置",cause);}
      if(saved&&sameReadingAnchor(saved.anchor,latest.current.anchor)) {
        try { const target=view.resolveCFI(saved.cfi);if(!epub.sections[target.index])throw new Error("位置不属于本书");await bounded(view.init({lastLocation:saved.cfi,showTextStart:true})); }
        catch(cause:unknown){if(cancelled||!currentSession(s)){console.warn("已关闭的阅读会话初始化失败，未重试旧视图",cause);return;}console.warn("原版位置已失效，回退精读锚点",cause);latest.current.onNotice("原版位置已失效，已回退到精读锚点。");saved=null;await bounded(view.init({showTextStart:true}));}
      } else await bounded(view.init({showTextStart:true}));
      if(cancelled)return;
      if(!saved || !sameReadingAnchor(saved.anchor,latest.current.anchor))await bounded(navigateToAnchor(s,latest.current.anchor));
      if(cancelled||!currentSession(s))return;
      setStatus("");setReady(true);setSession(s);
    })().catch(cause=>{if(!cancelled){fail(cause);teardown();}});
    return ()=>{cancelled=true;controller.abort();teardown();};
    // WHY：回调、标注与字体变化不能重新下载/重开书籍；它们由 latest 或独立 effect 更新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[book.id,book.editionId,book.edition?.fileType,book.edition?.originalHash,book.edition?.conversion?.sourceHash,book.edition?.conversion?.fileHash,book.edition?.conversion?.fileSize,book.edition?.conversion?.converterVersion,retry]);

  async function navigateToAnchor(s:Session,anchor:ReadingAnchor|null) {
    if(!anchor || !currentSession(s))return;
    const source=s.sourceBook;
    const chapter=source.chapters.find(item=>item.paragraphs.some(p=>p.id===anchor.paragraphId));
    const index=s.book.sections.findIndex(section=>sameEpubResource(chapter?.sourceHref,section.id??section.href));
    if(!chapter || index<0) {latest.current.onNotice("阅读器中找不到这个精读位置，可切回精读查看；未猜测替代位置。");return;}
    const sequence=++s.navigating;
    const current=()=>currentSession(s)&&sequence===s.navigating;
    try {
      const doc=await s.book.sections[index].createDocument();
      if(!current())return;
      if(!rangeForEpubPosition(documentMaps(doc,index,s,source),anchor.paragraphId,anchor.offset)) {latest.current.onNotice("该段排版与精读文本无法精确映射，请切回精读定位。");return;}
      s.anchor=anchor;
      await s.view.renderer!.goTo({index,anchor:(target:Document)=>{
        const range=rangeForEpubPosition(documentMaps(target,index,s,source),anchor.paragraphId,anchor.offset);
        if(!range)throw new Error("阅读锚点在渲染后失效，请切回精读");return range;
      }});
      if(!current())return;
      const cfi=s.view.lastLocation?.cfi;if(cfi)savePosition(s,cfi);
    } catch(cause:unknown) {
      if(!current()){console.warn("已忽略过期阅读定位的错误",cause);return;}
      throw cause;
    }
  }
  useEffect(()=>{if(session&&currentSession(session)&&!sameReadingAnchor(session.anchor,props.anchor))void navigateToAnchor(session,props.anchor).catch(cause=>failSession(session,cause));},[session,props.anchor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(session&&!session.closed)session.view.renderer?.setStyles(appearanceCss(props.appearance));},[session,props.appearance]);
  useEffect(()=>{if(session&&!session.closed)for(const loaded of session.documents.values()){loaded.paintCleanup();loaded.paintCleanup=paintEpubAnnotations(loaded.doc,loaded.maps,props.annotations,props.concepts);}},[session,props.annotations,props.concepts]);

  async function jumpPreview(preview:EpubLinkPreview) {
    const s=sessionRef.current;
    if(!s||!currentSession(s)||preview?.index===undefined)return;
    try {
      s.shouldSave=true;
      await s.view.renderer.goTo({index:preview.index,anchor:doc=>{
        if(preview.navigationHref){const resolved=s.book.resolveHref?.(preview.navigationHref);if(!resolved||resolved.index!==preview.index)throw new Error("引用目标已失效");const target=resolved.anchor(doc);if(typeof target==="number")throw new Error("引用缺少精确位置");return target;}
        const target=preview.fragment?doc.getElementById(preview.fragment):doc.body;
        if(!target)throw new Error("引用目标不可用");return target;
      }});

    } catch(cause:unknown){console.warn("引用跳转失败",cause);if(currentSession(s))latest.current.onNotice("引用跳转失败，请从原书目录重试。");}
  }
  async function turn(direction:"next"|"prev") {const s=sessionRef.current;if(!s||!currentSession(s)||props.disabled)return;try{s.shouldSave=true;await s.view[direction]();}catch(cause:unknown){failSession(s,cause);}}
  const toc:FoliateTocItem[]=[];
  const collect=(items:FoliateTocItem[])=>{for(const item of items){toc.push(item);if(item.subitems)collect(item.subitems);}};
  collect(session?.book.toc ?? []);
  async function openToc(href:string) {
    const s=session;if(!s||!currentSession(s))return;
    try{const target=s.book.resolveHref?.(href);if(!target)throw new Error("目录目标无效");s.shouldSave=true;await s.view.renderer.goTo({index:target.index,anchor:doc=>{const anchor=target.anchor(doc);return typeof anchor==="number"?doc.body:anchor;}});}
    catch(cause:unknown){failSession(s,cause);}
  }
  return <section className="epub-reader" aria-label={readerLabel+"阅读器"} aria-busy={!ready&&!error}>
    <div className="epub-host" ref={host}/>
    {status&&!error&&<div className="epub-status" role="status">{status}</div>}
    {error&&<div className="epub-error" role="alert"><p>{error}</p><button onClick={()=>setRetry(x=>x+1)}>重试{modeLabel}</button><button onClick={props.onFallback}>切回精读</button></div>}
    {conversionState.kind==="ready"&&<div className="epub-conversion-notice" role="note"><span>UMD → EPUB 转换版 · 保留原文，不代表原文件版式</span><a href={conversionState.artifact.originalUrl} download aria-label="下载 UMD 原件（未经转换）">下载 UMD 原件</a></div>}
    <nav className="epub-navigation" aria-label={modeLabel+"翻页"}><button disabled={!ready||props.disabled} onClick={()=>void turn("prev")}>{modeLabel}上一页</button><span>{progress || (converted?"转换章节":"原书布局")}</span>{toc.length>0&&<select aria-label="原书目录" value="" disabled={!ready||props.disabled} onChange={event=>void openToc(event.target.value)}><option value="" disabled>原书目录</option>{toc.map((item,index)=><option key={index} value={item.href}>{item.label}</option>)}</select>}<button disabled={!ready||props.disabled} onClick={()=>void turn("next")}>{modeLabel}下一页</button></nav>
    {session&&!session.closed&&!error&&<EpubInteractionLayer host={host} documents={documents} view={session.view} book={session.book} annotations={props.annotations} concepts={props.concepts} disabled={props.disabled} onOpenAnnotation={props.onOpenAnnotation} onJump={jumpPreview} onNotice={props.onNotice}/>} 
  </section>;
}
