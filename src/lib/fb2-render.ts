import {visibleText,type Fb2Book,type Fb2Node,type Fb2Section} from './fb2-book';
import type {FoliateBook,FoliateSection,FoliateTocItem} from './foliate-types';
const escape=(text:string)=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const voidTags=new Set(['img','br']);
const style='body{margin:0;padding:1em;line-height:1.7;font-family:serif}img{max-width:100%;height:auto}section>img{display:block;margin:1em auto}h1{text-align:center}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid currentColor;padding:.25em .5em}.fb2-poem{margin-inline:2em}.fb2-v{margin:.15em 0}.fb2-stanza{margin-block:1em}.fb2-align-center{text-align:center}.fb2-align-right{text-align:right}.fb2-align-left{text-align:left}.fb2-align-justify{text-align:justify}';
function html(node:Fb2Node,images:ReadonlyMap<string,string>):string{
 if(typeof node==='string')return escape(node);const attributes={...node.attributes};const image=attributes['data-fb2-image'];if(image){const url=images.get(image);if(!url)throw new Error('FB2图片资源不可用');delete attributes['data-fb2-image'];attributes.src=url;}
 const start='<'+node.tag+Object.entries(attributes).map(([key,value])=>' '+key+'="'+escape(value)+'"').join('');return voidTags.has(node.tag)?start+'/>':start+'>'+node.children.map(child=>html(child,images)).join('')+'</'+node.tag+'>';
}
function xhtml(section:Fb2Section,book:Fb2Book,images:ReadonlyMap<string,string>):string{
 // WHY：只序列化白名单编译后的节点，所有文字和属性转义；章节仍通过原生blob加载，没有srcdoc或shadow-root绕过。
 return '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="'+escape(book.language)+'"><head><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; img-src blob:; style-src &apos;unsafe-inline&apos;; script-src &apos;none&apos;; connect-src &apos;none&apos;; object-src &apos;none&apos;; base-uri &apos;none&apos;; form-action &apos;none&apos;"/><title>'+escape(section.title)+'</title><style>'+style+'</style></head><body>'+section.nodes.map(node=>html(node,images)).join('')+'</body></html>';
}
function subNavigation(nodes:readonly Fb2Node[],href:string):FoliateTocItem[]{
 return nodes.flatMap(node=>{if(typeof node==='string')return [];const children=subNavigation(node.children,href),title=node.children.find(child=>typeof child!=='string'&&child.tag==='header');
  return node.tag==='section'&&node.attributes.id&&title?[{label:visibleText(title).replace(/\s+/gu,' ').trim(),href:href+'#'+encodeURIComponent(node.attributes.id),...(children.length?{subitems:children}:{})}]:children;
 });
}
export function createFb2FoliateBook(model:Fb2Book):FoliateBook{
 const images=new Map<string,string>(),urls=new Set<string>();let destroyed=false;
 const create=(blob:Blob)=>{const url=URL.createObjectURL(blob);urls.add(url);return url;};
 const ensure=()=>{if(destroyed)throw new Error('FB2原版资源已销毁');};
 const destroy=()=>{if(destroyed)return;destroyed=true;for(const url of urls)URL.revokeObjectURL(url);urls.clear();images.clear();};
 try{
  for(const image of model.images)images.set(image.id,create(new Blob([new Uint8Array(image.bytes)],{type:image.type})));
  const toc:FoliateTocItem[]=[],sections:FoliateSection[]=model.sections.map(section=>{
   const source=xhtml(section,model,images);let url:string|null=null;
   const createDocument=async()=>{ensure();const doc=new DOMParser().parseFromString(source,'application/xhtml+xml');if(doc.querySelector('parsererror'))throw new Error('FB2安全章节结构无效');return doc;};
   const subitems=subNavigation(section.nodes.flatMap(node=>typeof node==='string'?[]:node.children),section.href);toc.push({label:section.title,href:section.href,...(subitems.length?{subitems}:{})});
   return {id:section.href,size:section.paragraphs.join('').length||1,linear:section.linear,createDocument,load:async()=>{ensure();url??=create(new Blob([source],{type:'application/xhtml+xml'}));return url;},unload:()=>{if(url){if(urls.delete(url))URL.revokeObjectURL(url);url=null;}}};
  });
  const split=(href:string)=>{const [path,fragment]=href.replace(/^\//u,'').split('#',2);return [path,fragment?decodeURIComponent(fragment):''];};
  return {sections,toc,metadata:{title:model.title,author:model.author,language:model.language},rendition:{layout:'reflowable'},
   splitTOCHref:split,getTOCFragment:(doc,id)=>doc.getElementById(id),isExternal:href=>/^[a-z][\w+.-]*:/iu.test(href)||href.startsWith('//'),
   resolveHref:href=>{ensure();if(/^[a-z][\w+.-]*:/iu.test(href)||href.startsWith('//'))return null;const [path,id]=split(href),index=sections.findIndex(section=>section.id===path);if(index<0)return null;return {index,anchor:doc=>{if(!id)return doc.body;const target=doc.getElementById(id);if(!target)throw new Error('FB2引用位置不可用');return target;}};},destroy};
 }catch(error:unknown){destroy();throw error;}
}
