// @ts-check
import {createHash} from 'node:crypto';
import {decodeMobiSource,parseMobiSourceLocator} from './mobi-source-bytes.mjs';
import {indexMobiSourceHtml} from './mobi-source-html.mjs';
import {projectMobiDocument} from './mobi-document-projection.mjs';
import {rewriteMobiResourceMarkup,rewriteMobiLegacyMarkup} from './mobi-layout-rewrite.mjs';
/** @typedef {import('./mobi-source-bytes.mjs').MobiSourceChapter} Source */
/** @typedef {import('./mobi-layout-snapshot').MobiLayoutTarget} Target */
/** @param {'mobi'|'kf8'} kind @param {Source[]} sources @param {{id:string;html:string}[]} layouts @param {ReadonlyMap<string,string>} [resources] */
export function buildMobiSourceIndex(kind,sources,layouts,resources=new Map()){
 if(!(resources instanceof Map)||resources.size>20000)throw new Error("MOBI资源来源映射无效");
 for(const [key,value]of resources)if(typeof key!=="string"||key.length>4096||typeof value!=="string"||value.length>512||/^mobi-resource-v1\/[A-Za-z0-9_-]+\.[a-z0-9]+$/u.exec(value)?.[0]!==value)throw new Error("MOBI资源来源映射无效");
 if(!['mobi','kf8'].includes(kind)||!Array.isArray(sources)||!Array.isArray(layouts)||sources.length!==layouts.length||sources.length>10000)throw new Error('MOBI来源章节不一致');
 /** @type {Map<string,{bodyAllowed:boolean;htmlHash:string;start:number;end:number;decoded:ReturnType<typeof decodeMobiSource>;html:ReturnType<typeof indexMobiSourceHtml>;expected:ReturnType<typeof indexMobiSourceHtml>;rendered:ReturnType<typeof indexMobiSourceHtml>}>} */
 const chapters=new Map();
 /** @type {Map<number,{chapterId:string;start:number;end:number;targetStart:number}[]>} */
 const fragments=new Map();
 /** @type {{chapterId:string;start:number;end:number}[]} */
 const files=[];
 let total=0,totalLayout=0,totalSpans=0;
 for(const [index,source]of sources.entries()){
  const layout=layouts[index];
  if(!source||!layout||typeof source.id!=='string'||!source.id||chapters.has(source.id)||source.id!==layout.id||!(source.bytes instanceof Uint8Array)||typeof layout.html!=='string')throw new Error('MOBI来源身份无效');
  total+=source.bytes.length;totalLayout+=layout.html.length;
  if(total>20_000_000||totalLayout>20_000_000)throw new Error('MOBI来源正文超限');
  const decoded=decodeMobiSource(source.bytes,source.encoding);
  if(kind==='mobi'){
   const end=(source.fileStart??NaN)+source.bytes.length;
   if(typeof source.fileStart!=='number'||!Number.isSafeInteger(source.fileStart)||source.fileStart<0||!Number.isSafeInteger(end)||source.spans!==undefined)throw new Error('MOBI正文来源起点无效');
   files.push({chapterId:source.id,start:source.fileStart,end});
  }else{
   if(source.fileStart!==undefined||!Array.isArray(source.spans))throw new Error('KF8片段映射无效');
   totalSpans+=source.spans.length;if(totalSpans>20000)throw new Error('KF8片段映射超限');
   /** @type {{start:number;end:number}[]} */
   const destinations=[];
   for(const span of source.spans){
    if(!span||![span.fid,span.start,span.end,span.targetStart].every(value=>Number.isSafeInteger(value)&&value>=0)||span.fid>0xffffffff||span.end<=span.start)throw new Error('KF8片段来源越界');
    const targetEnd=span.targetStart+(span.end-span.start);
    if(!Number.isSafeInteger(targetEnd)||targetEnd>source.bytes.length)throw new Error('KF8片段来源越界');
    destinations.push({start:span.targetStart,end:targetEnd});
    const list=fragments.get(span.fid)??[];
    if(list.length&&list[0].chapterId!==source.id)throw new Error('KF8片段ID串章');
    list.push({chapterId:source.id,...span});fragments.set(span.fid,list);
   }
   // WHY：不同fid不能声明同一输出字节；未覆盖部分可来自skeleton，不要求片段填满章节。
   destinations.sort((a,b)=>a.start-b.start);
   for(let i=1;i<destinations.length;i++)if(destinations[i].start<destinations[i-1].end)throw new Error('KF8片段目标区间重叠');
  }
  const projection=projectMobiDocument(decoded.text);
  const expected=kind==="kf8"?rewriteMobiResourceMarkup(projection.body,uri=>resources.get(uri)??uri):rewriteMobiLegacyMarkup(projection.body,index=>resources.get(String(index)));
  chapters.set(source.id,{bodyAllowed:projection.bodyAllowed,htmlHash:createHash("sha256").update(layout.html).digest("hex"),expected:indexMobiSourceHtml(expected,"body-fragment"),start:projection.start,end:projection.end,decoded,html:indexMobiSourceHtml(projection.body,"body-fragment"),rendered:indexMobiSourceHtml(layout.html,"body-fragment")});
 }
 files.sort((a,b)=>a.start-b.start);
 for(let i=1;i<files.length;i++)if(files[i].start<files[i-1].end)throw new Error('MOBI来源区间重叠');
 for(const list of fragments.values()){
  list.sort((a,b)=>a.start-b.start);
  for(let i=1;i<list.length;i++)if(list[i].start!==list[i-1].end)throw new Error('KF8片段来源不连续或重叠');
  if(list[0].start!==0)throw new Error('KF8片段起点缺失');
 }
 /** @type {Map<string,Target|null>} */
 const cache=new Map();
 // WHY：MOBI6的首章根容器覆盖后续pagebreak章节，不能在后续片段重置为可见。
 const bookBodyAllowed=kind!=="mobi"||!files.length||chapters.get(files[0].chapterId)?.bodyAllowed===true;
 return {
  /** @param {string} href @returns {Target|null} */
  resolve(href){
   if(cache.has(href))return cache.get(href)??null;
   if(cache.size>=20000)throw new Error('MOBI来源定位请求超限');
   const locator=parseMobiSourceLocator(href);if(!locator||locator.kind!==kind)return null;
   let chapterId='',byteOffset=-1;
   if(locator.kind==='mobi'){
    // WHY：区间含起点不含终点；紧邻下一章不能错误落到上一章末尾。
    const range=files.find(range=>locator.offset>=range.start&&locator.offset<range.end);
    if(range){chapterId=range.chapterId;byteOffset=locator.offset-range.start;}
   }else{
    const list=fragments.get(locator.fid),span=list?.find(span=>locator.offset>=span.start&&locator.offset<span.end);
    if(span){chapterId=span.chapterId;byteOffset=span.targetStart+locator.offset-span.start;}
   }
   const chapter=chapters.get(chapterId);if(!chapter||!chapter.bodyAllowed||!bookBodyAllowed){cache.set(href,null);return null;}
   const htmlOffset=chapter.decoded.characterOffset(byteOffset);
   if(htmlOffset===null||htmlOffset<chapter.start||htmlOffset>=chapter.end){cache.set(href,null);return null;}
   const point=chapter.html.locate(htmlOffset-chapter.start);
   // WHY：根容器不属于正文子节点协议，不能以首段冒充；局部path/tag相同也不够；还须核对正文结构签名，避免删段后跳到同路径的另一段。
   if(!point||!point.path.length||typeof chapter.html.structureHash!=='string'||chapter.expected.structureHash!==chapter.rendered.structureHash||!chapter.expected.matches(point)||!chapter.rendered.matches(point)){cache.set(href,null);return null;}
   /** @type {Target} */
   const target={chapterId,htmlHash:chapter.htmlHash,locator:href,byteOffset,htmlOffset:/** @type {number} */(htmlOffset),point:point.kind==='element'?point:{kind:'text',path:point.path,offset:point.offset,textLength:point.text.length,textHash:createHash('sha256').update(point.text).digest('hex')}};
   cache.set(href,target);return target;
  }
 };
}
