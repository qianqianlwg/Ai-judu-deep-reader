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
