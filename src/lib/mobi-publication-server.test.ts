import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {expect,it} from 'vitest';
import {publishMobiFile,publishMobiLayout} from './mobi-publication-server';
import {prepareMobiLayoutMarkup} from './mobi-layout-preparation.mjs';
import {makeMobiFixture} from './mobi-fixture';
import {makeKf8Fixture} from './kf8-fixture';
import type {MobiLayoutSnapshot} from './mobi-layout-snapshot';
const hash=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
const plain=():MobiLayoutSnapshot=>({schema:'mobi-layout-untrusted-v3',kind:'mobi',sourceHash:'a'.repeat(64),title:'书',authors:[],cover:null,chapters:[{id:'0',title:'章',html:'<p>正文</p>',head:'',css:[],paragraphs:['正文']}],resources:[],toc:[],links:[]});
const png=()=>sharp({create:{width:2,height:2,channels:4,background:'#ab1234'}}).png().toBuffer();
it('MOBI真实入口保留图文样式与hash，仅发布引用过且真解码通过的图片',async()=>{
 const image=await png(),bytes=makeMobiFixture({resources:[image,Buffer.from('unused malicious payload')],text:'<html><head><style>p{color:red}</style></head><body><h1>标题</h1><p>图文😀</p><img recindex="1"></body></html>'});
 const value=await publishMobiFile(bytes);expect(value.schema).toBe('mobi-publication-v1');expect(value.sourceHash).toBe(hash(bytes));expect(value.chapters[0]).toMatchObject({id:'mobi-v1/mobi/0',htmlHash:hash(value.chapters[0].html)});
 expect(value.chapters[0].head).toContain('color:red');expect(value.resources).toHaveLength(1);expect(Buffer.from(value.resources[0].base64,'base64')).toEqual(image);
 expect(value.layoutHash).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(value)).not.toContain('unused malicious payload');
},20000);
it('KF8外置CSS可读，未验证字体明确降级不发布',async()=>{
 const image=await png(),bytes=makeKf8Fixture({fragment:'<p>图文正文😀</p>',css:'p{color:blue;background:url("kindle:embed:0001?mime=image/png")} @font-face{font-family:book;src:url("kindle:embed:0002?mime=font/ttf")}',resources:[image,Buffer.from([0,1,0,0,1,2,3,4])]});
 const value=await publishMobiFile(bytes);expect(value.chapters[0].head).toContain('stylesheet');expect(value.resources.map(r=>r.mediaType)).toEqual(expect.arrayContaining(['text/css','image/png']));expect(value.resources.some(r=>r.id.endsWith('.ttf'))).toBe(false);expect(value.warnings.join('')).toContain('系统字体');
 expect(value.resources.filter(r=>r.mediaType==='text/css').map(r=>Buffer.from(r.base64,'base64').toString()).join('')).not.toContain('0002.ttf');
},20000);
it('重复正文的来源点在最终发布后仍对应第二段',async()=>{
 let text='<html><body><script>evil()</script><p>重复😀</p><p>重复😀</p><a filepos="0000000000">跳转</a></body></html>';
 text=text.replace('0000000000',String(Buffer.byteLength(text.slice(0,text.lastIndexOf('重复')))).padStart(10,'0'));
 const value=await publishMobiFile(makeMobiFixture({text}));expect(value.navigation).toHaveLength(1);expect(value.navigation[0].point).toMatchObject({kind:'text',path:[1,0],textHash:hash('重复😀')});expect(value.chapters[0].html).toContain(value.navigation[0].href);expect(value.chapters[0].html).not.toContain('evil');
},20000);
it('截断或伪装图片不能通过布局发布',async()=>{
 const raw=plain();raw.chapters[0].html='<p>正文</p><img src="mobi-resource-v1/bad.png">';raw.resources=[{id:'mobi-resource-v1/bad.png',mediaType:'image/png',bytes:Buffer.from('not png')}];
 await expect(publishMobiLayout(await prepareMobiLayoutMarkup(raw))).rejects.toThrow('MOBI图片');
});
it('仅可达CSS/SVG重新净化；import保留条件，不把未引用原始文本资源公开',async()=>{
 const raw=plain();raw.chapters[0].head='<link rel="stylesheet" href="mobi-resource-v1/root.css">';
 raw.chapters[0].html+='<img src="mobi-resource-v1/figure.svg">';raw.resources=[
  {id:'mobi-resource-v1/root.css',mediaType:'text/css',bytes:Buffer.from('@import "child.css" screen;p{color:red}')},
  {id:'mobi-resource-v1/child.css',mediaType:'text/css',bytes:Buffer.from('p{color:blue}')},
  {id:'mobi-resource-v1/figure.svg',mediaType:'image/svg+xml',bytes:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>evil()</script><circle r="2"/></svg>')},
  {id:'mobi-resource-v1/unused.svg',mediaType:'image/svg+xml',bytes:Buffer.from('<script>raw()</script>')},
 ];
 const value=await publishMobiLayout(await prepareMobiLayoutMarkup(raw));expect(value.resources).toHaveLength(3);
 const css=Buffer.from(value.resources.find(r=>r.id.endsWith('root.css'))!.base64,'base64').toString();expect(css).toContain('@import');expect(css).toContain('screen');
 expect(value.resources.some(r=>Buffer.from(r.base64,'base64').toString().includes('script'))).toBe(false);
});

it('MOBI6旧font标签中的真实正文和来源点保留，事件/脚本仍移除',async()=>{
 const value=await publishMobiFile(makeMobiFixture({text:'<html><body><pre>前<span><font color="red" onclick="evil()">int 中文</font></span>后<script>bad()</script></pre></body></html>'}));
 expect(value.chapters[0].html).toContain('<font color="red">int 中文</font>');expect(value.chapters[0].html).not.toMatch(/onclick|evil|script|bad/u);
},20000);
