"use client";
import { SpeechPlaybackBar } from "./speech-controls";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LibraryBookContent, LibraryChapter } from "@/lib/library";
import type { HistoryPopoverReading } from "./reading-popover-content";
import type { TextAnnotation, ConceptDetail } from "@/lib/annotations";
import { analysisHistoryMarkerIds } from "@/lib/analysis-history-markers";
import type { ReadingAnchor } from "@/lib/pagination";
import { bindSettledSelection } from "@/lib/settled-selection";
import type { ReadingSelection } from "@/lib/reader-selection";
import { readAnalysisOnlySelection } from "@/lib/analysis-only-selection";
import { ANALYSIS_ONLY_NOTICE, type AnalysisOnlySource } from "@/lib/analysis-only-source";
import type { ReadingAppearancePreferences } from "@/lib/reading-appearance";
import { getReadingTextStyle, READING_THEMES } from "@/lib/reading-appearance";
import { createFoliateView, loadEpub } from "@/lib/epub-loader";
import { rangeForEpubPosition, anchorFromEpubRange, mapEpubDocument, sameEpubResource, readLimitedEpubSelection, type EpubParagraphMap } from "@/lib/epub-source-map";
import { paintEpubAnnotations, supportsEpubHighlights } from "@/lib/epub-annotations";
import { originalPositionKey, readOriginalPosition, convertedPositionKey, readConvertedPosition, sameReadingAnchor } from "@/lib/epub-position";
import { resolveConvertedEpub, verifyConvertedEpub, type ConvertedEpubArtifact } from "@/lib/converted-epub-artifact";
import type { EpubLinkPreview } from "@/lib/epub-link-preview";
import { EpubInteractionLayer, type EpubInteractionDocument } from "./epub-interaction-layer";
import "./epub-reader.css";
import { ReaderPageJump } from "./reader-page-jump";
import {mapMobiDocument} from "@/lib/mobi-browser-source-map";
import {createReaderOperationQueue,runReaderOperation,ReaderOperationTimeout} from "@/lib/reader-operation";
import {isFb2Format} from "@/lib/fb2-format";

type View = Awaited<ReturnType<typeof createFoliateView>>;
type EpubBook = Awaited<ReturnType<typeof loadEpub>>;
type LoadedDocument = { doc: Document; index: number; maps: EpubParagraphMap[]; cleanup(): void; paintCleanup(): void };
type Session = { sourceBook: LibraryBookContent; artifact: ConvertedEpubArtifact | null; view: View; book: EpubBook; documents: Map<number, LoadedDocument>; anchor: ReadingAnchor | null; shouldSave: boolean; navigating: number; closed: boolean; stop():void; signal:AbortSignal; operations:ReturnType<typeof createReaderOperationQueue> };
export type EpubReaderProps = {
  onTocLocation?:(href:string)=>void;
  navigationTarget?: {href:string;sequence:number}|null;
  sourceEmphasis?: readonly import("@/lib/source-enhancement").SourceEmphasis[];
  book: LibraryBookContent; anchor: ReadingAnchor | null; appearance: ReadingAppearancePreferences;
  annotations: readonly TextAnnotation[]; concepts: readonly ConceptDetail[]; showAnalysisHints?: boolean; analysisHintOpacity?: number; disabled?: boolean; selectionDisabled?: boolean; navigationDisabled?: boolean;
  onSelect(selection: ReadingSelection, box: {left:number;top:number}): void;
  onAnalysisOnlySelect?(selection: AnalysisOnlySource, box: {left:number;top:number}): void;
  onSelectionDocument?(doc: Document): void;
  historyReadingsByMessageId?: ReadonlyMap<string,HistoryPopoverReading>;
  onOpenAnnotation?(annotation: TextAnnotation): void;
  onStartSelection?(): void; onClearSelection?(): void; onPosition(anchor: ReadingAnchor): void; onNotice(message: string): void; onFallback(): void;
};
const chapterFor = (book: LibraryBookContent, href: string | undefined): LibraryChapter | undefined => book.chapters.find(chapter => sameEpubResource(chapter.sourceHref, href));

function documentMaps(doc:Document, index:number, session:Session, book:LibraryBookContent):EpubParagraphMap[] {
  const section=session.book.sections[index];
  const chapter=chapterFor(book,section?.id ?? section?.href);
  return chapter ? book.edition?.fileType===".mobi"?mapMobiDocument(doc,chapter):mapEpubDocument(doc,chapter,isFb2Format(book.edition?.fileType??"")?"[data-fb2-paragraph]":undefined) : [];
}
export function appearanceCss(appearance:ReadingAppearancePreferences, documentOrigin?:string):string {
  const style=getReadingTextStyle(appearance), theme=READING_THEMES.find(item=>item.id===appearance.theme)!;
  // WHY：部分 EPUB 在 body 类上以 1em 指定字号，类选择器会覆盖 body 规则；同时调整根字号，才能让书内相对字号随阅读设置缩放。
  // WHY：正文段落的出版方 class 往往自行设置 line-height；只覆盖正文块的行距/字距，不改标题、表格和图片。
  // WHY：原版 EPUB 是 blob: 文档，根相对 URL 无法解析；从宿主页面传入同源 origin 后生成绝对字体地址。
  const fontUrl = documentOrigin ? new URL("/fonts/lxgw-wenkai/LXGWWenKai-Regular.ttf", documentOrigin).href : "/fonts/lxgw-wenkai/LXGWWenKai-Regular.ttf";
  const localFont = appearance.font === "wenkai" ? `@font-face{font-family:"LXGW WenKai Reader";src:url("${fontUrl}") format("truetype");font-style:normal;font-weight:400;font-display:swap;}` : "";
  // WHY：原版 EPUB 正文在独立文档内，必须在那里声明相同的自托管字库；其它字体不加载此资源。
  // WHY：仅在用户显式选择时覆盖书内正文及内联文字字体，不改字号、缩进和对齐。
  const overrideBodyFont = appearance.originalBodyFontOverride ? `body :is(p,li,blockquote),body :is(p,li,blockquote) :not(svg,svg *){font-family:${style.fontFamily} !important;}` : "";
  return `${localFont}html{color-scheme:${theme.scheme};font-size:${appearance.fontSize}px;}body{color:${theme.text};background:${theme.paper};font-family:${style.fontFamily};font-size:${appearance.fontSize}px;line-height:${appearance.lineHeight};text-align:${appearance.textAlign};letter-spacing:${appearance.letterSpacing}em;}body :is(p,li,blockquote){line-height:${appearance.lineHeight} !important;letter-spacing:${appearance.letterSpacing}em !important;}img,svg{max-width:100%;}a{cursor:pointer;}${overrideBodyFont}`;
}

export function EpubReader(props:EpubReaderProps) {
  const historyMarkerIds = useMemo(() => analysisHistoryMarkerIds(props.annotations, props.book.chapters.flatMap(chapter => chapter.paragraphs.map(paragraph => paragraph.id))), [props.annotations, props.book]);
  const host=useRef<HTMLDivElement>(null), latest=useRef(props), sessionRef=useRef<Session|null>(null);
  const handledNavigation=useRef<{editionId?:string;sequence:number}|null>(null);
  const [status,setStatus]=useState(props.book.edition?.fileType === ".umd" ? "正在加载 UMD 转换版…" : "正在加载 EPUB 原版…"), [error,setError]=useState(""), [ready,setReady]=useState(false);
  const [pageLocation,setPageLocation]=useState<{current:number;total:number;section:number}|null>(null);
  const [bookProgress,setBookProgress]=useState<number|null>(null);
  const [progress,setProgress]=useState(""), [retry,setRetry]=useState(0);
  const [session,setSession]=useState<Session|null>(null);
  const [documents,setDocuments]=useState<EpubInteractionDocument[]>([]);
  const {book}=props;
  const converted = book.edition?.fileType === ".umd";
  const modeLabel = converted ? "转换版" : "原版";
  const readerLabel = converted ? "UMD 转换版" : (book.edition?.fileType===".mobi"?"MOBI":isFb2Format(book.edition?.fileType??"") ? "FB2" : "EPUB") + " 原版";
  const conversionState = resolveConvertedEpub(book);
  useEffect(()=>{latest.current=props;});

  function fail(cause:unknown) { setReady(false); console.error(readerLabel+"阅读失败",cause); setError(cause instanceof Error ? cause.message : modeLabel+"阅读暂不可用，请返回书架或重试。"); }
  // WHY：异步任务完成/失败时再次核对会话；旧派生版本不能覆盖新版本UI、目录或位置。
  const currentSession=(s:Session)=>!s.closed&&sessionRef.current===s;
  function failSession(s:Session,cause:unknown){if(currentSession(s)){fail(cause);s.stop();}else console.warn("已忽略过期阅读会话的错误",cause);}
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
    const operations=createReaderOperationQueue(controller.signal);
    const display=host.current;
    if(!display || !book.editionId)return;
    const teardown=()=>{
      cancelled=true;controller.abort();
      if(!owned){pendingBook?.destroy?.();pendingBook=null;return;}if(owned.closed)return;owned.closed=true;
      for(const loaded of owned.documents.values()){loaded.cleanup();loaded.paintCleanup();}
      owned.documents.clear(); owned.view.close();owned.view.remove();owned.book.destroy?.();
      if(sessionRef.current===owned)sessionRef.current=null;
    };
    void (async()=>{
      setReady(false);setError("");setStatus("正在加载 "+readerLabel+"…");setDocuments([]);setProgress("");setBookProgress(null);setPageLocation(null);setSession(null);
      const source=resolveConvertedEpub(book);
      if(source.kind==="invalid")throw new Error(source.message);
      const artifact=source.kind==="ready"?source.artifact:null;
      const mobi=book.edition?.fileType===".mobi";
      const response=await fetch(artifact?.url ?? `/api/books/${encodeURIComponent(book.id)}/${mobi?"mobi-layout":"original"}?editionId=${encodeURIComponent(book.editionId!)}`,{signal:controller.signal,cache:"no-store"});
      if(cancelled)return;
      if(!response.ok) {
        let message=(artifact?"转换文件":"原文件")+"读取失败（HTTP "+response.status+"），可返回书架。";
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
        let initialCfi: string | undefined;
        try {
          const position = artifact
            ? readConvertedPosition(localStorage.getItem(convertedPositionKey(book.editionId!)), artifact.conversion)
            : readOriginalPosition(localStorage.getItem(originalPositionKey(book.editionId!)), book.edition?.originalHash ?? '');
          if (position && sameReadingAnchor(position.anchor, latest.current.anchor)) initialCfi = position.cfi;
        } catch (cause: unknown) { console.warn('无法读取原版预热位置', cause); }
        const initialHref = book.chapters.find(chapter => chapter.paragraphs.some(paragraph => paragraph.id === latest.current.anchor?.paragraphId))?.sourceHref;
        // WHY：先准备阅读位置附近十个章节；EPUB 页数取决于字体/视口，排版前不能把章节伪称为精确十页。
        // WHY：保留上游原生blob加载；MOBI只更换输入适配器，精读交互与视图生命周期继续复用。
        epub=isFb2Format(book.edition?.fileType??"")?await(await import("@/lib/fb2-loader")).loadFb2(bytes,book.edition!.fileType):await loadEpub(bytes, { progressive: true, initialHref, initialCfi, signal: controller.signal });
      }
      pendingBook=epub;
      if(cancelled){epub.destroy?.();return;}
      const view=await createFoliateView();
      if(cancelled){epub.destroy?.();view.close();return;}
      const s:Session={sourceBook:book,artifact,view,book:epub,documents:new Map(),anchor:latest.current.anchor,shouldSave:false,navigating:0,closed:false,stop:teardown,signal:controller.signal,operations};
      owned=s;pendingBook=null;sessionRef.current=s;
      view.style.cssText="display:block;width:100%;height:100%;";view.setAttribute("aria-label",readerLabel+"内容");display.append(view);
      view.addEventListener("external-link",event=>{event.preventDefault();latest.current.onNotice("为保护本地书库，已阻止书籍打开外部链接。");});
      view.addEventListener("load",event=>{
        const {doc,index}=(event as CustomEvent<{doc:Document;index:number}>).detail;
        if(cancelled || !currentSession(s) || !doc?.body || !Number.isInteger(index))return;
        const old=s.documents.get(index);old?.cleanup();old?.paintCleanup();
        const maps=documentMaps(doc,index,s,book);
        if(isFb2Format(book.edition?.fileType??"")&&!chapterFor(book,s.book.sections[index]?.id)?.paragraphs.length)latest.current.onNotice("本章为图片内容，可查看原版；没有文字来源时不能直接句读，OCR尚未启用。");
        if(!supportsEpubHighlights(doc))latest.current.onNotice("当前浏览器不支持原版高亮图层，标注仍会保存，可返回书架查看。 ");
        let lastSelectionKey="";
        const onSelection=()=>{
          // WHY：生成期间可重新选文供朗读，原版交互和新句读仍保持锁定。
          if(latest.current.selectionDisabled ?? latest.current.disabled)return;
          const selection=doc.defaultView?.getSelection();if(!selection?.rangeCount || selection.isCollapsed)return;
          // WHY：先验证完整范围；映射失败不再剔除标题后冒充完整选文，转为明确的仅分析材料。
          const onLimit=()=>latest.current.onNotice("最多选择 3000 字符，选区已限制到上限。");
          const snapshot=readLimitedEpubSelection(selection,maps,onLimit);
          if(!snapshot){
            const loose=latest.current.onAnalysisOnlySelect && readAnalysisOnlySelection(selection,doc.body,onLimit);
            if(!loose){lastSelectionKey="";latest.current.onClearSelection?.();latest.current.onNotice("选区没有可提交的文字，或当前调用方未启用仅分析；图片文字需要 OCR。此次未提交任何选文。");return;}
            const key=JSON.stringify(loose);if(key===lastSelectionKey)return;lastSelectionKey=key;
            const rect=selection.getRangeAt(0).getBoundingClientRect(),frame=doc.defaultView?.frameElement?.getBoundingClientRect(),element=doc.defaultView?.frameElement;
            const sx=frame && element?.clientWidth ? frame.width/element.clientWidth : 1,sy=frame && element?.clientHeight ? frame.height/element.clientHeight : 1;
            latest.current.onSelectionDocument?.(doc);
            latest.current.onAnalysisOnlySelect?.(loose,{left:(frame?.left??0)+(rect.left+rect.width/2)*sx,top:Math.max(58,(frame?.top??0)+rect.top*sy-8)});
            latest.current.onNotice(ANALYSIS_ONLY_NOTICE);return;
          }
          const key=JSON.stringify(snapshot);if(key===lastSelectionKey)return;lastSelectionKey=key;
          const range=selection.getRangeAt(0);
          const rect=range.getBoundingClientRect(),frame=doc.defaultView?.frameElement?.getBoundingClientRect();
          s.anchor={paragraphId:snapshot.paragraphId,offset:snapshot.startOffset};savePosition(s,view.getCFI(index,range));
          const frameElement=doc.defaultView?.frameElement;
          const scaleX=frame && frameElement?.clientWidth ? frame.width/frameElement.clientWidth : 1;
          const scaleY=frame && frameElement?.clientHeight ? frame.height/frameElement.clientHeight : 1;
          latest.current.onSelectionDocument?.(doc);
          latest.current.onSelect(snapshot,{left:(frame?.left??0)+(rect.left+rect.width/2)*scaleX,top:Math.max(58,(frame?.top??0)+rect.top*scaleY-8)});
        };
        const cleanupSelection=bindSettledSelection(doc,{onCommit:onSelection,onStart:()=>{lastSelectionKey="";(latest.current.onStartSelection??latest.current.onClearSelection)?.();},onCancel:()=>latest.current.onClearSelection?.()});
        const loaded:LoadedDocument={doc,index,maps,paintCleanup:()=>{},cleanup:cleanupSelection};
        loaded.paintCleanup=paintEpubAnnotations(doc,maps,latest.current.annotations,latest.current.concepts,{ enabled: latest.current.showAnalysisHints ?? true, opacity: latest.current.analysisHintOpacity ?? 0.25 }, { bounds: () => host.current?.getBoundingClientRect() ?? null, changes: view },latest.current.appearance,latest.current.sourceEmphasis);s.documents.set(index,loaded);
        setDocuments([...s.documents.values()]);
      });
      view.addEventListener("relocate",event=>{
        if(cancelled||!currentSession(s))return;
        const detail=(event as CustomEvent<{cfi?:string;index?:number;section?:{current:number};fraction?:number;tocItem?:unknown;range?:Range}>).detail;
        const section=detail.section?.current ?? detail.index ?? [...s.documents.values()].find(loaded=>loaded.doc===detail.range?.startContainer.ownerDocument)?.index ?? 0;
        setProgress(`章节 ${section+1} / ${epub.sections.length}${typeof detail.fraction==="number"&&Number.isFinite(detail.fraction)?" · "+Math.round(detail.fraction*100)+"%":""}`);
        // WHY：全书进度沿用渲染器原生比例，与本章真实屏幕页分开显示，不把估算位置重新当成页码。
        setBookProgress(typeof detail.fraction==="number"&&Number.isFinite(detail.fraction)&&detail.fraction>=0&&detail.fraction<=1?detail.fraction:null);
        const renderer=view.renderer;
        // WHY：全书 location 是内容长度估算，不能和一次屏幕翻页混用；只显示已排版章节的真实屏幕页数，排除两端空白哨兵。
        const screenPage=renderer.page,screenPages=renderer.pages;
        if(!renderer.scrolled && typeof screenPage==="number" && Number.isSafeInteger(screenPage) && typeof screenPages==="number" && Number.isSafeInteger(screenPages) && screenPages>2)
          setPageLocation({current:Math.max(1,Math.min(screenPage,screenPages-2)),total:screenPages-2,section});
        else setPageLocation(null);
        const toc:unknown=detail.tocItem;
        if(toc&&typeof toc==='object'&&'href'in toc&&typeof toc.href==='string')latest.current.onTocLocation?.(toc.href);
        if(!s.shouldSave)return;s.shouldSave=false;
        const loaded=s.documents.get(section);
        const anchor=loaded&&detail.range ? anchorFromEpubRange(detail.range,loaded.maps) : null;
        if(anchor){s.anchor=anchor;latest.current.onPosition(anchor);}
        if(detail.cfi)savePosition(s,detail.cfi);
      });
      setStatus("正在装配原版阅读器…");
      await operations.run("装配原版阅读器",async()=>{try{await view.open(epub);}finally{if(!currentSession(s))view.close();}}); if(cancelled)return;
      // WHY：页尾拖选保持当前页；跨页扩展必须由用户点击“继续选取”并主动翻页。
      view.renderer.setAttribute("disable-pointer-selection-navigation", "");
      view.renderer?.setStyles(appearanceCss(latest.current.appearance, window.location.origin));
      // WHY：触摸/滚动翻页来自 renderer 而非工具栏。只记录主动位移，字体 reflow 不覆盖 canonical 锚点。
      view.renderer.addEventListener("relocate",event=>{
        const reason=(event as CustomEvent<{reason?:string}>).detail?.reason;
        if(!currentSession(s))return;
        if(reason && ["page","snap","scroll"].includes(reason))s.shouldSave=true;
      },true);
      setStatus("正在加载"+modeLabel+"章节…");
      let saved=null;
      try{saved=artifact?readConvertedPosition(localStorage.getItem(convertedPositionKey(book.editionId!)),artifact.conversion):readOriginalPosition(localStorage.getItem(originalPositionKey((epub.positionIdentity?"mobi:":"")+book.editionId!)),epub.positionIdentity ?? book.edition?.originalHash ?? "");}catch(cause:unknown){console.warn("无法读取原版位置",cause);}
      if(saved&&sameReadingAnchor(saved.anchor,latest.current.anchor)) {
        const invalidPosition=(cause:unknown)=>{
          console.warn("原版位置已失效，回退原文锚点",cause);
          const key=artifact?convertedPositionKey(book.editionId!):originalPositionKey((epub.positionIdentity?"mobi:":"")+book.editionId!);
          try{localStorage.removeItem(key);}catch(storageError:unknown){console.warn("无法清理失效的原版位置",storageError);}
          latest.current.onNotice("原版位置已失效，已回退到原文锚点。");saved=null;
        };
        let target:ReturnType<View["resolveCFI"]>|null=null;
        try { const resolved=view.resolveCFI(saved.cfi);if(!epub.sections[resolved.index])throw new Error("位置不属于本书");target=resolved; }
        catch(cause:unknown){invalidPosition(cause);}
        if(target){
          // WHY：CFI正文偏移在anchor(doc)才解析；文档IO必须放在位置校验catch之外，避免将损坏/超时误当旧位置失效。
          const positionDocument=await operations.run("核验原版位置",()=>epub.sections[target!.index].createDocument());
          if(cancelled||!currentSession(s))return;
          try{target.anchor(positionDocument);}catch(cause:unknown){invalidPosition(cause);}
        }
      } else saved=null;
      const restored=saved;
      await operations.run(restored?"恢复原版位置":"加载原版首章",()=>view.init(restored?{lastLocation:restored.cfi,showTextStart:true}:{showTextStart:true}));
      if(cancelled)return;
      if(!saved || !sameReadingAnchor(saved.anchor,latest.current.anchor))await navigateToAnchor(s,latest.current.anchor);
      if(cancelled||!currentSession(s))return;
      setStatus("");setReady(true);setSession(s);
      // WHY：首次装配/定位结束后再启动后台工作，避免全书预热抢占首屏资源。
      void epub.preparation?.start().catch(cause => {
        if (currentSession(s)) failSession(s, new Error('后台准备原版章节失败，请重试或返回书架。', { cause }));
        else console.warn('已取消的原版后台准备任务结束', cause);
      });
    })().catch(cause=>{if(!cancelled){fail(cause);teardown();}});
    return ()=>{cancelled=true;controller.abort();teardown();};
    // WHY：回调、标注与字体变化不能重新下载/重开书籍；它们由 latest 或独立 effect 更新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[book.id,book.editionId,book.edition?.fileType,book.edition?.originalHash,book.edition?.conversion?.sourceHash,book.edition?.conversion?.fileHash,book.edition?.conversion?.fileSize,book.edition?.conversion?.converterVersion,retry]);

  useEffect(()=>{
    const target=props.navigationTarget;
    if(!session||!target||session.sourceBook.id!==book.id||session.sourceBook.editionId!==book.editionId)return;
    if(handledNavigation.current?.editionId===book.editionId&&handledNavigation.current?.sequence===target.sequence)return;
    handledNavigation.current={editionId:book.editionId,sequence:target.sequence};
    // WHY：原书目录的href含真实章内片段，交由Foliate原生跳转；不能降级为同一分片第一段。
    void session.operations.run("跳转原书目录",async()=>{
      if(!session.book.resolveHref?.(target.href))throw new Error("原书目录位置无效，请检查书籍目录");
      session.shouldSave=true;
      await session.view.goTo(target.href);
    }).catch(cause=>{if(currentSession(session))latest.current.onNotice(cause instanceof Error?cause.message:"原书目录跳转失败");});
  },[session,props.navigationTarget,book.id,book.editionId]);

  async function navigateToAnchor(s:Session,anchor:ReadingAnchor|null) {
    if(!anchor || !currentSession(s))return;
    const source=s.sourceBook;
    const chapter=source.chapters.find(item=>item.paragraphs.some(p=>p.id===anchor.paragraphId));
    const index=s.book.sections.findIndex(section=>sameEpubResource(chapter?.sourceHref,section.id??section.href));
    if(!chapter || index<0) {latest.current.onNotice("阅读器中找不到这个原文位置，可返回书架查看；未猜测替代位置。");return;}
    const sequence=++s.navigating;
    const current=()=>currentSession(s)&&sequence===s.navigating;
    try {
      const doc=await runReaderOperation(s.book.sections[index].createDocument(),{signal:s.signal,phase:"核验原文锚点"});
      if(!current())return;
      if(!rangeForEpubPosition(documentMaps(doc,index,s,source),anchor.paragraphId,anchor.offset)) {latest.current.onNotice("该段排版与原文索引无法精确映射，请返回书架定位。");return;}
      s.anchor=anchor;
      await s.operations.run("定位原文锚点",async()=>{if(!current())return;await s.view.renderer!.goTo({index,anchor:(target:Document)=>{
        const range=rangeForEpubPosition(documentMaps(target,index,s,source),anchor.paragraphId,anchor.offset);
        if(!range)throw new Error("阅读锚点在渲染后失效，请返回书架");return range;
      }});});
      if(!current())return;
      const cfi=s.view.lastLocation?.cfi;if(cfi)savePosition(s,cfi);
    } catch(cause:unknown) {
      if(!current()){console.warn("已忽略过期阅读定位的错误",cause);return;}
      throw cause;
    }
  }
  useEffect(()=>{if(session&&currentSession(session)&&!sameReadingAnchor(session.anchor,props.anchor))void navigateToAnchor(session,props.anchor).catch(cause=>failSession(session,cause));},[session,props.anchor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(session&&!session.closed)session.view.renderer?.setStyles(appearanceCss(props.appearance, window.location.origin));},[session,props.appearance]);
  useEffect(()=>{if(session&&!session.closed)for(const loaded of session.documents.values()){loaded.paintCleanup();loaded.paintCleanup=paintEpubAnnotations(loaded.doc,loaded.maps,props.annotations,props.concepts,{ enabled: props.showAnalysisHints ?? true, opacity: props.analysisHintOpacity ?? 0.14 }, { bounds: () => host.current?.getBoundingClientRect() ?? null, changes: session.view },props.appearance,props.sourceEmphasis);}},[session,props.annotations,props.concepts,props.showAnalysisHints,props.analysisHintOpacity,props.appearance,props.sourceEmphasis]);

  async function jumpPreview(preview:EpubLinkPreview) {
    const s=sessionRef.current;
    if(!s||!currentSession(s)||preview?.index===undefined)return;
    try {
      s.shouldSave=true;
      await s.operations.run("跳转引用",()=>s.view.renderer.goTo({index:preview.index!,anchor:doc=>{
        if(preview.navigationHref){const resolved=s.book.resolveHref?.(preview.navigationHref);if(!resolved||resolved.index!==preview.index)throw new Error("引用目标已失效");const target=resolved.anchor(doc);if(typeof target==="number")throw new Error("引用缺少精确位置");return target;}
        const target=preview.fragment?doc.getElementById(preview.fragment):doc.body;
        if(!target)throw new Error("引用目标不可用");return target;
      }}));

    } catch(cause:unknown){console.warn("引用跳转失败",cause);if(cause instanceof ReaderOperationTimeout){failSession(s,cause);return;}if(currentSession(s))latest.current.onNotice("引用跳转失败，请从原书目录重试。");}
  }
  async function jumpToChapterPage(page:number) {
    const s=sessionRef.current;
    if(!s||!currentSession(s)||!pageLocation||(props.navigationDisabled ?? props.disabled))return;
    try {
      // WHY：renderer 的原生章节比例锚点按 total-1 映射真实屏幕页，不改渲染运输，也不将内容长度估算伪装成页码。
      s.shouldSave=true;
      await s.operations.run("跳转本章页码",()=>s.view.renderer.goTo({index:pageLocation.section,anchor:()=>pageLocation.total>1?(page-1)/(pageLocation.total-1):0}));
    } catch(cause:unknown) { console.error("原版页码跳转失败",cause); latest.current.onNotice(cause instanceof Error?cause.message:"页码跳转失败，请重试"); }
  }
  async function turn(direction:"next"|"prev") {const s=sessionRef.current;if(!s||!currentSession(s)||(props.navigationDisabled ?? props.disabled))return;try{s.shouldSave=true;await s.operations.run("翻页",()=>s.view[direction]());}catch(cause:unknown){failSession(s,cause);}}
  return <section className="epub-reader" aria-label={readerLabel+"阅读器"} aria-busy={!ready&&!error}>
    <div className="epub-host" ref={host}/>
    {status&&!error&&<div className="epub-status" role="status">{status}</div>}
    {error&&<div className="epub-error" role="alert"><p>{error}</p><button onClick={()=>setRetry(x=>x+1)}>重试{modeLabel}</button><button onClick={props.onFallback}>返回书架</button></div>}
    {conversionState.kind==="ready"&&<div className="epub-conversion-notice" role="note"><span>UMD → EPUB 转换版 · 保留原文，不代表原文件版式</span><a href={conversionState.artifact.originalUrl} download aria-label="下载 UMD 原件（未经转换）">下载 UMD 原件</a></div>}
    <nav className="epub-navigation" aria-label={modeLabel+"翻页"}><button disabled={!ready||(props.navigationDisabled ?? props.disabled)} className="epub-turn-page" aria-label={modeLabel+"上一页"} title={modeLabel+"上一页"} onClick={()=>void turn("prev")}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><polyline points="14 6 8 12 14 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg><span className="epub-turn-label">{modeLabel}上一页</span></button><div className="epub-reading-progress">{!pageLocation&&<span>{progress || (converted?"转换章节":"原书布局")}</span>}<ReaderPageJump key={(book.editionId??book.id)+":"+pageLocation?.section+":"+pageLocation?.total} current={pageLocation?.current ?? 0} total={pageLocation?.total ?? 0} chapter disabled={!ready||(props.navigationDisabled ?? props.disabled)} onJump={page=>void jumpToChapterPage(page)}/>{pageLocation&&bookProgress!==null&&<span className="epub-book-progress" aria-label="全书阅读进度" title="按全书内容计算的阅读进度，不代表屏幕页码">全书 {Math.round(bookProgress*100)}%</span>}<SpeechPlaybackBar inline/></div><button disabled={!ready||(props.navigationDisabled ?? props.disabled)} className="epub-turn-page" aria-label={modeLabel+"下一页"} title={modeLabel+"下一页"} onClick={()=>void turn("next")}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><polyline points="10 6 16 12 10 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg><span className="epub-turn-label">{modeLabel}下一页</span></button></nav>
    {session&&!session.closed&&!error&&<EpubInteractionLayer host={host} documents={documents} view={session.view} book={session.book} annotations={props.annotations} concepts={props.concepts} historyMarkerIds={historyMarkerIds} historyReadingsByMessageId={props.historyReadingsByMessageId} disabled={props.disabled} onOpenAnnotation={props.onOpenAnnotation} onJump={jumpPreview} onNotice={props.onNotice}/>}
  </section>;
}
