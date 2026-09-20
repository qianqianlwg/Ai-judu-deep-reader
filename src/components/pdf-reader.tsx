"use client";
import{useCallback,useEffect,useMemo,useRef,useState}from'react';
import{loadPdfRuntime,openPdf,indexPdfPages,type PdfRuntime}from'@/lib/pdf-loader';
import{mapPdfDocument,readLimitedPdfSelection,pdfRangesForSource,type PdfDocumentIndex,type PdfDomPage}from'@/lib/pdf-source-map';
import{createPdfLinkService}from'@/lib/pdf-links';
import{selectionParts,type ReadingSelection}from'@/lib/reader-selection';
import type{PDFDocumentProxy}from'pdfjs-dist/types/src/display/api';
import type{IPDFLinkService}from'pdfjs-dist/types/web/interfaces';
import type{EpubReaderProps}from'./epub-reader';
import{PdfPage}from'./pdf-page';
import{PdfInteractionLayer}from'./pdf-interaction-layer';
import'pdfjs-dist/web/pdf_viewer.css';
import'./pdf-reader.css';
type Session={book:EpubReaderProps["book"];runtime:PdfRuntime;document:PDFDocumentProxy;index:PdfDocumentIndex;active:boolean;links:IPDFLinkService};
type Outline={title:string;destination:unknown;depth:number};
function outlineItems(value:unknown,depth=0):Outline[]{if(!Array.isArray(value)||depth>12)return [];return value.slice(0,2000).flatMap(item=>item&&typeof item==='object'&&'title'in item&&typeof item.title==='string'?[{title:item.title,destination:'dest'in item?item.dest:null,depth},...outlineItems('items'in item?item.items:[],depth+1)]:[]);}
export function PdfReader(props:EpubReaderProps){
 const interactionHost=useRef<HTMLDivElement>(null),viewport=useRef<HTMLDivElement>(null),latest=useRef(props),dom=useRef(new Map<number,PdfDomPage>()),goRef=useRef<(page:number)=>void>(()=>{}),current=useRef(1),navigated=useRef('');
 const[sessionState,setSession]=useState<Session|null>(null),[error,setError]=useState(''),[status,setStatus]=useState('正在读取 PDF 原件…'),[retry,setRetry]=useState(0),[page,setPage]=useState(1),[zoom,setZoom]=useState(100),[rotation,setRotation]=useState(0),[width,setWidth]=useState(600),[scroll,setScroll]=useState(0),[height,setHeight]=useState(700),[outline,setOutline]=useState<Outline[]>([]),[revision,setRevision]=useState(0),[selection,setSelection]=useState<ReadingSelection|null>(null);
 const [interactionPages,setInteractionPages]=useState<PdfDomPage[]>([]);
 const session=sessionState?.book===props.book?sessionState:null;
 const key='judu:pdf-position:'+props.book.editionId;
 useEffect(()=>{latest.current=props;});
 useEffect(()=>{
  const element=viewport.current;if(!element)return;const resize=()=>{setWidth(element.clientWidth||600);setHeight(element.clientHeight||700);};resize();const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(resize);observer?.observe(element);return()=>observer?.disconnect();
 },[]);
 useEffect(()=>{
  let owned:Session|undefined,task:ReturnType<typeof openPdf>|undefined;const controller=new AbortController();
  const pagesDom=dom.current;
  void(async()=>{
   setSession(null);setError('');setStatus('正在读取 PDF 原件…');pagesDom.clear();setInteractionPages([]);navigated.current='';setSelection(null);setOutline([]);current.current=1;setPage(1);setScroll(0);setZoom(100);setRotation(0);latest.current.onClearSelection?.();
   const runtime=await loadPdfRuntime();if(controller.signal.aborted)return;
   task=openPdf(runtime,'/api/books/'+encodeURIComponent(props.book.id)+'/original?editionId='+encodeURIComponent(props.book.editionId??''));
   const document=await task.promise;controller.signal.throwIfAborted();
   const pages=await indexPdfPages(document,controller.signal,n=>setStatus('正在建立 PDF 页索引：'+n+' / '+document.numPages));
   const index=mapPdfDocument(pages,props.book);const links=createPdfLinkService(document,{getPage:()=>current.current,goToPage:value=>goRef.current(value),onNotice:message=>latest.current.onNotice(message),isActive:()=>!controller.signal.aborted},index.pages);owned={book:props.book,runtime,document,index,active:true,links};
   const tree=await document.getOutline();controller.signal.throwIfAborted();setOutline(outlineItems(tree));setSession(owned);setStatus('');
   if(!index.complete)latest.current.onNotice('PDF第 '+index.pages.filter(p=>!p.mapped).map(p=>p.pageNumber).join('、')+' 页文字与精读索引不一致：可看原版，但未猜测这些页的句读位置。');
   try{const raw=localStorage.getItem(key);const saved:unknown=raw?JSON.parse(raw):null;if(saved&&typeof saved==='object'&&'hash'in saved&&saved.hash===props.book.edition?.originalHash){if('page'in saved&&Number.isInteger(saved.page)&&Number(saved.page)>0&&Number(saved.page)<=document.numPages){current.current=Number(saved.page);setPage(Number(saved.page));}if('zoom'in saved&&typeof saved.zoom==='number'&&saved.zoom>=50&&saved.zoom<=250)setZoom(saved.zoom);if('rotation'in saved&&[0,90,180,270].includes(Number(saved.rotation)))setRotation(Number(saved.rotation));}}
   catch(cause:unknown){console.warn('PDF位置恢复失败',cause);latest.current.onNotice('PDF阅读位置无法恢复，已保留书籍和标注。');}
  })().catch((cause:unknown)=>{if(controller.signal.aborted)return;console.error('PDF原版加载失败',cause);setError(cause instanceof Error?cause.message:'PDF原版加载失败');setStatus('');});
  return()=>{controller.abort();if(owned)owned.active=false;pagesDom.clear();if(task)void task.destroy().catch((cause:unknown)=>console.warn('释放PDF资源失败',cause));};
 },[props.book,retry,key]);
 const layout=useMemo(()=>{let top=0;return session?.index.pages.map(item=>{const swapped=rotation%180!==0,w=swapped?item.height:item.width,h=swapped?item.width:item.height,scale=Math.max(.1,Math.min(1,(width-32)/w))*zoom/100;const result={page:item,top,width:w*scale,height:h*scale,scale};top+=result.height+24;return result;})??[];},[session,width,zoom,rotation]);
 const goToPage=useCallback((target:number)=>{const item=layout[target-1],element=viewport.current;if(!item||!element)return;current.current=target;setPage(target);element.scrollTop=item.top;setScroll(item.top);},[layout]);
 useEffect(()=>{goRef.current=goToPage;},[goToPage]);
 const links=session?.links??null;
 useEffect(()=>{if(session&&layout.length)goToPage(current.current);},[session,layout,goToPage]);
 useEffect(()=>{if(!session||!layout.length)return;const anchor=props.anchor;const identity=anchor?anchor.paragraphId+':'+anchor.offset:'';if(identity&&identity!==navigated.current){const found=session.index.pages.find(p=>p.runs.some(run=>run.paragraphId===anchor!.paragraphId&&run.startOffset<=anchor!.offset&&run.endOffset>anchor!.offset));if(found){navigated.current=identity;goToPage(found.pageNumber);return;}}},[session,layout,props.anchor,goToPage]);
 const ready=useCallback((loaded:PdfDomPage)=>{dom.current.set(loaded.pageNumber,loaded);setInteractionPages([...dom.current.values()]);setRevision(n=>n+1);},[]),removed=useCallback((number:number)=>{dom.current.delete(number);setInteractionPages([...dom.current.values()]);setRevision(n=>n+1);},[]);
 useEffect(()=>{if(!session)return;try{localStorage.setItem(key,JSON.stringify({version:1,hash:props.book.edition?.originalHash,page,zoom,rotation}));}catch(cause:unknown){console.warn('保存PDF位置失败',cause);latest.current.onNotice('PDF阅读位置保存失败，请检查浏览器存储。');}},[session,key,props.book.edition?.originalHash,page,zoom,rotation]);
 useEffect(()=>{
  const root=viewport.current;if(!root||!session)return;const document=root.ownerDocument;let last='';
  const changed=()=>{if(latest.current.disabled)return;const selected=document.getSelection();if(!selected||selected.isCollapsed||!selected.rangeCount)return;const range=selected.getRangeAt(0);if(!range.intersectsNode(root))return;
   const snapshot=readLimitedPdfSelection(selected,[...dom.current.values()],session.index.paragraphs,()=>latest.current.onNotice('最多选择 1000 字，选区已限制到上限。'));
   if(!snapshot){last='';setSelection(null);latest.current.onClearSelection?.();latest.current.onNotice('该选区没有完整可核验的PDF文字来源；扫描图片需OCR后才能文字句读。');return;}
   const identity=JSON.stringify(snapshot);if(identity===last)return;last=identity;setSelection(snapshot);const rect=selected.getRangeAt(0).getBoundingClientRect();latest.current.onSelect(snapshot,{left:rect.left+rect.width/2,top:Math.max(58,rect.top-8)});
  };
  const start=(event:PointerEvent)=>{if((event.target as Element|null)?.closest?.('.annotationLayer,button'))return;last='';setSelection(null);latest.current.onStartSelection?.();};
  const keyed=()=>{const selected=document.getSelection();if(selected?.isCollapsed&&selected.anchorNode&&root.contains(selected.anchorNode)){last='';setSelection(null);latest.current.onClearSelection?.();return;}changed();};
  document.addEventListener('selectionchange',changed);root.addEventListener('pointerdown',start);root.addEventListener('mouseup',changed);root.addEventListener('keyup',keyed);
  return()=>{document.removeEventListener('selectionchange',changed);root.removeEventListener('pointerdown',start);root.removeEventListener('mouseup',changed);root.removeEventListener('keyup',keyed);};
 },[session]);
 useEffect(()=>{
  const view=window as Window&{CSS?:{highlights?:{set(name:string,value:unknown):void;delete(name:string):boolean}};Highlight?:new(...ranges:Range[])=>unknown};const registry=view.CSS?.highlights,H=view.Highlight;if(!registry||!H)return;
  const pages=[...dom.current.values()],groups=new Map<string,Range[]>(['analysis','yellow','green','blue','pink','orange','concept','selection'].map(name=>[name,[]]));
  for(const annotation of props.annotations){const name=annotation.kind&&annotation.kind!=='analysis'?annotation.markColor??'yellow':'analysis';groups.get(name)?.push(...pdfRangesForSource(pages,annotation));}
  for(const paragraph of session?.index.paragraphs??[])for(const concept of props.concepts){if(!concept.name)continue;let start=paragraph.text.indexOf(concept.name);while(start>=0){groups.get('concept')!.push(...pdfRangesForSource(pages,{paragraphId:paragraph.id,startOffset:start,endOffset:start+concept.name.length}));start=paragraph.text.indexOf(concept.name,start+concept.name.length);}}
  if(selection)groups.set('selection',selectionParts(selection).flatMap(part=>pdfRangesForSource(pages,part)));
  // WHY：手动颜色、AI下划线、概念及当前选文分开绘制，不让已保存绿色标亮看起来变成AI句读。
  for(const [name,ranges]of groups)registry.set('judu-pdf-'+name,new H(...ranges));return()=>{for(const name of groups.keys())registry.delete('judu-pdf-'+name);};
 },[revision,props.annotations,props.concepts,selection,session]);
 const total=layout.length?layout[layout.length-1].top+layout[layout.length-1].height:0;
 const visible=layout.filter(item=>item.top+item.height>=scroll-height&&item.top<=scroll+height*2);
 const textless=session?.index.pages[page-1]?.items.every(item=>!item.str.trim());
 const unknownGlyph=session?.index.pages[page-1]?.items.some(item=>item.str.includes("�"));
 return <section className="pdf-reader" aria-label="PDF 原版阅读器" aria-busy={Boolean(status)}>
  <nav className="pdf-navigation" aria-label="PDF导航"><button disabled={!session||page<=1||props.disabled} onClick={()=>goToPage(page-1)}>上一页</button><label>页码 <input aria-label="PDF页码" type="number" min={1} max={session?.document.numPages??1} value={page} disabled={!session||props.disabled} onChange={event=>goToPage(Number(event.target.value))}/></label><span>/ {session?.document.numPages??0}</span><button disabled={!session||page>=session.document.numPages||props.disabled} onClick={()=>goToPage(page+1)}>下一页</button><select aria-label="PDF缩放" value={zoom} onChange={event=>setZoom(Number(event.target.value))}>{[50,75,100,125,150,200,250].map(value=><option key={value} value={value}>{value===100?'适合宽度':value+'%'}</option>)}</select><button aria-label="顺时针旋转PDF" onClick={()=>setRotation(value=>(value+90)%360)}>旋转</button>{outline.length>0&&<select aria-label="PDF目录" value="" onChange={event=>{const value=outline[Number(event.target.value)]?.destination;if(links&&(typeof value==='string'||Array.isArray(value)))void links.goToDestination(value);}}><option value="">原书目录</option>{outline.map((item,index)=><option key={index} value={index}>{'　'.repeat(item.depth)+item.title}</option>)}</select>}</nav>
  {status&&<p role="status">{status}</p>}{error&&<div role="alert"><p>{error}</p><button onClick={()=>setRetry(n=>n+1)}>重试原版</button><button onClick={props.onFallback}>切回精读</button></div>}
  {unknownGlyph&&<p className="pdf-capability-note" role="status">本页含无法识别的文字或公式字符，选文用 � 标明；请对照原版，不把占位符当作原公式。</p>}
  {textless&&<p className="pdf-capability-note" role="status">本页没有可提取的文字层，可查看原版；OCR 尚未启用，不能直接文字句读。</p>}
  <div ref={interactionHost} className="pdf-document-surface"><div ref={viewport} className="pdf-viewport" data-reading-viewport="" onScroll={event=>{const value=event.currentTarget.scrollTop;setScroll(value);const next=layout.find(item=>item.top+item.height>value+40)?.page.pageNumber??1;current.current=next;setPage(next);const first=session?.index.pages[next-1]?.runs[0];if(first){navigated.current=first.paragraphId+':'+first.startOffset;latest.current.onPosition({paragraphId:first.paragraphId,offset:first.startOffset});}}}>
   <div className="pdf-scroll-space" style={{height:total,width:layout.reduce((maximum,item)=>Math.max(maximum,item.width+32),width)}}>{session&&links&&visible.map(item=><div className="pdf-page-slot" data-pdf-page={item.page.pageNumber} data-source-mapped={item.page.mapped} key={item.page.pageNumber} style={{top:item.top,width:item.width,height:item.height}}><PdfPage document={session.document} runtime={session.runtime} page={item.page} scale={item.scale} rotation={rotation} linkService={links} onReady={ready} onRemove={removed}/></div>)}</div>
  </div>
  {session&&<PdfInteractionLayer host={interactionHost} book={props.book} document={session.document} index={session.index} pages={interactionPages} annotations={props.annotations} concepts={props.concepts} disabled={props.disabled} onOpenAnnotation={props.onOpenAnnotation} onNotice={props.onNotice} onJump={goToPage}/>}
  </div>
 </section>;
}
