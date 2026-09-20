// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildReaderInteractions, clipReaderRect, epubPointToHost, epubRectToHost, insideRect, type ReaderInteraction, type ReaderRect } from "./reader-interactions";
import type { ConceptDetail, TextAnnotation } from "./annotations";

const annotation = (overrides: Partial<TextAnnotation> = {}): TextAnnotation => ({ id: "analysis-1", paragraphId: "p0", startOffset: 0, endOffset: 4, textHash: "synthetic", threadId: "thread-1", messageId: "message-1", kind: "analysis", summary: "句读摘要不能冒充逐词定义", concepts: [], createdAt: "2026-09-18T01:00:00Z", ...overrides });
function fixture(texts: string[]) {
  const paragraphs = texts.map((text, i) => ({ id: `p${i}`, text })), root = document.createElement("main"); document.body.append(root);
  const elements = paragraphs.map(p => { const el = document.createElement("p"); el.textContent = p.text; root.append(el); return el; });
  const rangeFor = vi.fn((id: string, start: number, end: number): Range | null => {
    const index = paragraphs.findIndex(p => p.id === id), p = paragraphs[index];
    if (!p || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > p.text.length) return null;
    const range = document.createRange(); range.setStart(elements[index].firstChild!, start); range.setEnd(elements[index].firstChild!, end); return range;
  });
  return { paragraphs, root, elements, rangeFor, build: (annotations: TextAnnotation[] = [], concepts: ConceptDetail[] = []) => buildReaderInteractions(paragraphs, rangeFor, annotations, concepts) };
}
const conceptsOf = (targets: ReaderInteraction[]) => targets.filter(item => item.kind === "concept");
const historiesOf = (targets: ReaderInteraction[]) => targets.filter(item => item.kind === "history");
const rect = (left: number, top: number, width: number, height: number): ReaderRect => ({ left, top, width, height, right: left + width, bottom: top + height });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

// WHY：共享算法使用真实jsdom Range，映射回调为可审计的精确UTF-16实现，不读取书库或执行模型。
describe("共享概念交互来源与非侵入性", () => {
  it("同文跨段落不猜首个来源，生成独立key", () => {
    const f = fixture(["财政体制", "财政体制"]), before = f.root.innerHTML;
    const result = conceptsOf(f.build([], [{ name: "财政体制", text: "定义" }]));
    expect(result.map(item => item.key)).toEqual(["p0:concept:0", "p1:concept:0"]);
    expect(result.map(item => item.range.startContainer)).toEqual(f.elements.map(el => el.firstChild));
    expect(f.root.innerHTML).toBe(before);
  });
  it("重复概念相邻或分离均逐次定位，不把相邻同文合并成一个词", () => {
    const f = fixture(["财政财政与财政"]), result = conceptsOf(f.build([], [{ name: "财政", text: "定义" }]));
    expect(result.map(item => item.range.startOffset)).toEqual([0, 2, 5]);
    expect(result.map(item => item.range.toString())).toEqual(["财政", "财政", "财政"]); expect(new Set(result.map(item => item.key)).size).toBe(3);
  });
  it("名称最长优先，不拆复合标签或猜同义词", () => {
    const f = fixture(["财政体制与财政治理"]), result = conceptsOf(f.build([], [
      { name: "财政", text: "短词" }, { name: "财政体制", text: "长词" }, { name: "财政治理与政府行为", text: "文中没有完整词" }, { name: "税收制度", text: "近义词不猜" },
    ]));
    expect(result.map(item => [item.range.toString(), item.concept.name])).toEqual([["财政体制", "财政体制"], ["财政", "财政"]]);
  });
  it("过滤空白概念名，保留正文空白和Unicode偏移，不把不连续文字拼成词", () => {
    const f = fixture(["甲 😀 财政 体制\n财政体制"]), result = conceptsOf(f.build([], [
      { name: " \n ", text: "无效" }, { name: "财政体制", text: "连续" }, { name: "😀 财政", text: "含空白原文" },
    ]));
    expect(result.map(item => item.range.toString())).toEqual(["😀 财政", "财政体制"]);
    expect(result[0].range.startOffset).toBe(2); expect(result[0].range.endOffset).toBe(7);
  });
  it("局部定义优先，同文定义去重，缺定义不借用句读摘要", () => {
    const f = fixture(["财政体制"]), result = conceptsOf(f.build([annotation({ concepts: ["财政体制"], conceptDetails: [{ name: "财政体制", text: "本段定义" }] })], [
      { name: "财政体制", text: "本段定义" }, { name: "财政体制", text: "全书定义" },
    ]));
    expect(result[0].concept.definitions.map(d => d.text)).toEqual(["本段定义", "全书定义"]);
    const empty = conceptsOf(f.build([annotation({ concepts: ["财政体制"] })], [{ name: "财政体制", text: "" }]));
    expect(empty[0].concept.definitions).toEqual([{ name: "财政体制", text: "" }]); expect(JSON.stringify(empty)).not.toContain(annotation().summary);
  });
  it("多个标注边界切分同一概念后仍只有一个完整Range，不改输入、DOM和已有选区", () => {
    const f = fixture(["财政体制"]), annotations = [annotation({ endOffset: 1 }), annotation({ id: "second", startOffset: 1, endOffset: 3 })], concepts = [{ name: "财政体制", text: "定义" }];
    const input = JSON.stringify({ paragraphs: f.paragraphs, annotations, concepts }), html = f.root.innerHTML, node = f.elements[0].firstChild;
    const existing = document.createRange(); existing.setStart(node!, 1); existing.setEnd(node!, 3);
    const result = conceptsOf(f.build(annotations, concepts));
    expect(result).toHaveLength(1); expect(result[0].range.toString()).toBe("财政体制"); expect(result[0].range.startOffset).toBe(0); expect(result[0].range.endOffset).toBe(4);
    expect(JSON.stringify({ paragraphs: f.paragraphs, annotations, concepts })).toBe(input); expect(f.root.innerHTML).toBe(html); expect(f.elements[0].firstChild).toBe(node); expect(existing.toString()).toBe("政体");
  });
  it("映射返回null的概念不生成无源目标", () => {
    const f = fixture(["财政体制"]); f.rangeFor.mockReturnValue(null);
    expect(f.build([annotation()], [{ name: "财政体制", text: "定义" }])).toEqual([]);
  });
  it("概念跨空白及嵌套DOM时由回调映射完整来源，不包裹或重新拆装文字", () => {
    const f = fixture(["财政 体制"]); f.elements[0].innerHTML = "<em>财政</em> <strong>体制</strong>";
    const before = f.root.innerHTML;
    f.rangeFor.mockImplementation(() => { const r = document.createRange(); r.setStart(f.elements[0].querySelector("em")!.firstChild!, 0); r.setEnd(f.elements[0].querySelector("strong")!.firstChild!, 2); return r; });
    expect(conceptsOf(f.build([], [{ name: "财政 体制", text: "定义" }]))[0].range.toString()).toBe("财政 体制"); expect(f.root.innerHTML).toBe(before);
  });
  it("不把中间无法映射的概念片段吞进合并Range", () => {
    const f = fixture(["财政体制"]), exact = f.rangeFor.getMockImplementation()!;
    f.rangeFor.mockImplementation((id, start, end) => start === 1 && end === 2 ? null : exact(id, start, end));
    const result = conceptsOf(f.build([annotation({ endOffset: 1 }), annotation({ id: "split", startOffset: 1, endOffset: 2 })], [{ name: "财政体制", text: "定义" }]));
    expect(result.some(item => item.range.startOffset < 2 && item.range.endOffset > 1)).toBe(false);
  });
  it("空段落或无已加载段落不生成交互", () => {
    expect(fixture([""]).build([annotation()], [{ name: "财政", text: "定义" }])).toEqual([]);
    expect(buildReaderInteractions([], vi.fn(), [annotation()], [{ name: "财政", text: "定义" }])).toEqual([]);
  });
});

describe("共享历史与手动标记", () => {
  it("同末端多个历史只一个入口，按时间倒序；不同末端独立", () => {
    const f = fixture(["甲乙丙丁戊己"]), old = annotation({ id: "old" }), newer = annotation({ id: "new", startOffset: 1, createdAt: "2026-09-18T03:00:00Z" }), last = annotation({ id: "last", startOffset: 4, endOffset: 6 });
    const result = historiesOf(f.build([old, last, newer]));
    expect(result.map(item => item.annotations.map(a => a.id))).toEqual([["new", "old"], ["last"]]);
    expect(result.map(item => item.range.toString())).toEqual(["丁", "己"]);
  });
  it("旧kind缺省仍是历史，笔记收藏不混入AI；普通高亮没有浮窗目标", () => {
    const f = fixture(["甲乙丙丁"]), result = f.build([annotation({ kind: undefined }), annotation({ id: "note", kind: "note", summary: "手动笔记" }), annotation({ id: "fav", kind: "favorite" }), annotation({ id: "highlight", kind: "highlight" })]);
    expect(historiesOf(result).flatMap(item => item.annotations.map(a => a.id))).toEqual(["analysis-1"]);
    const marks = result.filter(item => item.kind === "mark"); expect(marks.map(item => item.annotation.id)).toEqual(["note", "fav"]);
    expect(marks.map(item => item.range.toString())).toEqual(["甲乙丙丁", "甲乙丙丁"]);
  });
  it("手动标记没有thread/message时仍作为mark而不是AI历史", () => {
    const f = fixture(["甲乙丙丁"]), result = f.build([annotation({ kind: "note", threadId: "", messageId: undefined })]);
    expect(result.map(item => item.kind)).toEqual(["mark"]);
  });
  it("当前段落外的标注完全忽略，即使有相同文字和偏移", () => {
    const f = fixture(["甲乙丙丁"]); expect(f.build([annotation({ paragraphId: "other" }), annotation({ paragraphId: "other", kind: "note" })])).toEqual([]); expect(f.rangeFor).not.toHaveBeenCalled();
  });
  it.each([[-1, 2], [0, 99], [2, 2], [3, 1], [0.5, 2], [0, Number.NaN]])("无效标记%s..%s不能生成历史或手动目标", (startOffset, endOffset) => {
    const f = fixture(["甲乙丙丁"]);
    expect(f.build([annotation({ startOffset, endOffset }), annotation({ id: "note", kind: "note", startOffset, endOffset })])).toEqual([]);
  });
  it("历史结束在emoji后时目标覆盖完整字符而不是孤立低代理项", () => {
    const f = fixture(["甲😀"]), history = historiesOf(f.build([annotation({ endOffset: 3 })]));
    expect(history).toHaveLength(1); expect(history[0].range.toString()).toBe("😀"); expect(history[0].range.startOffset).toBe(1);
  });
});

describe("共享坐标边界", () => {
  it("iframe独立横纵缩放含负坐标，无需修改书内DOM", () => {
    const frame = document.createElement("iframe"); document.body.append(frame);
    Object.defineProperties(frame, { clientWidth: { value: 400 }, clientHeight: { value: 200 }, getBoundingClientRect: { value: () => rect(-50, 20, 800, 100) } });
    expect(epubPointToHost(frame.contentDocument!, 10, 30)).toEqual({ x: -30, y: 35 });
    expect(epubRectToHost(frame.contentDocument!, { left: 10, top: 30, right: 40, bottom: 50 })).toEqual(rect(-30, 35, 60, 10));
  });
  it("零client尺寸不除零，保留frame偏移", () => {
    const frame = document.createElement("iframe"); document.body.append(frame);
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 800, 600));
    expect(epubPointToHost(frame.contentDocument!, 4, 5)).toEqual({ x: 14, y: 25 });
  });
  it("宿主与无window文档不误套iframe偏移", () => {
    for (const doc of [document, new DOMParser().parseFromString("<p>合成</p>", "text/html")]) expect(epubPointToHost(doc, 12, 34)).toEqual({ x: 12, y: 34 });
  });
  it("裁剪只保留可见交集，不更改输入或使用旧width", () => {
    const original = rect(-10, -20, 50, 70), before = { ...original };
    expect(clipReaderRect(original, rect(0, 0, 20, 30))).toEqual(rect(0, 0, 20, 30)); expect(original).toEqual(before);
  });
  it.each([[100, 0, 1, 1], [0, 100, 1, 1], [-10, 0, 10, 10], [0, 0, 0, 10], [0, 0, 10, 0]])("相切/离屏/零面积 %s,%s,%s,%s 没有命中矩形", (x, y, w, h) => {
    expect(clipReaderRect(rect(x, y, w, h), rect(0, 0, 100, 100))).toBeNull();
  });
  it("点命中含四边而不扩张", () => {
    const bounds = rect(10, 20, 30, 40);
    for (const [x, y] of [[10, 20], [40, 20], [10, 60], [40, 60]]) expect(insideRect(bounds, x, y)).toBe(true);
    for (const [x, y] of [[9.99, 20], [40.01, 20], [10, 19.99], [10, 60.01]]) expect(insideRect(bounds, x, y)).toBe(false);
    expect(insideRect(bounds, Number.NaN, 30)).toBe(false);
  });
});
