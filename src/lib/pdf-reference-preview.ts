import type {PDFDocumentProxy} from 'pdfjs-dist/types/src/display/api';
import type {PdfDocumentIndex} from './pdf-source-map';
import {resolvePdfDestinationPage} from './pdf-links';
export type PdfReferencePreview={title:string;text:string;address?:string;index?:number};
export async function previewPdfReference(link:Element,document:PDFDocumentProxy,index:PdfDocumentIndex):Promise<PdfReferencePreview>{
 const external=link.getAttribute('data-pdf-external-url');
 // WHY：PDF引用只读取已经加载的本地页索引，绝不请求文档提供的外部地址或执行动作。
 if(external!==null)return {title:'外部链接',text:'外部链接不自动访问。',address:external};
 const href=link.getAttribute('href')??'';
 if(!href.startsWith('#judu-dest='))return {title:'引用预览',text:'此引用没有可预览的页定位，请使用原书目录或页码导航。'};
 const destination:unknown=JSON.parse(decodeURIComponent(href.slice('#judu-dest='.length)));
 const page=await resolvePdfDestinationPage(document,destination,index.pages),target=index.pages[page-1];
 if(!target)throw new Error('PDF引用页不存在');
 const text=target.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('').trim();
 // WHY：预览保持2400个UTF16单位上限，但不能切开emoji/增补汉字的代理对。
 let excerpt=text.slice(0,2400);if(excerpt.length<text.length&&/[\uD800-\uDBFF]$/u.test(excerpt))excerpt=excerpt.slice(0,-1);
 return {title:'引用预览',text:text?('第 '+page+' 页文字概览（非精确脚注定位）\n'+excerpt):'本页没有可提取的文字，可跳转查看原版。',address:'第 '+page+' 页',index:page-1};
}
