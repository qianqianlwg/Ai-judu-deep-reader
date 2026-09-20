import type {FoliateBook, FoliateNavigation, FoliateTocItem} from "./foliate-types";
import type {MobiPublication, MobiPublicationPoint} from "./mobi-publication-model";
import {rewriteMobiCssUrls} from "./mobi-css-urls.mjs";
const CSP="default-src 'none'; img-src blob:; style-src blob: 'unsafe-inline'; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; font-src 'none'; media-src 'none'";
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const decode=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const hash=async(value:string|Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",typeof value==="string"?new TextEncoder().encode(value):new Uint8Array(value))),v=>v.toString(16).padStart(2,'0')).join('');
function nodeAt(doc:Document,point:MobiPublicationPoint):Node {
 let node:Node=doc.body;
 for(const index of point.path){const next:ChildNode|undefined=node.childNodes[index];if(!next)throw new Error("MOBI引用节点不存在");node=next;}
 if(point.kind==="element"?(node.nodeType!==1||(node as Element).localName!==point.tag):(node.nodeType!==3||node.textContent?.length!==point.textLength))throw new Error("MOBI引用节点已变化");
 return node;
}
/** WHY：沿用Foliate原生blob章节、sandbox和公开API；不插入锚点、不改shadow root，避免改变来源路径和CFI。 */
export async function createMobiFoliateBook(model:MobiPublication):Promise<FoliateBook>{
 const urls=new Set<string>(),assets=new Map(model.resources.map(r=>[r.id,r])),jobs=new Map<string,Promise<string>>();
 let destroyed=false;
 const ensure=()=>{if(destroyed)throw new Error("MOBI原版已关闭");};
 const blob=(content:BlobPart,type:string)=>{ensure();const url=URL.createObjectURL(new Blob([content],{type}));urls.add(url);return url;};
 const destroy=()=>{if(destroyed)return;destroyed=true;for(const url of urls)URL.revokeObjectURL(url);urls.clear();jobs.clear();};
 const nav=new Map(model.navigation.map(n=>[n.href,n]));
 const documentOf=(html:string,head="")=>new DOMParser().parseFromString(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escape(CSP)}">${head}</head><body>${html}</body></html>`,"text/html");
 async function resourceUrl(value:string,parents:readonly string[]=[]):Promise<string>{
  if(value.startsWith('#'))return value;
  const index=value.indexOf('#'),id=index<0?value:value.slice(0,index),fragment=index<0?'':value.slice(index);
  if(parents.includes(id)||parents.length>16)throw new Error("MOBI资源循环或深度超限");
  let job=jobs.get(id);
  if(!job){
   const resource=assets.get(id);if(!resource)throw new Error("MOBI原版缺少资源");
   job=(async()=>{
    const bytes=decode(resource.base64);if(await hash(bytes)!==resource.hash)throw new Error("MOBI资源校验失败");
    const resolve=(next:string)=>resourceUrl(next,[...parents,id]);
    if(resource.mediaType==="text/css")return blob(await rewriteMobiCssUrls(new TextDecoder('utf-8',{fatal:true}).decode(bytes),resolve),"text/css");
    if(resource.mediaType==="image/svg+xml"){
     const doc=documentOf(new TextDecoder('utf-8',{fatal:true}).decode(bytes));await rewriteDocument(doc,resolve);
     const root=doc.body.firstElementChild;if(!root||root.localName!=="svg"||doc.body.children.length!==1)throw new Error("MOBI矢量图片结构无效");
     // WHY：HTML serializer不保证XML空元素/命名空间；通过实际SVG DOM重新序列化再建立image/svg+xml。
     return blob(new XMLSerializer().serializeToString(root),"image/svg+xml");
    }
    return blob(new Uint8Array(bytes),resource.mediaType);
   })();jobs.set(id,job);
  }
  return await job+fragment;
 }
 async function rewriteDocument(doc:Document,resolve:(value:string)=>Promise<string>):Promise<void>{
  for(const element of Array.from(doc.querySelectorAll('*'))){
   for(const attribute of Array.from(element.attributes)){
    if(attribute.localName==='style'){element.setAttribute('style',await rewriteMobiCssUrls(attribute.value,resolve,true));continue;}
    if(!['href','src','poster'].includes(attribute.localName))continue;
    if(nav.has(attribute.value)&&element.localName==='a'){
     const target=nav.get(attribute.value)!;element.setAttributeNS(attribute.namespaceURI,attribute.name,'/'+target.chapterId+target.href);continue;
    }
    if(attribute.value.startsWith('mobi-resource-v1/'))element.setAttributeNS(attribute.namespaceURI,attribute.name,await resolve(attribute.value));
   }
   if(element.localName==='style')element.textContent=await rewriteMobiCssUrls(element.textContent??'',resolve);
  }
 }
 const texts=new Map<string,string>();
 const targetFor=(href:string):{index:number;point?:MobiPublicationPoint;key?:string}|null=>{
  if(/^[a-z][\w+.-]*:/iu.test(href)||href.startsWith('//'))return null;
  const fragment=href.includes('#')?'#'+href.split('#')[1]:'';
  const target=nav.get(fragment||href);
  if(target)return {index:model.chapters.findIndex(c=>c.id===target.chapterId),point:target.point,key:target.href};
  const id=href.replace(/^\//u,'').split('#')[0],index=model.chapters.findIndex(c=>c.id===id);
  return index>=0&&!fragment?{index}:null;
 };
 const resolveHref=(href:string):FoliateNavigation|null=>{
  ensure();const target=targetFor(href);if(!target||target.index<0)return null;
  return {index:target.index,anchor:doc=>{
   if(!target.point)return doc.body;
   const node=nodeAt(doc,target.point);if(target.point.kind==='element')return node as Element;
   if(node.textContent!==texts.get(target.key!))throw new Error("MOBI引用文本与来源不一致");
   const range=doc.createRange();range.setStart(node,target.point.offset);range.collapse(true);return range;
  }};
 };
 try{
  const sections=[];
  for(const chapter of model.chapters){
   if(await hash(chapter.html)!==chapter.htmlHash)throw new Error("MOBI章节校验失败");
   const doc=documentOf(chapter.html,chapter.head);
   for(const n of model.navigation.filter(n=>n.chapterId===chapter.id)){
    const node=nodeAt(doc,n.point);
    if(n.point.kind==='text'){const text=node.textContent??'';if(await hash(text)!==n.point.textHash)throw new Error("MOBI引用来源校验失败");texts.set(n.href,text);}
   }
   doc.documentElement.setAttribute("data-judu-mobi-chapter",chapter.id);
   await rewriteDocument(doc,value=>resourceUrl(value));
   const source='<!doctype html>'+doc.documentElement.outerHTML;let url:string|null=null;
   sections.push({id:chapter.id,size:doc.body.textContent?.length||1,
    createDocument:async()=>{ensure();return new DOMParser().parseFromString(source,'text/html');},
    load:async()=>{ensure();url??=blob(source,'text/html');return url;},
    unload:()=>{if(url){if(urls.delete(url))URL.revokeObjectURL(url);url=null;}}
   });
  }
  const toc:FoliateTocItem[]=[],stack:{depth:number;items:FoliateTocItem[]}[]=[{depth:-1,items:toc}];
  for(const entry of model.toc){while(stack.length>1&&stack.at(-1)!.depth>=entry.depth)stack.pop();const item:FoliateTocItem={label:entry.label,href:entry.href};stack.at(-1)!.items.push(item);item.subitems=[];stack.push({depth:entry.depth,items:item.subitems});}
  return {sections,toc,metadata:{title:model.title,author:model.authors.join('、')},rendition:{layout:'reflowable'},positionIdentity:`mobi-publication-v1:${model.sourceHash}:${model.layoutHash}`,
   resolveHref,isExternal:href=>/^[a-z][\w+.-]*:/iu.test(href)||href.startsWith('//'),
   splitTOCHref:href=>{const target=targetFor(href);return target?[model.chapters[target.index].id,target.key?.slice(1)??'']:['',''];},
   getTOCFragment:(doc,id)=>{const location=resolveHref('#'+id);
    // WHY：Foliate目录进度会沿用前一章的目录组，查询当前doc中不存在的条目应返回null而非中断翻页。
    if(!location||doc.documentElement.getAttribute('data-judu-mobi-chapter')!==model.chapters[location.index].id)return null;
    const target=location.anchor(doc);return target&&typeof target==='object'&&'startContainer'in target?target.startContainer.parentElement:target&&typeof target==='object'&&'nodeType'in target?target:null;},destroy};
 }catch(cause:unknown){destroy();throw cause;}
}
