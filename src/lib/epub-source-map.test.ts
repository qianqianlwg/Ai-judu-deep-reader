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
it("原版可见选区跨段限1000字，不只是截断请求文本",()=>{
 document.body.innerHTML='<p>'+"甲".repeat(600)+'</p><p>'+"乙".repeat(600)+'</p>';
 const maps=mapEpubDocument(document,chapter(["甲".repeat(600),"乙".repeat(600)])),range=document.createRange();range.selectNodeContents(document.body);
 const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
 const snapshot=readLimitedEpubSelection(selection,maps);expect(snapshot?.text.length).toBe(1000);expect(snapshot?.fragments?.[1].endOffset).toBe(398);expect(selection.toString()).toBe("甲".repeat(600)+"乙".repeat(398));
 expect(selectionFromEpubRange(selection.getRangeAt(0),maps)).toEqual(snapshot);
 document.body.innerHTML='';
});
