import { describe, expect, it } from "vitest";
import { anchorsMatchParagraphs, joinAnchorText, makeReadingAnchor, readReadingAnchor, readAnchorParts } from "./reading-anchors";
const paragraphs = [{id:"a",text:"第一段正文"},{id:"b",text:"第二段正文"},{id:"c",text:"第三段正文"}];
const parts = [{paragraphId:"a",startOffset:2,endOffset:5,selectedText:"段正文"},{paragraphId:"b",startOffset:0,endOffset:3,selectedText:"第二段"}];
describe("多段来源契约", () => {
  it("保存全部片段并兼容旧单段", () => { expect(readReadingAnchor(makeReadingAnchor(parts))?.fragments).toEqual(parts); expect(readReadingAnchor(parts[0])).toEqual(parts[0]); expect(joinAnchorText(parts)).toBe("段正文\n\n第二段"); });
  it("逐段核验全文、顺序及两端", () => { expect(anchorsMatchParagraphs(parts, paragraphs)).toBe(true); expect(anchorsMatchParagraphs([...parts].reverse(), paragraphs)).toBe(false); expect(anchorsMatchParagraphs([parts[0],{...parts[1],paragraphId:"c",selectedText:"第三段"}], paragraphs)).toBe(false); expect(anchorsMatchParagraphs(parts, paragraphs,"段正文")).toBe(false); });
  it("拒绝伪装单段、损坏数组及超大数组", () => { expect(readReadingAnchor({...parts[0],version:2,fragments:[parts[1]]})).toBeNull(); expect(readAnchorParts([])).toBeNull(); expect(readAnchorParts(Array(257).fill(parts[0]))).toBeNull(); });
  it("不拆开 UTF-16 代理对", () => { expect(anchorsMatchParagraphs([{paragraphId:"e",startOffset:1,endOffset:2,selectedText:"\ud83d"}],[{id:"e",text:"字😀文"}])).toBe(false); });
});
