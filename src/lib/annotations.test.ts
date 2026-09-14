import { describe, expect, it } from "vitest";
import { annotationKey, createAnnotation, splitConceptTerms, annotationConceptDetails, segmentAnnotatedText, dedupeAnnotations } from "./annotations";

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


describe("全书概念字典与跨页精确命中", () => {
  const dictionary = [{ name: "自我意识", text: "以自身为对象的意识" }] as const;
  const fullText = "前😀自我意识；自我意识。";
  const slice = (start: number, end: number) => ({ paragraphId: "p", text: fullText.slice(start, end), sourceText: fullText, sourceStartOffset: start, sourceEndOffset: end, annotations: [], bookConcepts: dictionary, showConcepts: true });

  it("没有任何 annotation 仍标记全书字典在本段的所有真实出现位置", () => {
    const result = segmentAnnotatedText(slice(0, fullText.length));
    expect(result.filter((item) => item.concept).map((item) => [item.text, item.startOffset, item.endOffset])).toEqual([["自我意识", 3, 7], ["自我意识", 8, 12]]);
    expect(result.flatMap((item) => item.annotations)).toEqual([]);
    expect(result.flatMap((item) => item.endingAnnotations)).toEqual([]);
    expect(result.map((item) => item.text).join("")).toBe(fullText);
  });

  it("跨页词先在完整原段定位，左右可见片段均绑定同名定义", () => {
    const first = segmentAnnotatedText(slice(0, 5));
    const second = segmentAnnotatedText(slice(5, 8));
    const left = first.find((item) => item.concept);
    const right = second.find((item) => item.concept);
    expect(left).toMatchObject({ text: "自我", startOffset: 3, endOffset: 5 });
    expect(right).toMatchObject({ text: "意识", startOffset: 5, endOffset: 7 });
    expect(left?.concept).toEqual(right?.concept);
    expect(left?.concept?.name).toBe("自我意识");
    expect(first.map((item) => item.text).join("") + second.map((item) => item.text).join("")).toBe(fullText.slice(0, 8));
  });

  it("一个词跨越片段两端时也只裁剪显示文本，不改概念名称", () => {
    expect(segmentAnnotatedText(slice(4, 6))).toMatchObject([{ text: "我意", startOffset: 4, endOffset: 6, concept: { name: "自我意识" } }]);
  });

  it("最长名称优先级在裁剪前确定，跨页不能退化为较短概念", () => {
    const result = segmentAnnotatedText({ ...slice(5, 7), bookConcepts: [...dictionary, { name: "意识", text: "更短概念" }] });
    expect(result).toMatchObject([{ text: "意识", concept: { name: "自我意识", definitions: dictionary } }]);
  });

  it("未提供完整原段时不靠半个词猜测完整名称", () => {
    const result = segmentAnnotatedText({ ...slice(5, 7), sourceText: undefined });
    expect(result.some((item) => item.concept)).toBe(false);
  });

  it("本段其他片段的逐词定义优先，全书定义补充、去重且不挪用摘要", () => {
    const local = createAnnotation({ paragraphId: "p", startOffset: 3, endOffset: 7, threadId: "t", summary: "不能作为定义的整段摘要", concepts: [], conceptDetails: [{ name: "自我意识", text: " 本段定义 " }], createdAt: "2026-09-14" }, fullText);
    const foreign = { ...local, paragraphId: "elsewhere", conceptDetails: [{ name: "自我意识", text: "其他段定义" }] };
    const result = segmentAnnotatedText({ ...slice(8, 12), annotations: [local, foreign], bookConcepts: [{ name: " 自我意识 ", text: "本段定义" }, ...dictionary, ...dictionary] });
    expect(result[0].concept?.definitions).toEqual([{ name: "自我意识", text: "本段定义" }, { name: "自我意识", text: "以自身为对象的意识" }]);
    expect(result[0].annotations).toEqual([]);
  });

  it("缺少名称命中、抽象口号、复合标签不拆词、不猜同义词", () => {
    const text = "确定性还须提高为真理性。";
    const result = segmentAnnotatedText({ paragraphId: "p", text, sourceText: text, annotations: [], bookConcepts: [{ name: "确定性与真理性", text: "复合说明" }, { name: "主体客体的统一", text: "抽象口号" }, { name: "", text: "空名称" }], showConcepts: true });
    expect(result).toMatchObject([{ text }]); expect(result.some((item) => item.concept)).toBe(false);
  });

  it("名称按字面匹配，不把名称中的符号当正则表达式", () => {
    const text = "C++ 不等于 C，a.b 不等于 axb。";
    const result = segmentAnnotatedText({ paragraphId: "p", text, annotations: [], bookConcepts: [{ name: "C++", text: "语言" }, { name: "a.b", text: "字面名称" }], showConcepts: true });
    expect(result.filter((item) => item.concept).map((item) => item.text)).toEqual(["C++", "a.b"]);
  });

  it("关闭概念开关时字典不产生任何概念标记", () => {
    expect(segmentAnnotatedText({ ...slice(0, fullText.length), showConcepts: false }).some((item) => item.concept)).toBe(false);
  });

  it("sourceText 与当前片段内容不一致时明确报错而非错误定位", () => {
    expect(() => segmentAnnotatedText({ ...slice(5, 7), text: "错字" })).toThrow("完整原段落");
    expect(() => segmentAnnotatedText({ ...slice(5, 7), sourceText: "过短" })).toThrow("完整原段落");
  });
});
