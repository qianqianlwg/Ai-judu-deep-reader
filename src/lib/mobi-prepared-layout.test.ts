import {describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {readMobiPreparedLayout,mobiNavigationToken} from './mobi-prepared-layout';
function valid(){const html='<p>正文</p>',target={chapterId:'0',htmlHash:createHash('sha256').update(html).digest('hex'),locator:'filepos:0',byteOffset:0,htmlOffset:0,point:{kind:'element',path:[0],tag:'p',offset:0}};return {snapshot:{schema:'mobi-layout-untrusted-v3',kind:'mobi',sourceHash:'a'.repeat(64),title:'书',authors:[],cover:null,chapters:[{id:'0',title:'章',html,head:'',css:[],paragraphs:['正文']}],resources:[],toc:[],links:[{chapterId:'0',href:'filepos:0',target,reason:'exact-source'}]},diagnostics:[{chapterId:'0',entry:{kind:'attribute',action:'removed',name:'onclick',reason:'event-handler'}}],resourceDiagnostics:[],navigation:[{locator:'filepos:0',href:mobiNavigationToken('filepos:0'),target}]};}
describe('MOBI内部净化候选IPC',()=>{
 it('允许结构正确且绑定当前章节hash的候选，但不升级untrusted身份',()=>{expect(readMobiPreparedLayout(valid())).toEqual(valid());});
 it.each(['extra','schema','html','unknown-chapter','role','huge','sparse','external-nav','wrong-target','duplicate'])('拒绝%s损坏响应',field=>{
  const value=valid();
  if(field==='extra')Object.assign(value,{safe:true});
  if(field==='schema')value.snapshot.schema='safe-v1';
  if(field==='html')value.snapshot.chapters[0].html='<p>换包</p>';
  if(field==='unknown-chapter')value.diagnostics[0].chapterId='unknown';
  if(field==='role')value.diagnostics[0].entry.kind='secret';
  if(field==='huge')value.diagnostics[0].entry.name='x'.repeat(257);
  if(field==='sparse')value.diagnostics=new Array(1);
  if(field==='external-nav')value.navigation[0].href='https://evil.test';
  if(field==='wrong-target')value.navigation[0].target={...value.navigation[0].target,htmlHash:'b'.repeat(64)};
  if(field==='duplicate')value.navigation.push(value.navigation[0]);
  expect(()=>readMobiPreparedLayout(value)).toThrow();
 });
});

it('拒绝同一locator冲突、导航token交换及导航缺失',()=>{
 const conflicting=valid();const first=conflicting.snapshot.links[0];conflicting.snapshot.links.push({...first,target:{...first.target,point:{...first.target.point,path:[1]}}});expect(()=>readMobiPreparedLayout(conflicting)).toThrow();
 const swapped=valid();swapped.navigation[0].href=mobiNavigationToken('filepos:1');expect(()=>readMobiPreparedLayout(swapped)).toThrow();
 const missing=valid();missing.navigation=[];expect(()=>readMobiPreparedLayout(missing)).toThrow();
});
