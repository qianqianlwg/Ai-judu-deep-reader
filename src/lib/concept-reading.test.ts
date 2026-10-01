import { describe, expect, it } from "vitest";
import { segmentAnnotatedText, type TextAnnotation } from "./annotations";
import { conceptLocationKey, conceptReadingVersion, contextualConcept } from "./concept-reading";

const name = "等价形式";
const dictionary = [{ name, text: "别处的全书定义，不应出现在本句" }];
const annotation = (overrides: Partial<TextAnnotation> = {}): TextAnnotation => ({
  id: "a", paragraphId: "p", startOffset: 0, endOffset: 4, textHash: "h", threadId: "t",
  messageId: "unit-a", summary: "摘要不能替代关键词定义", concepts: [name],
  conceptDetails: [{ name, text: "本句解释" }], createdAt: "2026-10-01T08:00:00Z", ...overrides,
});
function concepts(text: string, annotations: TextAnnotation[], paragraphId = "p") {
  return segmentAnnotatedText({ paragraphId, text, sourceText: text, annotations, bookConcepts: dictionary, showConcepts: true })
    .flatMap(segment => segment.concept ? [segment.concept] : []);
}

describe("关键词解释绑定句读块和精确词位", () => {
  it("不同段落的同名词仅保留各自解释和句读块 ID", () => {
    const a = annotation(), b = annotation({ id: "b", paragraphId: "other", messageId: "unit-b", conceptDetails: [{ name, text: "第二段解释" }] });
    expect(concepts(name, [a, b])[0].definitions).toEqual([{ name, text: "本句解释" }]);
    expect(concepts(name, [a, b], "other")[0].versions?.[0].unitId).toBe("unit-b");
    expect(concepts(name, [a, b], "other")[0].definitions).toEqual([{ name, text: "第二段解释" }]);
  });
  it("同段不同句读块的同名词拥有不同位置、来源和解释", () => {
    const text = name + "。" + name;
    const a = annotation(), b = annotation({ id: "b", messageId: "unit-b", startOffset: 5, endOffset: 9, conceptDetails: [{ name, text: "后一句解释" }] });
    const result = concepts(text, [a, b]);
    expect(result.map(item => item.definitions[0].text)).toEqual(["本句解释", "后一句解释"]);
    expect(result.map(item => item.versions?.[0].unitId)).toEqual(["unit-a", "unit-b"]);
    expect(result.map(item => item.location)).toEqual([{ paragraphId: "p", startOffset: 0, endOffset: 4 }, { paragraphId: "p", startOffset: 5, endOffset: 9 }]);
  });
  it("同一句读块中重复出现的词按物理位置保留独立入口", () => {
    const text = name + name, result = concepts(text, [annotation({ endOffset: 8 })]);
    expect(result).toHaveLength(2);
    expect(new Set(result.map(item => conceptLocationKey(item.name, item.location!))).size).toBe(2);
    expect(result.map(item => item.versions?.[0].unitId)).toEqual(["unit-a", "unit-a"]);
  });
  it("同处重读默认最新，保留更早版本且不受接口数组顺序影响", () => {
    const old = annotation(), fresh = annotation({ id: "new", messageId: "unit-new", createdAt: "2026-10-02T08:00:00Z", conceptDetails: [{ name, text: "新的解释" }] });
    for (const entries of [[old, fresh], [fresh, old]]) {
      const result = concepts(name, entries)[0];
      expect(result.definitions).toEqual([{ name, text: "新的解释" }]);
      expect(result.versions?.map(item => [item.unitId, item.definitions[0].text])).toEqual([["unit-new", "新的解释"], ["unit-a", "本句解释"]]);
    }
  });
  it("当前缺定义时保留空值，不借旧版本、其他句子、全书定义或摘要补齐", () => {
    const fresh = annotation({ id: "new", messageId: "unit-new", createdAt: "2026-10-02T08:00:00Z", conceptDetails: [] });
    const result = concepts(name, [annotation(), fresh])[0];
    expect(result.definitions).toEqual([{ name, text: "" }]);
    expect(result.versions).toHaveLength(2);
    expect(result.versions?.[1].definitions[0].text).toBe("本句解释");
  });
  it("解释相同的不同句读版本仍完整保留，不做语义或文本去重", () => {
    const result = concepts(name, [annotation(), annotation({ id: "b", messageId: "unit-b" })])[0];
    expect(result.versions?.map(item => item.unitId)).toEqual(["unit-b", "unit-a"]);
    expect(result.definitions).toHaveLength(1);
  });
  it("重新划分块边界后同一词位仍可追溯此前覆盖该位置的句读", () => {
    const text = "甲" + name + "乙";
    const result = concepts(text, [annotation({ startOffset: 0, endOffset: 6 }), annotation({ id: "b", messageId: "unit-b", startOffset: 1, endOffset: 5, createdAt: "2026-10-02" })])[0];
    expect(result.versions).toHaveLength(2);
    expect(result.location).toEqual({ paragraphId: "p", startOffset: 1, endOffset: 5 });
    expect(result.versions?.[0]).toMatchObject({ unitId: "unit-b", startOffset: 1, endOffset: 5 });
  });
  it("跨页概念保留完整原文词位及同一句读来源", () => {
    const text = "😀" + name + "尾", a = annotation({ startOffset: 2, endOffset: 6 });
    for (const [start, end] of [[0, 4], [4, text.length]]) {
      const result = segmentAnnotatedText({ paragraphId: "p", text: text.slice(start, end), sourceText: text, sourceStartOffset: start, sourceEndOffset: end, annotations: [a], showConcepts: true }).find(item => item.concept)?.concept;
      expect(result?.location).toEqual({ paragraphId: "p", startOffset: 2, endOffset: 6 });
      expect(result?.versions?.[0].unitId).toBe("unit-a");
    }
  });
  it("旧标注没有 messageId 时以标注 ID 保留来源，不修改输入", () => {
    const old = annotation({ messageId: undefined }), before = JSON.stringify(old);
    expect(conceptReadingVersion(old, { name, text: "定义" }).unitId).toBe(old.id);
    concepts(name, [old]);
    expect(JSON.stringify(old)).toBe(before);
  });
  it("相同时刻版本按稳定 ID 排序，并且仅重复标注 ID 去重", () => {
    const a = conceptReadingVersion(annotation(), { name, text: "定义" });
    const b = conceptReadingVersion(annotation({ id: "b", messageId: "unit-b" }), { name, text: "定义" });
    const build = (entries: typeof a[]) => contextualConcept(name, { paragraphId: "p", startOffset: 0, endOffset: 4 }, entries);
    expect(build([a, b, a]).versions).toEqual(build([b, a]).versions);
    expect(build([a, b]).versions).toHaveLength(2);
  });
  it("未由当地句读声明的同名词不产生词位、解释或历史", () => {
    expect(concepts(name, [])).toEqual([]);
    expect(concepts(name + name, [annotation({ startOffset: 4, endOffset: 8 })])).toHaveLength(1);
  });
});
