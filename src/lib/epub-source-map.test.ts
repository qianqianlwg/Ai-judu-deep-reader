// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { rangeForEpubPosition, anchorFromEpubRange, mapEpubDocument, rangeForEpubAnchor, sameEpubResource, selectionFromEpubRange, readLimitedEpubSelection } from "./epub-source-map";
const chapter = (texts: string[]) => ({ id: "c", title: "章", paragraphs: texts.map((text, i) => ({ id: "p" + i, text })) });
function fixture(html: string) { return new DOMParser().parseFromString(html, "text/html"); }
describe("EPUB 原版与精读锚点映射", () => {
  it("保留内联样式、图片、MathML，用相同非空白字符映射 UTF-16", () => {
    const doc = fixture('<p>认识<em>世界</em> 😀<img src="x"/> 与 <math><mi>x</mi><mn>2</mn></math>。</p>');
    const text = "认识 世界 😀 与 x 2。";
    const maps = mapEpubDocument(doc, chapter([text]));
    expect(maps).toHaveLength(1);
    const start = text.indexOf("世界"); const end = text.indexOf(" 与");
    const range = rangeForEpubAnchor(maps,"p0",start,end)!;
    expect(selectionFromEpubRange(range,maps)).toEqual({paragraphId:"p0",startOffset:start,endOffset:end,text:text.slice(start,end)});
    expect(doc.querySelector("em")).not.toBeNull(); expect(doc.querySelector("math")).not.toBeNull();
  });
  it("重复段落按章内位置匹配，不用摘录首次命中定位", () => {
    const doc = fixture("<p>同一原文</p><p>同一原文</p>");
    const maps = mapEpubDocument(doc,chapter(["同一原文","同一原文"]));
    const range = doc.createRange(); range.selectNodeContents(doc.querySelectorAll("p")[1]);
    expect(selectionFromEpubRange(range,maps)?.paragraphId).toBe("p1");
  });
  it("拒绝跨段、未匹配和超出正文选区，不猜偏移", () => {
    const doc=fixture("<p>第一段</p><p>第二段</p><aside>脚注</aside>");
    const maps=mapEpubDocument(doc,chapter(["第一段","第二段"]));
    const range=doc.createRange(); range.selectNodeContents(doc.body);
    expect(selectionFromEpubRange(range,maps)).toBeNull();
    expect(rangeForEpubAnchor(maps,"missing",0,1)).toBeNull();
    expect(mapEpubDocument(doc,chapter(["错别字"]))).toHaveLength(0);
  });
  it("嵌套块只对齐外部抽取单元，并区分资源完整路径", () => {
    const doc=fixture("<blockquote><p>第一部分</p><p>第二部分</p></blockquote>");
    expect(mapEpubDocument(doc,chapter(["第一部分 第二部分"]))).toHaveLength(1);
    expect(sameEpubResource("OEBPS/a.xhtml#note","OEBPS/a.xhtml")).toBe(true);
    expect(sameEpubResource("a/a.xhtml","b/a.xhtml")).toBe(false);
  });
});

it("分页范围起点映射为段中 UTF-16 偏移，不退回段首", () => {
 const doc=fixture('<p>一段😀长文字</p>'), maps=mapEpubDocument(doc,chapter(['一段😀长文字']));
 const range=rangeForEpubAnchor(maps,'p0',4,7)!;
 expect(anchorFromEpubRange(range,maps)).toEqual({paragraphId:'p0',offset:4});
});

it("只将正文块对齐 canonical 段落，不误命中相同标题",()=>{
 const doc=fixture('<h2>同样文字</h2><p>同样文字</p>'),maps=mapEpubDocument(doc,chapter(['同样文字']));
 expect(maps[0].element.tagName).toBe('P');
});

it("净化移除重复段落后不把后面的同文标成前一个",()=>{
 const doc=fixture('<p>重复文本</p><p>独立文本</p>'),maps=mapEpubDocument(doc,chapter(['重复文本','重复文本','独立文本']));
 expect(maps.map(map=>map.paragraph.id)).toEqual(['p2']);
});

it("纯文本补入的空格/段尾锚点仍在同段精确定位",()=>{
 const doc=fixture('<p>一<em>二</em>三</p>'),maps=mapEpubDocument(doc,chapter(['一 二 三']));
 expect(rangeForEpubPosition(maps,'p0',1)?.toString()).toBe('二');
 expect(rangeForEpubPosition(maps,'p0',5)?.toString()).toBe('三');
 expect(rangeForEpubPosition(maps,'p0',6)).toBeNull();
});

it("双栏跨段包含脚注标号时按正文顺序保留全部来源",()=>{
 const doc=fixture('<div style="columns:2"><p>这是<em>第一段正文</em><sup>⑴</sup></p><p>第二段正文继续</p><p>最后一段正文</p></div>');
 const maps=mapEpubDocument(doc,chapter(['这是第一段正文⑴','第二段正文继续','最后一段正文']));
 const range=doc.createRange();range.setStart(doc.querySelector('p')!.firstChild!,1);range.setEnd(doc.querySelectorAll('p')[2].firstChild!,3);
 expect(selectionFromEpubRange(range,maps)).toMatchObject({version:2,text:'是第一段正文⑴\n\n第二段正文继续\n\n最后一',fragments:[{paragraphId:'p0',startOffset:1,endOffset:8},{paragraphId:'p1',startOffset:0,endOffset:7},{paragraphId:'p2',startOffset:0,endOffset:3}]});
});
it("原版可见选区跨段限3000字，不只是截断请求文本",()=>{
 document.body.innerHTML='<p>'+"甲".repeat(1800)+'</p><p>'+"乙".repeat(1800)+'</p>';
 const maps=mapEpubDocument(document,chapter(["甲".repeat(1800),"乙".repeat(1800)])),range=document.createRange();range.selectNodeContents(document.body);
 const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
 const snapshot=readLimitedEpubSelection(selection,maps);expect(snapshot?.text.length).toBe(3000);expect(snapshot?.fragments?.[1].endOffset).toBe(1198);expect(selection.toString()).toBe("甲".repeat(1800)+"乙".repeat(1198));
 expect(selectionFromEpubRange(selection.getRangeAt(0),maps)).toEqual(snapshot);
 document.body.innerHTML='';
});

it("旧正文索引缺少标题时不再裁掉标题，保留完整范围交给仅分析",()=>{
 document.body.innerHTML='<h1>第一章 <em>地方政府</em></h1><p>第一段正文</p><p>第二段正文</p>';
 const maps=mapEpubDocument(document,chapter(['第一段正文','第二段正文'])),range=document.createRange();range.selectNodeContents(document.body);
 const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
 expect(readLimitedEpubSelection(selection,maps)).toBeNull();expect(selection.toString()).toBe('第一章 地方政府第一段正文第二段正文');
});
it("倒向含未定位标题的范围不被按正文暗中截短",()=>{
 document.body.innerHTML='<h1>标题</h1><p>'+'甲'.repeat(3100)+'</p>';
 const maps=mapEpubDocument(document,chapter(['甲'.repeat(3100)])),heading=document.querySelector('h1')!.firstChild!,body=document.querySelector('p')!.firstChild!;
 const selection=window.getSelection()!;selection.removeAllRanges();selection.setBaseAndExtent(body,3100,heading,0);let limited=false;
 expect(readLimitedEpubSelection(selection,maps,()=>{limited=true})).toBeNull();expect(limited).toBe(false);expect(selection.toString()).toBe('标题'+'甲'.repeat(3100));expect(selection.anchorNode).toBe(body);
});

it("未映射内容不属于开头标题时仍拒绝，不触发自动剔除",()=>{
 for(const html of ['<aside>脚注</aside><h1>标题</h1><p>正文</p>','<h1>标题</h1><aside>脚注</aside><p>正文</p>','<h1>标题</h1><p>正文</p><aside>脚注</aside>']){
  const doc=document;doc.body.innerHTML=html;const maps=mapEpubDocument(doc,chapter(['正文'])),range=doc.createRange();range.selectNodeContents(doc.body);
  const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
  expect(readLimitedEpubSelection(selection,maps)).toBeNull();
 }
});
it("stale text-node offsets are rebuilt after layout splits a node", () => {
 const text = "x".repeat(220), doc = fixture(`<p>${text}</p>`), maps = mapEpubDocument(doc, chapter([text]));
 const paragraph = doc.querySelector("p")!;
 (paragraph.firstChild as Text).splitText(39);
 const range = rangeForEpubAnchor(maps, "p0", 177, 178);
 expect(range?.toString()).toBe("x");
 expect(maps[0].points[177].node).toBe(paragraph.childNodes[1]);
 expect(maps[0].points[177].offset).toBe(138);
 expect(anchorFromEpubRange(range!, maps)).toEqual({ paragraphId: "p0", offset: 177 });
});

it("selection extraction refreshes stale character points after a text-node split", () => {
 const text = "y".repeat(100), doc = fixture(`<p>${text}</p>`), maps = mapEpubDocument(doc, chapter([text]));
 const paragraph = doc.querySelector("p")!;
 (paragraph.firstChild as Text).splitText(25);
 const range = doc.createRange(); range.selectNodeContents(paragraph);
 expect(selectionFromEpubRange(range, maps)?.text).toBe(text);
});

it("refuses to build a range if the live paragraph no longer matches its source", () => {
 const text = "x".repeat(220), doc = fixture(`<p>${text}</p>`), maps = mapEpubDocument(doc, chapter([text]));
 doc.querySelector("p")!.textContent = "short text";
 expect(rangeForEpubAnchor(maps, "p0", 177, 178)).toBeNull();
});

it('标题+正文+中间小标题的多块选文保留完整来源和UTF16位置',()=>{
 const doc=fixture('<h1>复杂信息</h1><p>正文😀。</p><h2>信息与权力</h2><p>后段文字。</p>');
 const source={id:'c',title:'复杂信息',paragraphs:[{id:'h',text:'复杂信息',kind:'heading' as const,headingLevel:1 as const,sourceOrdinal:0},{id:'p',text:'正文😀。',kind:'paragraph' as const,sourceOrdinal:1},{id:'sub',text:'信息与权力',kind:'heading' as const,headingLevel:2 as const,sourceOrdinal:2},{id:'last',text:'后段文字。',kind:'paragraph' as const,sourceOrdinal:3}]};
 const maps=mapEpubDocument(doc,source);expect(maps).toHaveLength(4);
 const range=doc.createRange();range.setStart(doc.querySelector('h1')!.firstChild!,0);range.setEnd(doc.querySelectorAll('p')[1].firstChild!,2);
 expect(selectionFromEpubRange(range,maps)).toMatchObject({text:'复杂信息\n\n正文😀。\n\n信息与权力\n\n后段',fragments:[{paragraphId:'h',startOffset:0,endOffset:4},{paragraphId:'p',startOffset:0,endOffset:5},{paragraphId:'sub',startOffset:0,endOffset:5},{paragraphId:'last',startOffset:0,endOffset:2}]});
 expect(rangeForEpubAnchor(maps,'sub',0,5)?.toString()).toBe('信息与权力');
});
it('同名标题用原书次序核对，净化移除标题后不将后一个冒充前一个',()=>{
 const source={id:'c',title:'同名',paragraphs:[{id:'h1',text:'同名',kind:'heading' as const,headingLevel:2 as const,sourceOrdinal:0},{id:'h2',text:'同名',kind:'heading' as const,headingLevel:2 as const,sourceOrdinal:1}]};
 expect(mapEpubDocument(fixture('<h2>同名</h2><h2>同名</h2>'),source).map(m=>m.paragraph.id)).toEqual(['h1','h2']);
 expect(mapEpubDocument(fixture('<h2>同名</h2>'),source)).toHaveLength(0);
});

it('有标题来源的新版本若标题层级不匹配，不能自动裁剪标题改成正文成功', () => {
  document.body.innerHTML='<h1>同文标题</h1><p>正文</p>';
  const maps=mapEpubDocument(document,{id:'c',title:'章',paragraphs:[{id:'h',text:'同文标题',kind:'heading',headingLevel:2,sourceOrdinal:0},{id:'p',text:'正文',kind:'paragraph',sourceOrdinal:1}]});
  expect(maps.map(m=>m.paragraph.id)).toEqual(['p']);
  const selection=window.getSelection()!,range=document.createRange();range.selectNodeContents(document.body);
  selection.removeAllRanges();selection.addRange(range);
  expect(readLimitedEpubSelection(selection,maps)).toBeNull();
  expect(selection.toString()).toBe('同文标题正文');
  selection.removeAllRanges();
});

it('原版标准标题、div小标题和正文完整跨选，不能漏掉非标准小标题',()=>{
 const doc=document;doc.body.innerHTML='<h2>第二部 先验逻辑</h2><h3>导言 先验逻辑之理念</h3><div class="ht4fc">一 泛论逻辑</div><p>吾人之知识，发自心之二种根本源流。</p>';
 const paragraphs=[{id:'h1',text:'第二部 先验逻辑',kind:'heading' as const,headingLevel:2 as const,sourceOrdinal:0},{id:'h2',text:'导言 先验逻辑之理念',kind:'heading' as const,headingLevel:3 as const,sourceOrdinal:1},{id:'d',text:'一 泛论逻辑',kind:'paragraph' as const,sourceOrdinal:2},{id:'p',text:'吾人之知识，发自心之二种根本源流。',kind:'paragraph' as const,sourceOrdinal:3}];
 const maps=mapEpubDocument(doc,{id:'c',title:'第二部 先验逻辑',paragraphs});
 expect(maps.map(m=>m.paragraph.id)).toEqual(['h1','h2','d','p']);
 const range=doc.createRange();range.selectNodeContents(doc.body);
 const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
 expect(readLimitedEpubSelection(selection,maps)).toMatchObject({text:paragraphs.map(p=>p.text).join('\n\n'),fragments:paragraphs.map(p=>({paragraphId:p.id,text:p.text,startOffset:0,endOffset:p.text.length}))});
 selection.removeAllRanges();
});
