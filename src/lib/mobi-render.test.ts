// @vitest-environment jsdom
import {Blob as NodeBlob} from 'node:buffer';
import {createHash,webcrypto} from 'node:crypto';
import sharp from 'sharp';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createMobiFoliateBook} from './mobi-render';
import {publishMobiFile,publishMobiLayout} from './mobi-publication-server';
import {prepareMobiLayoutMarkup} from './mobi-layout-preparation.mjs';
import {makeMobiFixture} from './mobi-fixture';
import {parseMobiFile} from './mobi-parser';
import {mapMobiDocument} from './mobi-browser-source-map';
import {previewEpubLink} from './epub-link-preview';
import {rangeForEpubAnchor,selectionFromEpubRange} from './epub-source-map';
import type {MobiLayoutSnapshot} from './mobi-layout-snapshot';
import type {FoliateBook} from './foliate-types';
let allocated:Map<string,Blob>,revoked:Set<string>,books:FoliateBook[],counter:number;
beforeEach(()=>{
 allocated=new Map();revoked=new Set();books=[];counter=0;vi.stubGlobal('Blob',NodeBlob);vi.stubGlobal('crypto',webcrypto);
 // WHY：同一集成测试调用Node worker与jsdom；统一测试TypedArray realm，不改产品校验。
 vi.stubGlobal('Uint8Array',Object.getPrototypeOf(Buffer.prototype).constructor);
 vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('禁止网络或真实AI');}));
 Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn((blob:Blob)=>{const url='blob:mobi-'+(++counter);allocated.set(url,blob);return url;})});
 Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn((url:string)=>revoked.add(url))});
});
afterEach(()=>{for(const book of books)book.destroy?.();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function create(bytes=makeMobiFixture()){const model=await publishMobiFile(bytes),book=await createMobiFoliateBook(model);books.push(book);return {book,model};}
it('沿用原生HTML blob章节，图文和主题基础样式保留、私有CSP隔离',async()=>{
 const image=await sharp({create:{width:2,height:2,channels:4,background:'#cd1234'}}).png().toBuffer();
 const {book}=await create(makeMobiFixture({resources:[image],text:'<html><head><style>p{color:red}</style></head><body><h1>标题</h1><p>正文😀</p><img recindex="1"></body></html>'}));
 const doc=await book.sections[0].createDocument();expect(doc.querySelector('p')?.textContent).toBe('正文😀');expect(doc.querySelector('img')?.getAttribute('src')).toMatch(/^blob:mobi-/);expect(doc.querySelector('style')?.textContent).toContain('color:red');
 expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("script-src 'none'");
 const url=await book.sections[0].load();expect(allocated.get(url!)?.type).toBe('text/html');expect(await allocated.get(url!)!.text()).toContain('正文😀');expect(fetch).not.toHaveBeenCalled();
 book.destroy?.();expect(revoked).toEqual(new Set(allocated.keys()));await expect(book.sections[0].load()).rejects.toThrow('已关闭');
},20000);
it('同文filepos定位第二段真实Range，引用浮窗和跳转不伪造getElementById',async()=>{
 let html='<html><body><p>重复😀</p><p>重复😀</p><a filepos="0000000000">脚注</a></body></html>';
 html=html.replace('0000000000',String(Buffer.byteLength(html.slice(0,html.lastIndexOf('重复')))).padStart(10,'0'));
 const {book,model}=await create(makeMobiFixture({text:html})),doc=await book.sections[0].createDocument(),link=doc.querySelector('a')!.getAttribute('href')!;
 expect(doc.getElementById(model.navigation[0].href.slice(1))).toBeNull();const resolved=book.resolveHref!(link)!;
 const target=resolved.anchor(doc);expect(typeof target).not.toBe('number');expect('startContainer'in(target as Range)).toBe(true);expect((target as Range).startContainer.parentElement).toBe(doc.querySelectorAll('p')[1]);
 const preview=await previewEpubLink(link,book.sections,0,doc,book);expect(preview).toMatchObject({text:'重复😀',index:0,navigationHref:link});expect(book.splitTOCHref?.(link)).toEqual([book.sections[0].id,model.navigation[0].href.slice(1)]);expect(book.getTOCFragment?.(doc,model.navigation[0].href.slice(1))).toBe(doc.querySelectorAll('p')[1]);
 const foreign=new DOMParser().parseFromString('<p>另一章</p>','text/html');expect(book.getTOCFragment?.(foreign,model.navigation[0].href.slice(1))).toBeNull();
},20000);
it('原版文本Range能往返精读来源，章节切换不依赖字符串模糊搜索',async()=>{
 const bytes=makeMobiFixture(),canonical=await parseMobiFile(bytes,'test.mobi'),{book}=await create(bytes);
 for(const [index,source]of canonical.chapters.entries()){
  const chapter={id:'c'+index,title:source.title,sourceHref:source.sourceHref,paragraphs:source.paragraphs.map((text,n)=>({id:`p${index}-${n}`,text}))};
  const doc=await book.sections[index].createDocument(),maps=mapMobiDocument(doc,chapter);expect(maps).toHaveLength(chapter.paragraphs.length);
  for(const p of chapter.paragraphs){const range=rangeForEpubAnchor(maps,p.id,0,p.text.length)!;expect(selectionFromEpubRange(range,maps)).toMatchObject({paragraphId:p.id,text:p.text});}
 }
},20000);
it('包内CSS import条件保留并转为blob，SVG输出为合法XML；不改CSS惰性字符串',async()=>{
 const raw:MobiLayoutSnapshot={schema:'mobi-layout-untrusted-v3',kind:'mobi',sourceHash:'a'.repeat(64),title:'书',authors:[],cover:null,chapters:[{id:'0',title:'章',html:'<p>正文</p><img src="mobi-resource-v1/art.svg">',head:'<style>@import "mobi-resource-v1/root.css" screen;</style>',css:[],paragraphs:['正文']}],toc:[],links:[],resources:[
  {id:'mobi-resource-v1/root.css',mediaType:'text/css',bytes:Buffer.from('@import "tail.css" layer(book) supports(display: grid) print;p::before{content:"mobi-resource-v1/tail.css"}')},
  {id:'mobi-resource-v1/tail.css',mediaType:'text/css',bytes:Buffer.from('p{color:blue}')},
  {id:'mobi-resource-v1/art.svg',mediaType:'image/svg+xml',bytes:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="2"/></svg>')},
 ]};
 const model=await publishMobiLayout(await prepareMobiLayoutMarkup(raw)),book=await createMobiFoliateBook(model);books.push(book);
 const contents=await Promise.all([...allocated.values()].map(b=>b.text()));expect(contents.some(text=>text.includes('layer(book)')&&text.includes('blob:mobi-')&&text.includes('print'))).toBe(true);expect(contents.some(text=>text.includes('content:"mobi-resource-v1/tail.css"'))).toBe(true);
 const svg=[...allocated.values()].find(b=>b.type==='image/svg+xml')!;const doc=new DOMParser().parseFromString(await svg.text(),'image/svg+xml');expect(doc.querySelector('parsererror')).toBeNull();expect(doc.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg');
});
it('篡改章节/资源hash即失败且释放已建blob',async()=>{
 const model=await publishMobiFile(makeMobiFixture());model.chapters[0].html+='<p>变了</p>';
 await expect(createMobiFoliateBook(model)).rejects.toThrow('章节校验');expect(revoked).toEqual(new Set(allocated.keys()));
 const raw=await publishMobiFile(makeMobiFixture());raw.chapters[0].htmlHash=createHash('sha256').update(raw.chapters[0].html).digest('hex');const book=await createMobiFoliateBook(raw);books.push(book);const url=await book.sections[0].load();book.sections[0].unload();expect(revoked.has(url!)).toBe(true);expect(await book.sections[0].load()).not.toBe(url);
},20000);
