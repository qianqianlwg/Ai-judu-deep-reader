import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import type { MobiLayoutSnapshot, MobiLayoutTarget } from "./mobi-layout-snapshot";
import { parseMobiLayout } from "./mobi-layout";
import { makeMobiFixture } from "./mobi-fixture";
import { makeKf8Fixture } from "./kf8-fixture";
import { inspectMobiContainer } from "./mobi-format";
import * as worker from "./mobi-worker-client";
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=', 'base64');
beforeEach(()=>vi.restoreAllMocks());
it('MOBI6保存正文图片、首资源封面和head样式，绝对临时路径不离开worker',async()=>{
 const bytes=makeMobiFixture({resources:[png],coverIndex:0,text:'<html><head><style>p{color:red}</style></head><body><h1>章</h1><p>图文😀</p><img recindex="1"/><img src="https://invalid.example/external.png"/></body></html>'});
 const result=await parseMobiLayout(bytes);expect(result.kind).toBe('mobi');expect(result.sourceHash).toBe(createHash('sha256').update(bytes).digest('hex'));
 expect(result.cover).toBe('mobi-resource-v1/cover.png');expect(result.resources.map(r=>r.id)).toEqual(['mobi-resource-v1/1.png','mobi-resource-v1/cover.png']);expect(result.resources.every(r=>Buffer.from(r.bytes).equals(png))).toBe(true);
 expect(result.chapters[0].html).toContain('src="mobi-resource-v1/1.png"');expect(result.chapters[0].head).toContain('p{color:red}');expect(result.chapters[0].paragraphs).toEqual(['图文😀']);expect(JSON.stringify(result)).not.toContain('judu-mobi-layout-');
 expect(result.chapters[0].html).toContain('https://invalid.example/external.png');
});
it('纯KF8的CSS流、CSS内图片及字体资源全部捕获，不直接执行未净化CSS',async()=>{
 const font=Buffer.from([0,1,0,0,1,2,3,4]);const bytes=makeKf8Fixture({css:'p{background:url("kindle:embed:0001?mime=image/png")} @font-face{font-family:book;src:url("kindle:embed:0002?mime=font/ttf")}',resources:[png,font],fragment:'<section id="chapter"><p>中文😀</p><img src="kindle:embed:0001?mime=image/png"/></section>'});
 expect(inspectMobiContainer(bytes)).toMatchObject({kind:'kf8',version:8,isDual:false});const result=await parseMobiLayout(bytes);
 expect(result.chapters[0].css).toEqual(['mobi-resource-v1/0001.css']);expect(result.chapters[0].html).toContain('mobi-resource-v1/0001.png');expect(result.chapters[0].head).toContain('mobi-resource-v1/0001.css');
 const css=new TextDecoder().decode(result.resources.find(r=>r.id.endsWith('.css'))!.bytes);expect(css).toContain('mobi-resource-v1/0001.png');expect(css).toContain('mobi-resource-v1/0002.ttf');expect(css).not.toContain('judu-mobi-layout-');expect(Buffer.from(result.resources.find(r=>r.id.endsWith('.ttf'))!.bytes)).toEqual(font);
});
it('布局中图片章不因没有精读段落丢失',async()=>{const bytes=makeMobiFixture({resources:[png],text:'<html><body><img recindex="1"/><mbp:pagebreak/><p>有文字的第二章</p></body></html>'});const result=await parseMobiLayout(bytes);expect(result.chapters).toHaveLength(2);expect(result.chapters[0].paragraphs).toEqual([]);expect(result.chapters[0].html).toContain('mobi-resource-v1/1.png');});
it('原件输入快照、DRM门禁与错误不降级',async()=>{
 const bytes=makeMobiFixture();const pending=parseMobiLayout(bytes);const expected=createHash('sha256').update(bytes).digest('hex');bytes.fill(0);expect((await pending).sourceHash).toBe(expected);
 const encrypted=makeMobiFixture();encrypted.writeUInt16BE(2,encrypted.readUInt32BE(78)+12);const spy=vi.spyOn(worker,'runMobiLayoutWorker');await expect(parseMobiLayout(encrypted)).rejects.toThrow(/加密|DRM/u);expect(spy).not.toHaveBeenCalled();
});
it('MOBI不存在的filepos锚点明确unresolved，不以命中章节伪称精确跳转',async()=>{const result=await parseMobiLayout(makeMobiFixture({text:'<html><body><p>原文</p><a filepos="20">注释</a><a href="https://invalid.example/">外链</a></body></html>'}));expect(result.links).toEqual([{chapterId:'0',href:'filepos:20',target:null,reason:'unresolved'},{chapterId:'0',href:'https://invalid.example/',target:null,reason:'external'}]);});
it('解析进程返回另一原件身份时不能接受',async()=>{const input=makeMobiFixture();const correct=await parseMobiLayout(input);const spy=vi.spyOn(worker,'runMobiLayoutWorker').mockResolvedValueOnce({...correct,sourceHash:'0'.repeat(64)});try{await expect(parseMobiLayout(input)).rejects.toThrow('来源身份');}finally{spy.mockRestore();}});
it('相同资源ID的不同声明MIME不能覆盖已生成字节',async()=>{const bytes=makeKf8Fixture({css:'p{background:url("kindle:embed:0001?mime=image/jpg")}',resources:[png],fragment:'<p>图</p><img src="kindle:embed:0001?mime=image/jpeg"/>'});await expect(parseMobiLayout(bytes)).rejects.toThrow(/EEXIST|exist/iu);});
it('KF8正文中的kindle URI是字面文本，不能当图片资源改写或变成临时路径',async()=>{const uri='kindle:embed:0001?mime=image/png';const result=await parseMobiLayout(makeKf8Fixture({resources:[png],fragment:`<h1>${uri}</h1><p>${uri}</p>`}));expect(result.resources).toEqual([]);expect(result.chapters[0].title).toBe(uri);expect(result.chapters[0].paragraphs).toEqual([uri]);expect(result.chapters[0].html).toContain(`<p>${uri}</p>`);expect(JSON.stringify(result)).not.toContain('judu-mobi-layout-');});
it('真实资源冲突错误只返回稳定错误码，不透传私有磁盘路径',async()=>{const bytes=makeKf8Fixture({css:'p{color:red}',resources:[Buffer.from('p{color:blue}')],fragment:'<p>文</p><a href="kindle:embed:0001?mime=text/css">css</a>'});await expect(parseMobiLayout(bytes)).rejects.toThrow('MOBI资源IO失败（EEXIST）');});
it('KF8 CSS字符串import捕获被导入样式而非当普通content忽略',async()=>{
 const result=await parseMobiLayout(makeKf8Fixture({css:'@import "kindle:embed:0002?mime=text/css";p{background:url("kindle:embed:0001?mime=image/png")}',resources:[png,Buffer.from('p{color:red}')],fragment:'<p>正文</p>'}));
 expect(result.resources.map(r=>r.id)).toEqual(['mobi-resource-v1/0001.css','mobi-resource-v1/0001.png','mobi-resource-v1/0002.css']);expect(new TextDecoder().decode(result.resources[0].bytes)).toContain('url(mobi-resource-v1/0002.css)');
});
function textAtTarget(snapshot:MobiLayoutSnapshot,target:MobiLayoutTarget|null):string{
 expect(target).not.toBeNull();if(!target)throw new Error('未解析来源');
 const html=snapshot.chapters.find(chapter=>chapter.id===target.chapterId)?.html;
 expect(html).toBeDefined();const dom=new JSDOM("<!doctype html><body></body>");dom.window.document.body.innerHTML=html??"";
 try{
  let node:Node=dom.window.document.body;
  for(const index of target.point.path){const child:ChildNode|undefined=node.childNodes[index];expect(child).toBeDefined();if(!child)throw new Error('DOM来源路径不存在');node=child;}
  if(target.point.kind==='element'){expect(node.nodeType).toBe(1);expect((node as Element).localName).toBe(target.point.tag);return node.textContent??'';}
  expect(node.nodeType).toBe(3);const text=node.textContent??'';expect(text.length).toBe(target.point.textLength);expect(createHash('sha256').update(text).digest('hex')).toBe(target.point.textHash);return text.slice(target.point.offset);
 }finally{dom.window.close();}
}
it.each([1,2] as const)('MOBI压缩%s跨pagebreak重复正文无ID，原始字节准确到第二段并经DOM复核',async compression=>{
 const prefix='<HTML><HEAD><title>头😀</title></HEAD><BODY class="原书">',separator='<MBP:PAGEBREAK class="页"/>',second='<p data-x="重复">前😀 &amp; 相同</p><p data-x="重复">前😀 &amp; 相同</p>';
 let html=prefix+'<p>首章</p>'+['重复正文','元素','间隙','半实体','半字节','属性'].map((name,i)=>`<a filepos="${String(i).padStart(10,'0')}">${name}</a>`).join('')+separator+second+'</BODY></HTML>';
 const offsets=[html.lastIndexOf('相同'),html.lastIndexOf('<p '),html.indexOf(separator)+2,html.lastIndexOf('&amp;')+2,html.lastIndexOf('😀'),html.lastIndexOf('data-x')];
 offsets.forEach((offset,i)=>{const byte=Buffer.byteLength(html.slice(0,offset))+(i===4?1:0);html=html.replace(`filepos="${String(i).padStart(10,'0')}"`,`filepos="${String(byte).padStart(10,'0')}"`);});
 const snapshot=await parseMobiLayout(makeMobiFixture({compression,text:html}));expect(snapshot.chapters).toHaveLength(2);expect(snapshot.links).toHaveLength(6);
 expect(snapshot.links[0]).toMatchObject({reason:'exact-source',target:{chapterId:'1',htmlOffset:second.lastIndexOf('相同'),point:{kind:'text',path:[1,0],offset:6}}});
 expect(textAtTarget(snapshot,snapshot.links[0].target)).toBe('相同');expect(textAtTarget(snapshot,snapshot.links[1].target)).toBe('前😀 & 相同');
 expect(snapshot.links.slice(2).map(link=>({reason:link.reason,target:link.target}))).toEqual(Array.from({length:4},()=>({reason:'unresolved',target:null})));
});
it('KF8真实worker按照fid/off字节落到实体解码后的正文，拒绝半字符与半实体',async()=>{
 const text='<p>前😀 &amp; 相同</p><p>前😀 &amp; 相同</p>';
 let fragment=text+['元素','重复正文','半实体','半字节','越界'].map((name,i)=>`<a href="kindle:pos:fid:0000:off:${String(i).padStart(8,'0')}">${name}</a>`).join('');
 const offsets=[0,Buffer.byteLength(text.slice(0,text.lastIndexOf('相同'))),Buffer.byteLength(text.slice(0,text.lastIndexOf('&amp;')+2)),Buffer.byteLength(text.slice(0,text.lastIndexOf('😀')))+1,Buffer.byteLength(fragment)+1];
 offsets.forEach((offset,i)=>{fragment=fragment.replace(`off:${String(i).padStart(8,'0')}`,`off:${offset.toString(32).padStart(8,'0')}`);});
 const snapshot=await parseMobiLayout(makeKf8Fixture({fragment}));expect(snapshot.links).toHaveLength(5);
 expect(snapshot.links[0].reason).toBe('exact-source');expect(textAtTarget(snapshot,snapshot.links[0].target)).toBe('前😀 & 相同');
 expect(snapshot.links[1]).toMatchObject({reason:'exact-source',target:{point:{kind:'text',path:[1,0],offset:6}}});expect(textAtTarget(snapshot,snapshot.links[1].target)).toBe('相同');
 expect(snapshot.links.slice(2).every(link=>link.reason==='unresolved'&&link.target===null)).toBe(true);
});
it('完整KF8的首尾空白在body上下文保留，fid0落在真实首文本而不是错位标题',async()=>{
 const fragment='\n  <h1>首章</h1>\n<p id="second">正文😀</p>\n<a href="kindle:pos:fid:0000:off:0000">开头</a>\n';
 const snapshot=await parseMobiLayout(makeKf8Fixture({fragment}));const target=snapshot.links[0].target;expect(target?.point).toMatchObject({kind:'text',path:[0],offset:0,textLength:3});expect(textAtTarget(snapshot,target)).toBe('\n  ');
});
it('MOBI正文投影按实际语法处理引号内大于号、head脚本和注释伪body',async()=>{
 let html='<html><head><script>const fake="<body>伪</body>"</script></head><body data-x=">">\n<!-- </body> --><p id="real">真实😀</p><a filepos="0000000000">跳</a>\n</body></html>\n';
 const byte=Buffer.byteLength(html.slice(0,html.indexOf('真实')));html=html.replace('filepos="0000000000"',`filepos="${String(byte).padStart(10,'0')}"`);
 const snapshot=await parseMobiLayout(makeMobiFixture({text:html}));expect(snapshot.chapters[0].html.startsWith('\n<!-- </body> -->')).toBe(true);expect(textAtTarget(snapshot,snapshot.links[0].target)).toBe('真实😀');
});
