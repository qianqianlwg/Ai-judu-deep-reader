import {MAX_PDF_PAGES,MAX_PDF_INDEX_CHARACTERS,pdfSafeText}from './pdf-text';
import type {PdfTextPage,PdfTextItem}from './pdf-source-map';
import type {PDFDocumentProxy,PDFDocumentLoadingTask}from 'pdfjs-dist/types/src/display/api';
export type PdfRuntime=typeof import('pdfjs-dist');
let runtimePromise:Promise<PdfRuntime>|undefined;
export async function loadPdfRuntime():Promise<PdfRuntime>{
 if(!runtimePromise)runtimePromise=import('pdfjs-dist').then(module=>{module.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.min.mjs';return module;}).catch((cause:unknown)=>{runtimePromise=undefined;throw cause;});return runtimePromise;
}
export function openPdf(runtime:PdfRuntime,url:string):PDFDocumentLoadingTask{
 return runtime.getDocument({url,isEvalSupported:false,enableXfa:false,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/',iccUrl:'/vendor/pdfjs/iccs/',maxImageSize:16_777_216});
}
export async function indexPdfPages(document:PDFDocumentProxy,signal:AbortSignal,onProgress:(page:number)=>void):Promise<PdfTextPage[]>{
 if(!Number.isSafeInteger(document.numPages)||document.numPages<1||document.numPages>MAX_PDF_PAGES)throw new Error('PDF超过5000页安全上限');const result:PdfTextPage[]=[];let characters=0;
 for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
  signal.throwIfAborted();const page=await document.getPage(pageNumber);
  try{signal.throwIfAborted();const content=await page.getTextContent();signal.throwIfAborted();const items:PdfTextItem[]=content.items.flatMap(item=>'str'in item?[{str:pdfSafeText(item.str),transform:item.transform,width:item.width,height:item.height,hasEOL:item.hasEOL}]:[]);characters+=items.reduce((n,item)=>n+item.str.length,0);if(characters>MAX_PDF_INDEX_CHARACTERS)throw new Error('PDF文字总量超过当前索引安全上限');const viewport=page.getViewport({scale:1});result.push({pageNumber,...(page.ref?{reference:{num:page.ref.num,gen:page.ref.gen}}:{}),items,width:viewport.width,height:viewport.height,rotation:page.rotate,runs:[],mapped:false});onProgress(pageNumber);}finally{page.cleanup();}
 }
 return result;
}
