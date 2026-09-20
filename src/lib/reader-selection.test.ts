// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  extendReadingSelectionToNextPage, extendReadingSelectionToPreviousPage, mergeReadingSelectionFragments,
  readReadingSelection, capReadingSelection, selectionFromParts, selectionAnchors, selectionMatchesParagraphs, mergeContinuousSelections, selectionFragmentFromPagePart, type ReadingSelectionFragment,
} from "./reader-selection";

const fragment = (startOffset: number, endOffset: number, text: string, pageIndex?: number): ReadingSelectionFragment => ({ paragraphId: "p", startOffset, endOffset, text, pageIndex });

it("分页片段、概念span和标记混排时使用真实UTF16偏移", () => {
  const host = document.createElement("div"); host.innerHTML = '<p data-paragraph-id="p" data-source-start="50">😀<span>自我意识</span><button data-reader-decoration>历史</button>与承认</p>'; document.body.append(host);
  const span = host.querySelector("span")!; const range = document.createRange(); range.selectNodeContents(span); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  expect(readReadingSelection(selection, host)).toEqual({ paragraphId: "p", startOffset: 52, endOffset: 56, text: "自我意识" }); host.remove();
});
it("跨段落选区保留各段独立锚点而不是拒绝", () => {
  const host = document.createElement("div"); host.innerHTML = '<p data-paragraph-id="a">甲</p><p data-paragraph-id="b">乙</p>'; document.body.append(host);
  const range = document.createRange(); range.setStart(host.firstChild!.firstChild!, 0); range.setEnd(host.lastChild!.firstChild!, 1); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  expect(readReadingSelection(selection, host)).toMatchObject({version:2,text:"甲\n\n乙",fragments:[{paragraphId:"a",startOffset:0,endOffset:1,text:"甲"},{paragraphId:"b",startOffset:0,endOffset:1,text:"乙"}]}); host.remove();
});
it("合并同段落跨页片段时保持UTF16锚点和顺序，不修改输入", () => {
  const first = fragment(0, 3, "A😀", 0); const second = fragment(3, 7, "BC😀", 1); const input = [first, second] as const;
  const result = mergeReadingSelectionFragments(input);
  expect(result).toEqual({ ok: true, selection: { paragraphId: "p", startOffset: 0, endOffset: 7, text: "A😀BC😀" }, fragments: input });
  expect(input).toEqual([first, second]);
});
it("按锚点排序后合并反向提供的连续分页片段", () => {
  expect(mergeReadingSelectionFragments([fragment(3, 7, "BC😀", 1), fragment(0, 3, "A😀", 0)])).toMatchObject({ ok: true, selection: { startOffset: 0, endOffset: 7, text: "A😀BC😀" } });
});
it("拒绝间隙、重叠、跨段落和伪造的UTF16长度", () => {
  expect(mergeReadingSelectionFragments([fragment(0, 1, "甲"), fragment(2, 3, "乙")])).toMatchObject({ ok: false, reason: "non-contiguous" });
  expect(mergeReadingSelectionFragments([fragment(0, 2, "甲乙"), fragment(1, 3, "乙丙")])).toMatchObject({ ok: false, reason: "overlap" });
  expect(mergeReadingSelectionFragments([fragment(0, 1, "甲"), { ...fragment(1, 2, "乙"), paragraphId: "other" }])).toMatchObject({ ok: false, reason: "different-paragraph" });
  expect(mergeReadingSelectionFragments([fragment(0, 1, "😀")])).toMatchObject({ ok: false, reason: "text-offset-mismatch" });
});
it("扩展到下一页只接受下一片段紧接当前末端", () => {
  const current = { paragraphId: "p", startOffset: 4, endOffset: 7, text: "甲😀" };
  const result = extendReadingSelectionToNextPage(current, fragment(7, 10, "乙丙丁", 2));
  expect(result).toMatchObject({ ok: true, direction: "next", added: { pageIndex: 2 }, selection: { startOffset: 4, endOffset: 10, text: "甲😀乙丙丁" } });
  expect(extendReadingSelectionToNextPage(current, fragment(8, 10, "乙丙", 2))).toMatchObject({ ok: false, reason: "non-contiguous", direction: "next" });
});
it("扩展到上一页按原文锚点重新排序，并返回明确方向", () => {
  const current = { paragraphId: "p", startOffset: 7, endOffset: 10, text: "乙丙丁" };
  const result = extendReadingSelectionToPreviousPage(current, fragment(4, 7, "甲😀", 1));
  expect(result).toMatchObject({ ok: true, direction: "previous", added: { pageIndex: 1 }, selection: { startOffset: 4, endOffset: 10, text: "甲😀乙丙丁" } });
});
it("分页片段转换只映射稳定原文锚点，不把页码当作语义位置", () => {
  expect(selectionFragmentFromPagePart({ paragraphId: "p", text: "😀", sourceStartOffset: 2, sourceEndOffset: 4, pageIndex: 3, pageNumber: 4 })).toEqual({ paragraphId: "p", text: "😀", startOffset: 2, endOffset: 4, pageIndex: 3, pageNumber: 4 });
});

it("跨段总字数包含分隔符，最多1000，不拆开emoji",()=>{
 const selection=selectionFromParts([{paragraphId:"a",startOffset:0,endOffset:600,text:"甲".repeat(600)},{paragraphId:"b",startOffset:0,endOffset:1200,text:"😀".repeat(600)}]);
 const capped=capReadingSelection(selection); expect(Array.from(capped.text).length).toBe(1000);expect(capped.fragments?.[1].endOffset).toBe(796);
 expect(selectionMatchesParagraphs(capped,[{id:"a",text:"甲".repeat(600)},{id:"b",text:"😀".repeat(600)}])).toBe(true);
 expect(selectionAnchors(capped)[1].selectedText).toBe("😀".repeat(398));
 const reverse=capReadingSelection(selection,true); expect(Array.from(reverse.text).length).toBe(1000);expect(reverse.fragments?.[0].startOffset).toBe(202);
});
it.each([999,1000,1001])("可见DOM选区与快照一致：%s字",length=>{
 const host=document.createElement("div");host.innerHTML='<p data-paragraph-id="limit">'+"字".repeat(length)+'</p>';document.body.append(host);
 const range=document.createRange();range.selectNodeContents(host.firstChild!);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
 let limited=false;const snapshot=readReadingSelection(selection,host,()=>{limited=true;});
 expect(snapshot?.text.length).toBe(Math.min(length,1000));expect(selection.toString().length).toBe(Math.min(length,1000));expect(limited).toBe(length>1000);host.remove();
});
it("反向拖选从原起点限制1000字，保留非BMP完整字符",()=>{
 const host=document.createElement("div"),text="前".repeat(10)+"😀".repeat(1000);host.innerHTML='<p data-paragraph-id="r">'+text+'</p>';document.body.append(host);
 const node=host.firstChild!.firstChild!,selection=window.getSelection()!;selection.setBaseAndExtent(node,text.length,node,0);
 const snapshot=readReadingSelection(selection,host);expect(snapshot?.startOffset).toBe(10);expect(snapshot?.text).toBe("😀".repeat(1000));expect(selection.anchorOffset).toBe(text.length);expect(selection.focusOffset).toBe(10);host.remove();
});
it("跨页连续选文可合并，超限、断段和重叠拒绝",()=>{
 const p=[{id:"a",text:"一二三"},{id:"b",text:"四五六"}];
 const a={paragraphId:"a",startOffset:1,endOffset:3,text:"二三"},b={paragraphId:"b",startOffset:0,endOffset:2,text:"四五"};
 expect(mergeContinuousSelections(a,b,p)?.text).toBe("二三\n\n四五");expect(mergeContinuousSelections(a,a,p)).toBeNull();
 expect(mergeContinuousSelections({...a,text:"字".repeat(600),startOffset:0,endOffset:600},{...b,text:"字".repeat(600),endOffset:600},[{id:"a",text:"字".repeat(600)},{id:"b",text:"字".repeat(600)}])).toBeNull();
});
