// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { paintEpubAnnotations } from "./epub-annotations";
import { mapEpubDocument } from "./epub-source-map";
it("EPUB 高亮图层不拆分正文节点，清理时只删除自己的图层", () => {
 document.body.innerHTML='<p>认识世界</p>';
 const set=vi.fn(),del=vi.fn();
 vi.stubGlobal("CSS",{highlights:{set,delete:del}});
 vi.stubGlobal("Highlight",class { constructor(public range:Range){} });
 const node=document.querySelector('p')!.firstChild;
 const maps=mapEpubDocument(document,{id:'c',title:'章',paragraphs:[{id:'p',text:'认识世界'}]});
 const cleanup=paintEpubAnnotations(document,maps,[{id:'a',paragraphId:'p',startOffset:0,endOffset:2,textHash:'h',threadId:'t',summary:'s',concepts:[],createdAt:'now',kind:'highlight',markColor:'green'}],[{name:'世界',text:'定义'}]);
 expect(set.mock.calls.map(call=>call[0])).toEqual(['judu-green','judu-concept']);
 expect(document.querySelector('p')!.firstChild).toBe(node); expect(document.querySelector('p')!.innerHTML).toBe('认识世界');
 cleanup();expect(document.querySelector('[data-judu-decoration]')).toBeNull();vi.unstubAllGlobals();
});
describe("旧浏览器",()=>{ it("没有 Highlight API 时不崩溃或改写原文",()=> { const doc=new DOMParser().parseFromString('<p>原文</p>','text/html');expect(()=>paintEpubAnnotations(doc,[],[],[])()).not.toThrow(); }); });

it("XHTML 原版样式必须使用 HTML 命名空间",()=>{
 const doc=new DOMParser().parseFromString('<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><p>原文</p></body></html>','application/xhtml+xml');
 Object.defineProperty(doc,'defaultView',{value:window});vi.stubGlobal('CSS',{highlights:{set:vi.fn(),delete:vi.fn()}});vi.stubGlobal('Highlight',class {});
 const cleanup=paintEpubAnnotations(doc,[],[],[]);
 expect(doc.querySelector('[data-judu-decoration]')?.namespaceURI).toBe('http://www.w3.org/1999/xhtml');cleanup();vi.unstubAllGlobals();
});

it('句读下划线明确放在字形下方，并不改动正文文本节点',()=>{
 document.body.innerHTML='<p>需要句读的文字</p>';const node=document.querySelector('p')!.firstChild;
 vi.stubGlobal('CSS',{highlights:{set:vi.fn(),delete:vi.fn()}});vi.stubGlobal('Highlight',class {});
 const cleanup=paintEpubAnnotations(document,[],[],[]),style=document.querySelector('[data-judu-decoration]')?.textContent;
 expect(style).toContain('text-decoration:underline solid rgba(84,126,119,0.25)');expect(style).toContain('text-decoration-thickness:1px');expect(style).toContain('judu-concept){background:#fff0a388;}');expect(document.querySelector('p')!.firstChild).toBe(node);cleanup();vi.unstubAllGlobals();
});


it("句读线仅在开启时绘制，透明度可配置；概念只有黄色高亮", () => {
  const doc = new DOMParser().parseFromString('<p>原版正文</p>', 'text/html');
  Object.defineProperty(doc, 'defaultView', {value: window});
  vi.stubGlobal('CSS', {highlights: {set:vi.fn(), delete:vi.fn()}});
  vi.stubGlobal('Highlight', class {});
  const on = paintEpubAnnotations(doc, [], [], [], {enabled:true, opacity:.21});
  expect(doc.querySelector('[data-judu-decoration]')?.textContent).toContain('rgba(84,126,119,0.21)');
  expect(doc.querySelector('[data-judu-decoration]')?.textContent).toContain('judu-concept){background:#fff0a388;}');
  on();
  const off = paintEpubAnnotations(doc, [], [], [], {enabled:false, opacity:.21});
  expect(doc.querySelector('[data-judu-decoration]')?.textContent).not.toContain('text-decoration:underline');
  off(); vi.unstubAllGlobals();
});

it("当前页同词只标第一处，翻页重新计数且保留手动标亮", async () => {
 document.body.innerHTML='<p>理性理性经验</p><p>理性经验</p>';
 const maps=mapEpubDocument(document,{id:"c",title:"章",paragraphs:[{id:"p1",text:"理性理性经验"},{id:"p2",text:"理性经验"}]});
 const registry=new Map<string, Range[]>();
 vi.stubGlobal("CSS",{highlights:{set:(name:string,value:Range[])=>registry.set(name,value),delete:(name:string)=>registry.delete(name)}});
 vi.stubGlobal("Highlight",class extends Array<Range>{constructor(...ranges:Range[]){super(...ranges);}});
 let page=0;const changes=new EventTarget();
 vi.stubGlobal("Range",window.Range);const oldRects=Object.getOwnPropertyDescriptor(window.Range.prototype,"getClientRects");
 Object.defineProperty(window.Range.prototype,"getClientRects",{configurable:true,value:function(this:Range){const second=this.startContainer.parentElement===document.querySelectorAll("p")[1]; const left=(second?1:0)===page?10:200;return [{left,right:left+20,top:10,bottom:30,width:20,height:20}] as unknown as DOMRectList;}});
 const bounds=()=>({left:0,right:100,top:0,bottom:100,width:100,height:100});
 const clean=paintEpubAnnotations(document,maps,[],[{name:"理性",text:"定义"},{name:"经验",text:"定义"}],{enabled:true,opacity:.25},{bounds,changes});
 expect(registry.get("judu-concept")?.map(r=>r.toString())).toEqual(["理性","经验"]);
 expect(registry.get("judu-concept")?.[0].startContainer.parentElement).toBe(document.querySelectorAll("p")[0]);
 page=1;changes.dispatchEvent(new Event("relocate"));
 await new Promise(resolve=>window.requestAnimationFrame(resolve));
 expect(registry.get("judu-concept")?.[0].startContainer.parentElement).toBe(document.querySelectorAll("p")[1]);
 expect(registry.get("judu-concept")).toHaveLength(2);
 clean();if(oldRects)Object.defineProperty(window.Range.prototype,"getClientRects",oldRects);else Reflect.deleteProperty(window.Range.prototype,"getClientRects");vi.restoreAllMocks();vi.unstubAllGlobals();
});

it("概念只增加首处黄底，不挖掉首次和重复词的句读下横线",()=>{
 document.body.innerHTML='<p>理性与理性。</p>';
 const maps=mapEpubDocument(document,{id:"c",title:"章",paragraphs:[{id:"p",text:"理性与理性。"}]});
 const registry=new Map<string,Range[]>();
 vi.stubGlobal("CSS",{highlights:{set:(name:string,ranges:Range[])=>registry.set(name,ranges),delete:(name:string)=>registry.delete(name)}});
 vi.stubGlobal("Highlight",class extends Array<Range>{constructor(...ranges:Range[]){super(...ranges);}});
 const annotation={id:"a",paragraphId:"p",startOffset:0,endOffset:6,textHash:"h",threadId:"t",summary:"",concepts:[],createdAt:"now"};
 const cleanup=paintEpubAnnotations(document,maps,[annotation],[{name:"理性",text:"定义"}]);
 expect(registry.get("judu-analysis")?.map(range=>range.toString())).toEqual(["理性与理性。"]);
 expect(registry.get("judu-concept")?.map(range=>range.toString())).toEqual(["理性"]);
 expect(registry.get("judu-concept")?.[0].startOffset).toBe(0);
 expect(document.querySelector('[data-judu-decoration]')?.textContent).toContain('judu-concept){background:#fff0a388;}');
 cleanup();vi.unstubAllGlobals();
});
