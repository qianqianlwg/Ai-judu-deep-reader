"use client";
import {useEffect,useRef,useState} from 'react';
import type {EpubReaderProps} from './epub-reader';
import type {ImageChapterRequest} from '@/hooks/use-image-chapters';
import {cbzPageUrl,readCbzPosition,type CbzPosition} from '@/lib/cbz-position';
import './cbz-reader.css';
export type CbzReaderProps=EpubReaderProps&{imageChapterRequest?:ImageChapterRequest|null;onImagePage?:(page:number)=>void};
type PositionState={book:EpubReaderProps['book'];position:CbzPosition};
type ImageState={book:EpubReaderProps['book'];page:number;url:string;width:number;height:number};
const mimeTypes=new Set(['image/jpeg','image/png','image/gif','image/webp']);
const emptyPosition=(hash:string):CbzPosition=>({version:1,originalHash:hash,page:1,zoom:100,fit:'page',direction:'ltr'});
export function CbzReader(props:CbzReaderProps){
 const latest=useRef(props),viewport=useRef<HTMLDivElement>(null),requestSequence=useRef(-1);
 const[state,setState]=useState<PositionState|null>(null),[image,setImage]=useState<ImageState|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[pending,setPending]=useState(false),[size,setSize]=useState({width:600,height:700});
 const active=state?.book===props.book?state:null,position=active?.position??emptyPosition(props.book.edition?.originalHash??''),visible=image?.book===props.book&&image.page===position.page?image:null;
 const key='judu:cbz-position:'+props.book.editionId,count=props.book.chapters.length;
 useEffect(()=>{latest.current=props;});
 useEffect(()=>{let disposed=false;void(async()=>{requestSequence.current=-1;setError('');setImage(null);latest.current.onClearSelection?.();let position=emptyPosition(props.book.edition?.originalHash??'');try{position=readCbzPosition(localStorage.getItem(key),position.originalHash,count)??position;}catch(cause:unknown){console.warn('CBZ阅读位置恢复失败',cause);latest.current.onNotice('CBZ阅读位置无法恢复，书籍和标注未被修改。');}if(!disposed){setState({book:props.book,position});latest.current.onImagePage?.(position.page);}})();return()=>{disposed=true;};},[props.book,key,count]);
 useEffect(()=>{if(!active)return;try{localStorage.setItem(key,JSON.stringify(active.position));}catch(cause:unknown){console.warn('CBZ阅读位置保存失败',cause);latest.current.onNotice('CBZ阅读位置保存失败，请检查浏览器存储。');}},[active,key]);
 useEffect(()=>{const root=viewport.current;if(!root)return;const update=()=>setSize({width:root.clientWidth||600,height:root.clientHeight||700});update();const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(update);observer?.observe(root);return()=>observer?.disconnect();},[]);
 const page=position.page,book=props.book;
 useEffect(()=>{
  if(!active||!book.editionId||page<1||page>count)return;const controller=new AbortController();let owned:string|undefined;
  void(async()=>{setPending(true);setError('');const response=await fetch(cbzPageUrl(book.id,book.editionId!,page),{signal:controller.signal,cache:'no-store'});if(!response.ok){let message='CBZ图片页读取失败（HTTP '+response.status+'）';if(response.headers.get('content-type')?.includes('json')){const value:unknown=await response.json();if(value&&typeof value==='object'&&'error'in value&&typeof value.error==='string')message=value.error;}throw new Error(message);}
   const mime=response.headers.get('content-type')?.split(';')[0]??'';if(!mimeTypes.has(mime))throw new Error('CBZ图片响应类型不受支持');const length=Number(response.headers.get('content-length')??0);if(length>24*1024*1024)throw new Error('CBZ图片页超过大小上限');
   const width=Number(response.headers.get('x-judu-image-width')),height=Number(response.headers.get('x-judu-image-height'));if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>16_777_216)throw new Error('CBZ图片尺寸响应无效');
   const bytes=await response.blob();controller.signal.throwIfAborted();if(!bytes.size||bytes.size>24*1024*1024)throw new Error('CBZ图片内容为空或超限');owned=URL.createObjectURL(bytes);setImage({book,page,url:owned,width,height});setPending(false);if(viewport.current){viewport.current.scrollTop=0;viewport.current.scrollLeft=0;}
  })().catch((cause:unknown)=>{if(controller.signal.aborted)return;console.error('CBZ图片页加载失败',cause);setError(cause instanceof Error?cause.message:'CBZ图片页加载失败');setPending(false);});
  return()=>{controller.abort();if(owned)URL.revokeObjectURL(owned);};
 // WHY：只有页码/原件身份变化才重读图像，缩放和方向更新不重新解压；旧请求abort且只撤销本次拥有的URL。
 },[book,page,retry,count,Boolean(active)]); // eslint-disable-line react-hooks/exhaustive-deps
 function update(change:Partial<CbzPosition>){if(props.disabled||!active)return;setState({book:props.book,position:{...active.position,...change}});}
 function go(target:number){if(!Number.isSafeInteger(target)||target<1||target>count||props.disabled||!active)return;update({page:target});props.onClearSelection?.();props.onImagePage?.(target);}
 useEffect(()=>{const request=props.imageChapterRequest;if(!active||!request||props.disabled||request.sequence===requestSequence.current||request.editionId!==book.editionId||request.originalHash!==book.edition?.originalHash)return;const target=book.chapters.findIndex(chapter=>chapter.sourceHref===request.sourceHref);requestSequence.current=request.sequence;if(target<0){props.onNotice('此图片页不属于当前版本');return;}queueMicrotask(()=>{if(latest.current.book===book)go(target+1);});},[props.imageChapterRequest,active,props.disabled]); // eslint-disable-line react-hooks/exhaustive-deps
 const fitted=visible?Math.min((size.width-32)/visible.width,position.fit==='page'?(size.height-32)/visible.height:Infinity):1,scale=Math.max(.01,fitted)*position.zoom/100;
 return <section className="cbz-reader" aria-label="CBZ 原版阅读器">
  <nav className="cbz-navigation" aria-label="CBZ导航"><button type="button" disabled={!active||props.disabled||page<=1} onClick={()=>go(page-1)}>上一页</button><label>页码 <input aria-label="CBZ页码" type="number" min={1} max={count} value={page} disabled={!active||props.disabled} onChange={event=>go(Number(event.target.value))}/></label><span>/ {count}</span><button type="button" disabled={!active||props.disabled||page>=count} onClick={()=>go(page+1)}>下一页</button><select aria-label="CBZ适应方式" value={position.fit} disabled={!active||props.disabled} onChange={event=>update({fit:event.target.value==='width'?'width':'page'})}><option value="page">适合整页</option><option value="width">适合宽度</option></select><select aria-label="CBZ缩放" value={position.zoom} disabled={!active||props.disabled} onChange={event=>update({zoom:Number(event.target.value)})}>{[25,50,75,100,125,150,200,300].map(zoom=><option key={zoom} value={zoom}>{zoom}%</option>)}</select><select aria-label="CBZ阅读方向" value={position.direction} disabled={!active||props.disabled} onChange={event=>update({direction:event.target.value==='rtl'?'rtl':'ltr'})}><option value="ltr">从左到右</option><option value="rtl">从右到左</option></select></nav>
  <p className="cbz-capability-note">CBZ 是图片页，保留原图；OCR 尚未启用，不能选择文字句读或显示文字概念标注。</p>
  {pending&&<p role="status" className="cbz-status">正在读取第 {page} 页图片…</p>}
  {error&&<div role="alert" className="cbz-error"><p>{error}</p><button type="button" disabled={props.disabled} onClick={()=>setRetry(value=>value+1)}>重试图片页</button></div>}
  <div className="cbz-viewport" ref={viewport} tabIndex={0} aria-label="CBZ图片页面，方向键翻页" aria-busy={pending} onKeyDown={event=>{if(event.target!==event.currentTarget||event.altKey||event.ctrlKey||event.metaKey||props.disabled)return;const next=position.direction==='rtl'?'ArrowLeft':'ArrowRight',previous=position.direction==='rtl'?'ArrowRight':'ArrowLeft';if([next,previous,'PageDown','PageUp','Home','End'].includes(event.key)){event.preventDefault();go(event.key==='Home'?1:event.key==='End'?count:page+([next,'PageDown'].includes(event.key)?1:-1));}}}>
   {visible&&!error&&<div className="cbz-image-space" style={{width:Math.max(size.width,visible.width*scale+32),minHeight:Math.max(size.height,visible.height*scale+32)}}>
    {/* WHY：展示已核验的原始图片字节，不经过Next图片重编码，也不反转图像颜色冒充阅读主题。 */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img key={visible.url} src={visible.url} alt={book.chapters[page-1]?.title??'第 '+page+' 页'} draggable={false} style={{width:visible.width*scale,height:visible.height*scale}} onError={()=>{console.error('CBZ浏览器图片解码失败',{page});setError('浏览器无法显示此图片页，可重试或重新导入原件。');}}/>
   </div>}
  </div>
 </section>;
}
