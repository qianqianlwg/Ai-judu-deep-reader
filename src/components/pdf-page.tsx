"use client";
import{useEffect,useRef,useState}from'react';
import type{PDFDocumentProxy,RenderTask,PDFPageProxy}from'pdfjs-dist/types/src/display/api';
import type{IPDFLinkService}from'pdfjs-dist/types/web/interfaces';
import type{PdfRuntime}from'@/lib/pdf-loader';
import{pdfSafeText}from'@/lib/pdf-text';
import{bindPdfTextLayer,type PdfDomPage,type PdfTextPage}from'@/lib/pdf-source-map';
type Props={document:PDFDocumentProxy;runtime:PdfRuntime;page:PdfTextPage;scale:number;rotation:number;linkService:IPDFLinkService;onReady(page:PdfDomPage):void;onRemove(page:number):void};
export function PdfPage(props:Props){
 const canvas=useRef<HTMLCanvasElement>(null),text=useRef<HTMLDivElement>(null),annotations=useRef<HTMLDivElement>(null),latest=useRef(props);
 const[error,setError]=useState(''),[ready,setReady]=useState(false);
 useEffect(()=>{latest.current=props;});
 useEffect(()=>{
  const canvasNode=canvas.current,textNode=text.current,annotationNode=annotations.current;if(!canvasNode||!textNode||!annotationNode)return;
  let disposed=false,render:RenderTask|undefined,textLayer:InstanceType<PdfRuntime['TextLayer']>|undefined,page:PDFPageProxy|undefined;
  setReady(false);setError('');
  void(async()=>{
   page=await props.document.getPage(props.page.pageNumber);if(disposed){page.cleanup();return;}
   const viewport=page.getViewport({scale:props.scale,rotation:(page.rotate+props.rotation)%360});
   const unit=page.userUnit||1;const surface=textNode.parentElement;surface?.style.setProperty('--user-unit',String(unit));surface?.style.setProperty('--total-scale-factor',String(props.scale*unit));
   // WHY：限制画布总像素，缩放不让大页乘设备像素比耗尽内存；CSS尺寸仍保持原书比例。
   const density=Math.min(window.devicePixelRatio||1,Math.sqrt(8_000_000/(viewport.width*viewport.height)),2);
   canvasNode.width=Math.max(1,Math.floor(viewport.width*density));canvasNode.height=Math.max(1,Math.floor(viewport.height*density));canvasNode.style.width=viewport.width+'px';canvasNode.style.height=viewport.height+'px';
   render=page.render({canvas:canvasNode,viewport,transform:density===1?undefined:[density,0,0,density,0,0],annotationMode:props.runtime.AnnotationMode.ENABLE});
   // WHY：缩放可能在getTextContent仍等待时取消Canvas；立即收接其结果，防止尚未进入Promise.all的正常取消成为未处理拒绝。
   const rendered=render.promise.then(()=>({ok:true as const}),cause=>({ok:false as const,cause: cause as unknown}));
   const content=await page.getTextContent();if(disposed)return;
   content.items=content.items.map(item=>'str'in item?{...item,str:pdfSafeText(item.str)}:item);
   textLayer=new props.runtime.TextLayer({textContentSource:content,container:textNode,viewport});
   const [renderedResult]=await Promise.all([rendered,textLayer.render()]);if(disposed)return;if(!renderedResult.ok)throw renderedResult.cause;
   const dom=bindPdfTextLayer(props.page,textNode,textLayer.textDivs,textLayer.textContentItemsStr);latest.current.onReady(dom);
   const data:unknown[]=await page.getAnnotations({intent:'display'});if(disposed)return;
   const allowed=new Set([props.runtime.AnnotationType.LINK,props.runtime.AnnotationType.TEXT,props.runtime.AnnotationType.POPUP,props.runtime.AnnotationType.HIGHLIGHT,props.runtime.AnnotationType.UNDERLINE,props.runtime.AnnotationType.STRIKEOUT,props.runtime.AnnotationType.SQUIGGLY]);
   const safe=data.filter(item=>item!==null&&typeof item==='object'&&'annotationType'in item&&typeof item.annotationType==='number'&&allowed.has(item.annotationType));
   const annotationViewport=viewport.clone({dontFlip:true});
   // WHY：AnnotationLayer无cancel接口，异步结果先在独立节点完成，再原子挂载；缩放或卸载后的旧任务不能污染当前页。
   const staging=annotationNode.ownerDocument.createElement("div");staging.className="annotationLayer";
   const layer=new props.runtime.AnnotationLayer({div:staging,page,viewport:annotationViewport,linkService:props.linkService,annotationStorage:props.document.annotationStorage,accessibilityManager:null,annotationCanvasMap:null,annotationEditorUIManager:null,structTreeLayer:null,commentManager:null});
   await layer.render({viewport:annotationViewport,div:staging,annotations:safe,page,linkService:props.linkService,annotationStorage:props.document.annotationStorage,renderForms:false,enableScripting:false,hasJSActions:false,imageResourcesPath:'/vendor/pdfjs/images/'});if(!disposed){annotationNode.style.cssText=staging.style.cssText;for(const attribute of Array.from(staging.attributes))if(attribute.name.startsWith("data-"))annotationNode.setAttribute(attribute.name,attribute.value);annotationNode.replaceChildren(...staging.childNodes);setReady(true);}
  })().catch((cause:unknown)=>{if(disposed)return;console.error('PDF页面渲染失败',cause);setError(cause instanceof Error?cause.message:'此页显示失败，请重试');});
  return()=>{disposed=true;render?.cancel();textLayer?.cancel();latest.current.onRemove(props.page.pageNumber);textNode.replaceChildren();annotationNode.replaceChildren();canvasNode.width=0;canvasNode.height=0;page?.cleanup();};
 },[props.document,props.runtime,props.page,props.scale,props.rotation,props.linkService]);
 // WHY：直接装配PDF.js图层时也必须提供上游.pdfViewer .page的round变量，否则链接百分比布局退化为0×0。
 return <div className="pdf-page-layers" aria-label={'PDF 第 '+props.page.pageNumber+' 页'} aria-busy={!ready&&!error} style={{'--scale-factor':props.scale,'--total-scale-factor':props.scale,'--user-unit':1,'--scale-round-x':'1px','--scale-round-y':'1px'}as React.CSSProperties}>
  <canvas ref={canvas} aria-label={'第 '+props.page.pageNumber+' 页原版图像'}/><div ref={text} className="textLayer"/><div ref={annotations} className="annotationLayer"/>
  {error&&<p role="alert" className="pdf-page-error">{error}</p>}
 </div>;
}
