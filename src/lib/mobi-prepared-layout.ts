import {createHash} from 'node:crypto';
import {readMobiLayoutSnapshot, type MobiLayoutSnapshot, type MobiLayoutTarget} from './mobi-layout-snapshot';
import type {MobiDiagnostic} from './mobi-document-sanitizer.mjs';
export type MobiPreparedLayout = {
 snapshot:MobiLayoutSnapshot;
 diagnostics:{chapterId:string;entry:MobiDiagnostic}[];
 resourceDiagnostics:{base:string|null;value:string;reason:string}[];
 navigation:{locator:string;href:string;target:MobiLayoutTarget}[];
};
const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function fail():never{throw new Error('MOBI净化候选响应无效或超限');}
function object(v:unknown,keys:readonly string[]):Record<string,unknown>{if(!record(v)||Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))fail();return v;}
function list(v:unknown,max:number):unknown[]{if(!Array.isArray(v)||v.length>max||Object.keys(v).length!==v.length||Object.keys(v).some((key,index)=>key!==String(index)))fail();return v;}
function text(v:unknown,max=256):string{if(typeof v!=='string'||v.length>max)fail();return v;}
/** WHY：导航token由locator确定，不能任意交换表内href把同一HTML链接指向另一来源。 */
export function mobiNavigationToken(locator:string):string { return '#judu-mobi-locator-'+createHash('sha256').update(locator).digest('hex'); }
/** WHY：此边界只核验IPC形状/归属；untrusted快照不能因经过markup净化就升级为可发布资源包。 */
export function readMobiPreparedLayout(value:unknown):MobiPreparedLayout{
 const v=object(value,['snapshot','diagnostics','resourceDiagnostics','navigation']);
 const snapshot=readMobiLayoutSnapshot(v.snapshot),ids=new Set(snapshot.chapters.map(c=>c.id));
 const diagnostics=list(v.diagnostics,50000).map(raw=>{
  const d=object(raw,['chapterId','entry']),e=object(d.entry,['kind','action','name','reason']),chapterId=text(d.chapterId);
  if(!ids.has(chapterId)||!['element','attribute','resource','css','comment'].includes(String(e.kind))||!['removed','rewritten'].includes(String(e.action)))fail();
  return {chapterId,entry:{kind:e.kind as MobiDiagnostic['kind'],action:e.action as MobiDiagnostic['action'],name:text(e.name),reason:text(e.reason)}};
 });
 const resourceIds=new Set(snapshot.resources.map(r=>r.id));
 const resourceDiagnostics=list(v.resourceDiagnostics,20000).map(raw=>{
  const d=object(raw,['base','value','reason']),base=d.base===null?null:text(d.base,512);if(base!==null&&!resourceIds.has(base))fail();
  return {base,value:text(d.value,4096),reason:text(d.reason)};
 });
 const targets=new Map<string,MobiLayoutTarget>();
 for(const ref of [...snapshot.toc,...snapshot.links])if(ref.target){
  const previous=targets.get(ref.href);if(previous&&JSON.stringify(previous)!==JSON.stringify(ref.target))fail();targets.set(ref.href,ref.target);
 }
 const locators=new Set(),hrefs=new Set();
 const navigation=list(v.navigation,20000).map(raw=>{
  const n=object(raw,['locator','href','target']),locator=text(n.locator),href=text(n.href),target=targets.get(locator);
  if(!target||href!==mobiNavigationToken(locator)||locators.has(locator)||hrefs.has(href)||JSON.stringify(n.target)!==JSON.stringify(target))fail();
  locators.add(locator);hrefs.add(href);return {locator,href,target};
 });
 if(navigation.length!==targets.size)fail();
 return {snapshot,diagnostics,resourceDiagnostics,navigation};
}
