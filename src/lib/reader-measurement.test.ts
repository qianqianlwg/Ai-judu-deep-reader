// @vitest-environment jsdom
import { expect, it } from "vitest";
import { createReaderMeasurement, readerContentBox } from "./reader-measurement";
it("正文测量扣除自身内边距而不是浏览器高度估算", () => {
  const el = document.createElement("div"); el.style.padding = "20px 30px 10px"; document.body.append(el);
  Object.defineProperties(el, { clientHeight: { value: 500 }, clientWidth: { value: 700 } });
  expect(readerContentBox(el)).toEqual({ width: 640, height: 470 }); el.remove();
});
it("测量层仅包含同样的标题及正文且可释放", () => {
  const m = createReaderMeasurement(620, 1.2);
  m.measure([{ id:"p", text:"正文", chapterId:"c", chapterTitle:"章" }], "章");
  const el = document.querySelector(".reader-measure-sheet")!;
  expect(el.querySelector("h1")?.textContent).toBe("章"); expect(el.querySelector("p")?.textContent).toBe("正文");
  m.dispose(); expect(document.querySelector(".reader-measure-sheet")).toBeNull();
});


it("行内按钮占位参与分页测量，跨页终点不重复，原文保持逐字一致", () => {
  const text = "甲😀乙。后文继续。";
  const m = createReaderMeasurement(620, 1, {}, new Map([["p", [3, 5, 8]]]));
  try {
    m.measure([{ id: "p", text: text.slice(3, 8), sourceStartOffset: 3, sourceEndOffset: 8, chapterId: "c", chapterTitle: "章" }]);
    const p = document.querySelector(".reader-measure-sheet p")!;
    expect(p.textContent).toBe(text.slice(3, 8));
    expect(p.querySelectorAll(".judu-history-anchor[data-reader-decoration]")).toHaveLength(2);
    expect(p.querySelectorAll(".judu-history-anchor")[0].previousSibling?.textContent).toBe(text.slice(3, 5));
    m.measure([{ id: "p", text: text.slice(8), sourceStartOffset: 8, chapterId: "c", chapterTitle: "章" }]);
    expect(document.querySelector(".reader-measure-sheet p")?.textContent).toBe(text.slice(8));
    expect(document.querySelectorAll(".reader-measure-sheet .judu-history-anchor")).toHaveLength(0);
  } finally { m.dispose(); }
});

it('真实标题按自身层级测量，不重复生成章标题且保留标注占位与UTF16原文', () => {
  const text='标题😀原文';
  const m=createReaderMeasurement(620,1.15,{},new Map([['h',[4]]]));
  try {
    m.measure([{id:'h',text,kind:'heading',headingLevel:4,sourceOrdinal:0,chapterId:'c',chapterTitle:'章'}, {id:'p',text:'后段',chapterId:'c',chapterTitle:'章'}]);
    const root=document.querySelector('.reader-measure-sheet')!;
    expect(root.querySelector('.page-heading')).toBeNull();
    expect(root.querySelector('h4[data-block-kind="heading"]')?.textContent).toBe(text);
    expect(root.querySelector('h4 .judu-history-anchor[data-reader-decoration]')).not.toBeNull();
    expect(root.querySelector('p')?.textContent).toBe('后段');
  } finally {m.dispose();}
});
