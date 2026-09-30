import { describe, expect, it } from "vitest";
import { annotationKey, createAnnotation, splitConceptTerms, annotationConceptDetails, segmentAnnotatedText, dedupeAnnotations, analysisIntervalsWithoutConcepts } from "./annotations";

describe("annotations", () => {
  it("uses stable text anchors for deduplication", () => {
    const annotation = createAnnotation({ paragraphId: "p", startOffset: 0, endOffset: 2, threadId: "t", summary: "note", concepts: [], createdAt: "2026-01-01" }, "\u4f60\u597d\u4e16\u754c");
    expect(annotationKey(annotation)).toContain("p:0:2:");
  });

  it("marks only concept terms that really occur in the source", () => {
    const source = "\u81ea\u6211\u610f\u8bc6\u53d1\u73b0\u5bf9\u8c61\uff0c\u5e76\u901a\u8fc7\u627f\u8ba4\u5f62\u6210\u7edf\u4e00\u3002";
    expect(splitConceptTerms(source, ["\u81ea\u6211\u610f\u8bc6", "\u627f\u8ba4", "\u4e0d\u5b58\u5728\u7684\u6982\u5ff5"]))
      .toEqual([
        { text: "\u81ea\u6211\u610f\u8bc6", isConcept: true },
        { text: "\u53d1\u73b0\u5bf9\u8c61\uff0c\u5e76\u901a\u8fc7", isConcept: false },
        { text: "\u627f\u8ba4", isConcept: true },
        { text: "\u5f62\u6210\u7edf\u4e00\u3002", isConcept: false },
      ]);
  });

  it("prefers longer concepts and does not overlap marked text", () => {
    const source = "\u81ea\u6211\u610f\u8bc6\u4e0e\u610f\u8bc6";
    expect(splitConceptTerms(source, ["\u610f\u8bc6", "\u81ea\u6211\u610f\u8bc6"]))
      .toEqual([
        { text: "\u81ea\u6211\u610f\u8bc6", isConcept: true },
        { text: "\u4e0e", isConcept: false },
        { text: "\u610f\u8bc6", isConcept: true },
      ]);
  });
});


describe("分页标注与独立历史", () => {
  const source = "前😀自我意识成立后";
  const annotation = createAnnotation({ paragraphId: "p", startOffset: 3, endOffset: 9, threadId: "t", summary: "整段摘要", concepts: ["自我意识"], conceptDetails: [{ name: "自我意识", text: "逐词定义" }], createdAt: "2026-09-14" }, source);
  it("保留概念详情并清理空白，旧数据不冒充定义", () => {
    expect(annotation.conceptDetails).toEqual([{ name: "自我意识", text: "逐词定义" }]);
    expect(annotationConceptDetails({ concepts: [" 自我意识 ", ""], conceptDetails: undefined })).toEqual([{ name: "自我意识", text: "" }]);
  });
  it("UTF-16 段落位置与代理对一致，分页只展示一次真末尾", () => {
    const first = segmentAnnotatedText({ paragraphId: "p", text: source.slice(0, 7), sourceStartOffset: 0, sourceEndOffset: 7, annotations: [annotation], showConcepts: true });
    const second = segmentAnnotatedText({ paragraphId: "p", text: source.slice(7), sourceStartOffset: 7, sourceEndOffset: source.length, annotations: [annotation], showConcepts: true });
    expect(first.map((item) => item.text).join("") + second.map((item) => item.text).join("")).toBe(source);
    expect(first.flatMap((item) => item.endingAnnotations)).toHaveLength(0);
    expect(second.flatMap((item) => item.endingAnnotations)).toEqual([annotation]);
    expect(first.find((item) => item.concept)?.startOffset).toBe(3);
    expect(second[0].startOffset).toBe(7);
  });
  it("不接受字符数与源偏移不一致的片段", () => {
    expect(() => segmentAnnotatedText({ paragraphId: "p", text: "😀", sourceStartOffset: 0, sourceEndOffset: 1, annotations: [], showConcepts: true })).toThrow("UTF-16");
  });
  it("重叠标注保留全部范围和定义，不重复文字", () => {
    const overlapping = { ...annotation, id: "other", startOffset: 0, endOffset: 8, conceptDetails: [{ name: "自我意识", text: "另一解释" }] };
    const result = segmentAnnotatedText({ paragraphId: "p", text: source, annotations: [annotation, overlapping], showConcepts: true });
    expect(result.map((item) => item.text).join("")).toBe(source);
    expect(result.find((item) => item.startOffset === 3)?.annotations).toHaveLength(2);
    expect(result.find((item) => item.concept)?.concept?.definitions).toHaveLength(2);
    expect(result.flatMap((item) => item.endingAnnotations)).toHaveLength(2);
  });
  it("相同范围的不同消息生成独立 ID，去重只移除重复 ID", () => {
    const first = createAnnotation({ ...annotation, id: undefined, messageId: "m1" }, source);
    const second = createAnnotation({ ...annotation, id: undefined, messageId: "m2" }, source);
    expect(first.id).not.toBe(second.id); expect(first.messageId).toBe("m1");
    expect(annotationKey(first)).toBe(annotationKey(second));
    expect(dedupeAnnotations([first, first, second])).toEqual([first, second]);
  });
  it("片段从标注结束位置开始时不再显示上一片段的图标", () => {
    const result = segmentAnnotatedText({ paragraphId: "p", text: source.slice(9), sourceStartOffset: 9, annotations: [annotation], showConcepts: true });
    expect(result.flatMap((item) => item.endingAnnotations)).toHaveLength(0);
  });
});


describe("\u53e5\u8bfb\u951a\u70b9\u8303\u56f4\u5185\u7684\u6982\u5ff5", () => {
  const dictionary = [{ name: "\u81ea\u6211\u610f\u8bc6", text: "\u4ee5\u81ea\u8eab\u4e3a\u5bf9\u8c61\u7684\u610f\u8bc6" }] as const;
  const fullText = "\u524d\ud83d\ude00\u81ea\u6211\u610f\u8bc6\uff1b\u81ea\u6211\u610f\u8bc6\u3002";
  const firstOccurrence = createAnnotation({ paragraphId: "p", startOffset: 3, endOffset: 7, threadId: "t", summary: "\u4e0d\u80fd\u4f5c\u4e3a\u9010\u8bcd\u5b9a\u4e49", concepts: ["\u81ea\u6211\u610f\u8bc6"], conceptDetails: [{ name: "\u81ea\u6211\u610f\u8bc6", text: "\u672c\u6bb5\u5b9a\u4e49" }], createdAt: "2026-09-30" }, fullText);
  const slice = (start: number, end: number, annotations = [firstOccurrence]) => ({ paragraphId: "p", text: fullText.slice(start, end), sourceText: fullText, sourceStartOffset: start, sourceEndOffset: end, annotations, bookConcepts: dictionary, showConcepts: true });

  it("a book dictionary alone does not trigger highlights", () => {
    const result = segmentAnnotatedText(slice(0, fullText.length, []));
    expect(result.some((item) => item.concept)).toBe(false);
    expect(result.map((item) => item.text).join("")).toBe(fullText);
  });
  it("only complete concept occurrences inside the current annotation anchor are highlighted", () => {
    const result = segmentAnnotatedText(slice(0, fullText.length));
    expect(result.filter((item) => item.concept).map((item) => [item.text, item.startOffset, item.endOffset])).toEqual([["\u81ea\u6211\u610f\u8bc6", 3, 7]]);
    expect(result.filter((item) => item.endingAnnotations.length).at(-1)?.endingAnnotations).toEqual([firstOccurrence]);
  });
  it("pagination preserves source offsets and the same local definition", () => {
    const first = segmentAnnotatedText(slice(0, 5));
    const second = segmentAnnotatedText(slice(5, 8));
    const left = first.find((item) => item.concept);
    const right = second.find((item) => item.concept);
    expect(left).toMatchObject({ text: "\u81ea\u6211", startOffset: 3, endOffset: 5 });
    expect(right).toMatchObject({ text: "\u610f\u8bc6", startOffset: 5, endOffset: 7 });
    expect(left?.concept).toEqual(right?.concept);
  });
  it("clipping a visible page does not change the full concept match", () => {
    expect(segmentAnnotatedText(slice(4, 6))).toMatchObject([{ text: "\u6211\u610f", startOffset: 4, endOffset: 6, concept: { name: "\u81ea\u6211\u610f\u8bc6" } }]);
  });
  it("a repeated term outside the annotation anchor is not highlighted", () => {
    const result = segmentAnnotatedText(slice(7, 13));
    expect(result.some((item) => item.concept)).toBe(false);
  });
  it("a different paragraph annotation cannot activate the same word here", () => {
    const other = { ...firstOccurrence, paragraphId: "other" };
    const result = segmentAnnotatedText({ paragraphId: "p", text: "\u81ea\u6211\u610f\u8bc6", annotations: [other], bookConcepts: dictionary, showConcepts: true });
    expect(result.some((item) => item.concept)).toBe(false);
  });
  it("the current definition wins and the book dictionary only supplements it without duplicates", () => {
    const local = createAnnotation({ paragraphId: "p", startOffset: 3, endOffset: 7, threadId: "t", summary: "\u4e0d\u80fd\u501f\u7528\u53e5\u8bfb\u6458\u8981", concepts: [], conceptDetails: [{ name: "\u81ea\u6211\u610f\u8bc6", text: " \u672c\u6bb5\u5b9a\u4e49 " }], createdAt: "2026-09-30" }, fullText);
    const result = segmentAnnotatedText({ ...slice(3, 7), annotations: [local], bookConcepts: [{ name: " \u81ea\u6211\u610f\u8bc6 ", text: "\u672c\u6bb5\u5b9a\u4e49" }, ...dictionary, ...dictionary] });
    expect(result[0].concept?.definitions).toEqual([{ name: "\u81ea\u6211\u610f\u8bc6", text: "\u672c\u6bb5\u5b9a\u4e49" }, dictionary[0]]);
  });
  it("concept matching stays literal and requires a concept declared by this annotation", () => {
    const text = "C++ \u4e0d\u7b49\u4e8e C\uff0ca.b \u4e0d\u7b49\u4e8e axb\u3002";
    const local = createAnnotation({ paragraphId: "p", startOffset: 0, endOffset: text.length, threadId: "t", summary: "", concepts: ["C++", "a.b"], conceptDetails: [{ name: "C++", text: "\u8bed\u8a00" }, { name: "a.b", text: "\u5b57\u9762\u540d\u79f0" }], createdAt: "now" }, text);
    const result = segmentAnnotatedText({ paragraphId: "p", text, sourceText: text, annotations: [local], showConcepts: true });
    expect(result.filter((item) => item.concept).map((item) => item.text)).toEqual(["C++", "a.b"]);
  });
  it("disabled concept display produces no marks", () => {
    expect(segmentAnnotatedText({ ...slice(0, fullText.length), showConcepts: false }).some((item) => item.concept)).toBe(false);
  });
  it("a slice inconsistent with its complete source throws instead of mislocating", () => {
    expect(() => segmentAnnotatedText({ ...slice(5, 7), text: "\u9519\u5b57" })).toThrow("\u5b8c\u6574\u539f\u6bb5\u843d");
    expect(() => segmentAnnotatedText({ ...slice(5, 7), sourceText: "\u8fc7\u77ed" })).toThrow("\u5b8c\u6574\u539f\u6bb5\u843d");
  });
});

describe("句读与概念标记不重叠", () => {
  it("句读区间跨越概念时只给前后文字画线", () => {
    expect(analysisIntervalsWithoutConcepts("甲概念乙", 0, 4, [{name:"概念", text:"解释"}])).toEqual([{start:0,end:1},{start:3,end:4}]);
    expect(analysisIntervalsWithoutConcepts("概念", 0, 2, [{name:"概念", text:"解释"}])).toEqual([]);
  });
});
