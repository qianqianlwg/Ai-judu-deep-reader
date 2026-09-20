import type {PDFDocumentProxy}from 'pdfjs-dist/types/src/display/api';
import type {IPDFLinkService}from 'pdfjs-dist/types/web/interfaces';
export type PdfNavigation={getPage():number;goToPage(page:number):void;onNotice(message:string):void;isActive():boolean};
type ReferencePage={pageNumber:number;reference?:{num:number;gen:number}};
export async function resolvePdfDestinationPage(document:PDFDocumentProxy,value:unknown,pages:readonly ReferencePage[]=[]):Promise<number>{
 const dest:unknown=typeof value==='string'?await document.getDestination(value):value;
 if(!Array.isArray(dest)||!dest.length)throw new Error('PDF引用目标无效');const ref:unknown=dest[0];
 let index:number|null=null;
 if(typeof ref==='number')index=ref;
 else if(ref&&typeof ref==='object'&&'num'in ref&&'gen'in ref&&typeof ref.num==='number'&&Number.isSafeInteger(ref.num)&&ref.num>0&&typeof ref.gen==='number'&&Number.isSafeInteger(ref.gen)&&ref.gen>=0){
  // WHY：部分合法可显示页的PDF父节点kids损坏，getPageIndex会失败；用已加载页面的唯一对象引用精确反查，不猜文本或页号。
  const matches=pages.filter(page=>page.reference?.num===ref.num&&page.reference?.gen===ref.gen);
  if(matches.length>1)throw new Error('PDF引用对象不唯一');index=matches.length===1?matches[0].pageNumber-1:await document.getPageIndex({num:ref.num,gen:ref.gen});
 }

 if(index===null||!Number.isInteger(index)||index<0||index>=document.numPages)throw new Error('PDF引用目标缺少有效页号');return index+1;
}
export function createPdfLinkService(document:PDFDocumentProxy,navigation:PdfNavigation,pages:readonly ReferencePage[]=[]):IPDFLinkService{
 let rotation=0;
 const goToPage=(value:number|string)=>{const page=Number(value);if(!navigation.isActive())return;if(Number.isInteger(page)&&page>=1&&page<=document.numPages)navigation.goToPage(page);else navigation.onNotice('PDF目标页码无效');};
 const destination=async(value:unknown)=>{
  try{const dest:unknown=typeof value==='string'?await document.getDestination(value):value;if(!navigation.isActive())return;
   const page=await resolvePdfDestinationPage(document,dest,pages);if(navigation.isActive())goToPage(page);
  }catch(cause:unknown){console.warn('PDF引用跳转失败',cause);if(navigation.isActive())navigation.onNotice('PDF引用无法定位，请使用页码导航。');}
 };
 return {get pagesCount(){return document.numPages;},get page(){return navigation.getPage();},set page(value){goToPage(value);},get rotation(){return rotation;},set rotation(value){rotation=value;},isInPresentationMode:false,externalLinkEnabled:false,
  goToDestination:destination,goToPage,goToXY:page=>goToPage(page),getDestinationHash:dest=> '#judu-dest='+encodeURIComponent(JSON.stringify(dest)),getAnchorUrl:anchor=>anchor,setHash:hash=>{const page=new URLSearchParams(hash.replace(/^#/u,'')).get('page');if(page)goToPage(page);},
  addLinkAttributes:(link,url)=>{link.href='#';link.dataset.pdfExternalUrl=url;link.title=url;link.rel='noopener noreferrer';link.onclick=event=>{event.preventDefault();navigation.onNotice('为保护本地书库，PDF外部链接不会自动打开：'+url);};},
  executeNamedAction:action=>{const page=navigation.getPage();if(action==='NextPage')goToPage(page+1);else if(action==='PrevPage')goToPage(page-1);else if(action==='FirstPage')goToPage(1);else if(action==='LastPage')goToPage(document.numPages);else navigation.onNotice('此PDF文档动作暂不支持。');},
  // WHY：文档脚本、外部跳转及图层动作都不转为应用代码执行；只支持核验后的页导航。
  executeSetOCGState:()=>navigation.onNotice('PDF交互图层切换暂不支持。'),
 };
}
