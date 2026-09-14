// @vitest-environment jsdom
import { expect, it } from "vitest";
import { readReadingSelection } from "./reader-selection";
it("分页片段、概念span和标记混排时使用真实UTF16偏移", () => {
 const host=document.createElement("div");host.innerHTML='<p data-paragraph-id="p" data-source-start="50">😀<span>自我意识</span><button data-reader-decoration>历史</button>与承认</p>';document.body.append(host);
 const span=host.querySelector("span")!; const range=document.createRange();range.selectNodeContents(span);const sel=window.getSelection()!;sel.removeAllRanges();sel.addRange(range);
 expect(readReadingSelection(sel,host)).toEqual({paragraphId:"p",startOffset:52,endOffset:56,text:"自我意识"});host.remove();
});
it("拒绝跨段落选区，避免对错误段落保存标注", () => {
 const host=document.createElement("div"); host.innerHTML='<p data-paragraph-id="a">甲</p><p data-paragraph-id="b">乙</p>';document.body.append(host);
 const range=document.createRange();range.setStart(host.firstChild!.firstChild!,0);range.setEnd(host.lastChild!.firstChild!,1);const sel=window.getSelection()!;sel.removeAllRanges();sel.addRange(range);
 expect(readReadingSelection(sel,host)).toBeNull(); host.remove();
});
