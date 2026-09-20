import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {prepareMobiLayoutMarkup} from './mobi-layout-preparation.mjs';
import {parseMobiLayout,prepareMobiFileLayout} from './mobi-layout';
import {makeMobiFixture} from './mobi-fixture';
import {makeKf8Fixture} from './kf8-fixture';
import type {MobiLayoutSnapshot} from './mobi-layout-snapshot';
import {JSDOM} from 'jsdom';
const hash=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=','base64');
function plain(html='<p>正文</p>'):MobiLayoutSnapshot{return {schema:'mobi-layout-untrusted-v3',kind:'mobi',sourceHash:'a'.repeat(64),title:'书',authors:[],cover:null,chapters:[{id:'0',title:'章',html,head:'',css:[],paragraphs:['正文']}],resources:[],toc:[],links:[]};}
it('真实MOBI6保留图片、head样式、段落与原件hash，不把净化标记升级为可执行安全包',async()=>{
 const raw=await parseMobiLayout(makeMobiFixture({resources:[png],text:'<html><head><style>p{color:red}</style></head><body><script>evil()</script><p onclick="bad()">正文</p><img recindex="1"><img src="https://evil.test/x"></body></html>'}));
 const {snapshot:safe,diagnostics}=await prepareMobiLayoutMarkup(raw);
 expect(safe.schema).toBe('mobi-layout-untrusted-v3');expect(safe.sourceHash).toBe(raw.sourceHash);
 expect(safe.chapters[0].paragraphs).toEqual(raw.chapters[0].paragraphs);expect(safe.chapters[0].html).not.toMatch(/script|onclick|evil.test/);
 expect(safe.chapters[0].html).toContain('mobi-resource-v1/1.png');expect(safe.chapters[0].head).toContain('color:red');
 expect(safe.resources.map(r=>[r.id,hash(r.bytes)])).toEqual(raw.resources.map(r=>[r.id,hash(r.bytes)]));expect(diagnostics.length).toBeGreaterThan(0);
});
it('重复正文的filepos在删script/注释后仍逐DOM点对应第二段',async()=>{
 let html='<html><body><script>not executed</script><!--cut--><p>重复😀</p><p>重复😀</p><a filepos="0000000000">跳</a></body></html>';
 const offset=Buffer.byteLength(html.slice(0,html.lastIndexOf('重复')));html=html.replace('0000000000',String(offset).padStart(10,'0'));
 const raw=await parseMobiLayout(makeMobiFixture({text:html}));
 expect(raw.links[0].target?.point.path).toEqual([3,0]);
 const result=await prepareMobiLayoutMarkup(raw),target=result.snapshot.links[0].target!;
 expect(target.point.path).toEqual([1,0]);expect(target.locator).toBe(raw.links[0].href);expect(target.byteOffset).toBe(raw.links[0].target?.byteOffset);
 expect(target.htmlHash).toBe(hash(result.snapshot.chapters[0].html));expect(result.navigation).toHaveLength(1);
 const dom=new JSDOM('<body></body>');try{
  dom.window.document.body.innerHTML=result.snapshot.chapters[0].html;let node:Node=dom.window.document.body;
  for(const index of target.point.path)node=node.childNodes[index];
  expect(node.textContent).toBe('重复😀');expect(node.parentNode).toBe(dom.window.document.querySelectorAll('p')[1]);
 }finally{dom.window.close();}
});
it('真实KF8正文/字体/图片与样式顺序保留，CSS网络引用移除',async()=>{
 const raw=await parseMobiLayout(makeKf8Fixture({fragment:'<p>正文😀</p>',css:'p{color:blue;background:url("kindle:embed:0001?mime=image/png")} @font-face{font-family:book;src:url("kindle:embed:0002?mime=font/ttf")} p{cursor:url(https://evil.test/x)}',resources:[png,Buffer.from([0,1,0,0,1,2,3,4])]}));
 const result=await prepareMobiLayoutMarkup(raw);
 const css=result.snapshot.resources.find(r=>r.mediaType==='text/css');expect(css).toBeDefined();const text=new TextDecoder().decode(css!.bytes);
 expect(text).toContain('color:blue');expect(text).toContain('mobi-resource-v1/0001.png');expect(text).toContain('mobi-resource-v1/0002.ttf');expect(text).not.toContain('evil.test');
 expect(result.snapshot.chapters[0].paragraphs).toEqual(raw.chapters[0].paragraphs);
});
it('CSS import走资源依赖图，保留条件，不丢弃包内导入',async()=>{
 const raw=plain();raw.chapters[0].css=['mobi-resource-v1/root.css'];
 raw.resources=[{id:'mobi-resource-v1/root.css',mediaType:'text/css',bytes:Buffer.from('@import "tail.css" screen; p{color:red}')},{id:'mobi-resource-v1/tail.css',mediaType:'text/css',bytes:Buffer.from('p{color:blue}')}];
 const result=await prepareMobiLayoutMarkup(raw);
 expect(new TextDecoder().decode(result.snapshot.resources[0].bytes)).toMatch(/@import.*mobi-resource-v1\/tail.css.*screen/);
 expect(new TextDecoder().decode(result.snapshot.resources[1].bytes)).toContain('color:blue');
});
it('缺资源、角色错配和CSS循环直接失败，不返回不完整原版',async()=>{
 const missing=plain('<img src="mobi-resource-v1/a.png">');await expect(prepareMobiLayoutMarkup(missing)).rejects.toThrow('缺少');
 const wrong=plain('<img src="mobi-resource-v1/a.css">');wrong.resources=[{id:'mobi-resource-v1/a.css',mediaType:'text/css',bytes:Buffer.from('p{}')}];await expect(prepareMobiLayoutMarkup(wrong)).rejects.toThrow('角色');
 const cycle=plain();cycle.chapters[0].css=['mobi-resource-v1/a.css'];cycle.resources=[{id:'mobi-resource-v1/a.css',mediaType:'text/css',bytes:Buffer.from('@import "a.css"')}];await expect(prepareMobiLayoutMarkup(cycle)).rejects.toThrow('循环');
});
it('输入目标hash正确但文本hash错误不能被净化流程洗成可信来源',async()=>{
 const raw=plain();raw.links=[{chapterId:'0',href:'filepos:0',reason:'exact-source',target:{chapterId:'0',htmlHash:hash(raw.chapters[0].html),locator:'filepos:0',byteOffset:0,htmlOffset:0,point:{kind:'text',path:[0,0],offset:0,textLength:2,textHash:hash('错误')}}}];
 await expect(prepareMobiLayoutMarkup(raw)).rejects.toThrow('正文节点不一致');
});

it.each([1,2] as const)('可终止worker的prepared模式端到端净化MOBI compression=%s，原公开text/layout模式不受影响',async compression=>{
 const bytes=makeMobiFixture({compression,resources:[png],text:'<html><head><style>p{color:red}</style></head><body><p onclick="bad()">正文😀</p><img recindex="1"><img src="https://evil.test/x"></body></html>'});
 const result=await prepareMobiFileLayout(bytes);
 expect(result.snapshot.sourceHash).toBe(hash(bytes));expect(result.snapshot.chapters[0].html).not.toMatch(/onclick|evil.test/);
 expect(result.snapshot.chapters[0].html).toContain('mobi-resource-v1/1.png');expect(result.snapshot.chapters[0].head).toContain('color:red');
 expect(result.snapshot.resources[0].bytes).toEqual(new Uint8Array(png));expect(result.diagnostics.length).toBeGreaterThan(0);
},20000);

it('head相对CSS import以受控平铺包资源为基准保留，不静默删导入',async()=>{
 const raw=plain();raw.chapters[0].head='<style>@import "tail.css" screen; p{color:red}</style>';
 raw.resources=[{id:'mobi-resource-v1/tail.css',mediaType:'text/css',bytes:Buffer.from('p{color:blue}')}];
 const result=await prepareMobiLayoutMarkup(raw);expect(result.snapshot.chapters[0].head).toContain('mobi-resource-v1/tail.css');
 expect(result.snapshot.chapters[0].head).toContain('screen');
});
