// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { buildEpubInteractions, clipReaderRect, epubPointToHost, epubRectToHost, insideRect, type ReaderRect } from "./epub-interactions";
import { mapEpubDocument } from "./epub-source-map";
import type { TextAnnotation } from "./annotations";

const text = "理解财政体制，才能理解地方发展。";
const annotation = (overrides: Partial<TextAnnotation> = {}): TextAnnotation => ({
  id: "analysis-1", paragraphId: "p0", startOffset: 0, endOffset: 6,
  textHash: "unused", threadId: "thread-1", messageId: "message-1", kind: "analysis",
  summary: "这是句读摘要，不是概念定义", concepts: ["财政体制"], createdAt: "2026-09-18T01:00:00Z", ...overrides,
});
function fixture(html = `<p>${text}</p>`, texts = [text]) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const maps = mapEpubDocument(doc, { id: "chapter", title: "章节", paragraphs: texts.map((value, index) => ({ id: `p${index}`, text: value })) });
  return { doc, maps };
}
const rect = (left: number, top: number, width: number, height: number): ReaderRect => ({ left, top, width, height, right: left + width, bottom: top + height });
afterEach(() => document.body.replaceChildren());

describe("EPUB 非侵入交互投影", () => {
  it("概念跨内联元素仍生成完整 Range，不修改 DOM、文本节点或既有来源位置", () => {
    const { doc, maps } = fixture('<p>理解<em>财政</em><strong>体制</strong>，才能理解地方发展。</p>');
    const before = doc.documentElement.outerHTML;
    const nodes = maps[0].points.map(point => point.node);
    const existing = doc.createRange(); existing.selectNodeContents(doc.querySelector("em")!);
    const targets = buildEpubInteractions(maps, [annotation()], [{ name: "财政体制", text: "财政关系的制度安排" }]);
    expect(targets.find(target => target.kind === "concept")?.range.toString()).toBe("财政体制");
    expect(doc.documentElement.outerHTML).toBe(before);
    expect(maps[0].points.map(point => point.node)).toEqual(nodes);
    expect(existing.toString()).toBe("财政");
    expect(existing.startContainer).toBe(doc.querySelector("em"));
  });

  it("缺失逐词定义保留空值，不能使用句读摘要造定义", () => {
    const { maps } = fixture();
    const target = buildEpubInteractions(maps, [annotation()], [{ name: "财政体制", text: "" }]).find(item => item.kind === "concept");
    expect(target?.kind).toBe("concept");
    if (target?.kind !== "concept") throw new Error("缺少概念目标");
    expect(target.concept.definitions.map(item => item.text)).toEqual([""]);
    expect(JSON.stringify(target.concept)).not.toContain(annotation().summary);
  });

  it("本段定义优先并合并不同全书定义，不重复同文定义", () => {
    const { maps } = fixture();
    const target = buildEpubInteractions(maps, [annotation({ conceptDetails: [{ name: "财政体制", text: "本段定义" }] })], [
      { name: "财政体制", text: "本段定义" }, { name: "财政体制", text: "全书定义" },
    ]).find(item => item.kind === "concept");
    expect(target?.kind === "concept" && target.concept.definitions.map(item => item.text)).toEqual(["本段定义", "全书定义"]);
  });

  it("标注边界将同一概念分段时仍只有一个完整概念目标", () => {
    const { maps } = fixture();
    const targets = buildEpubInteractions(maps, [annotation({ endOffset: 4 })], [{ name: "财政体制", text: "定义" }]);
    const concepts = targets.filter(item => item.kind === "concept");
    expect(concepts).toHaveLength(1);
    expect(concepts[0].range.toString()).toBe("财政体制");
    expect(targets.find(item => item.kind === "history")?.range.toString()).toBe(text.slice(3, 4));
  });

  it("重复概念按具体位置分别定位，最长名称优先且不猜同义词", () => {
    const value = "财政体制与财政体制";
    const { maps } = fixture(`<p>${value}</p>`, [value]);
    const targets = buildEpubInteractions(maps, [], [{ name: "财政", text: "短词" }, { name: "财政体制", text: "长词" }, { name: "税收制度", text: "未出现" }]);
    expect(targets.map(item => item.range.toString())).toEqual(["财政体制", "财政体制"]);
    expect(new Set(targets.map(item => item.key)).size).toBe(2);
    expect(targets.map(item => item.range.startOffset)).toEqual([0, 5]);
  });

  it("同一末端的历史合并为一个入口并按时间倒序，其他末端分开", () => {
    const { maps } = fixture();
    const newer = annotation({ id: "newer", messageId: "newer", createdAt: "2026-09-18T03:00:00Z" });
    const other = annotation({ id: "other", startOffset: 7, endOffset: text.length });
    const targets = buildEpubInteractions(maps, [annotation(), other, newer], []);
    const histories = targets.filter(item => item.kind === "history");
    expect(histories).toHaveLength(2);
    expect(histories.map(item => item.annotations.map(value => value.id))).toEqual([["newer", "analysis-1"], ["other"]]);
    expect(histories.map(item => item.range.toString())).toEqual([text.slice(5, 6), "。"]);
  });

  it("兼容旧分析 kind 缺省，手动笔记/收藏不能混入 AI 历史", () => {
    const { maps } = fixture();
    const targets = buildEpubInteractions(maps, [annotation({ kind: undefined }), annotation({ id: "note", kind: "note" }), annotation({ id: "favorite", kind: "favorite" }), annotation({ id: "highlight", kind: "highlight" })], []);
    expect(targets.filter(item => item.kind === "history").flatMap(item => item.annotations.map(value => value.id))).toEqual(["analysis-1"]);
    expect(targets.filter(item => item.kind === "mark").map(item => item.annotation.id)).toEqual(["note", "favorite"]);
  });

  it("只对当前已映射段落构造目标，拒绝越界标注末端", () => {
    const { maps } = fixture();
    const targets = buildEpubInteractions(maps, [annotation({ paragraphId: "unloaded" }), annotation({ endOffset: 1000, id: "invalid" })], []);
    expect(targets).toEqual([]);
  });

  it("UTF-16 代理对和空白保留真实 DOM Range", () => {
    const value = "认识 😀 财政体制。";
    const { doc, maps } = fixture('<p>认识 😀 <em>财政</em>体制。</p>', [value]);
    const before = doc.body.innerHTML;
    const targets = buildEpubInteractions(maps, [], [{ name: "😀 财政体制", text: "定义" }]);
    expect(targets).toHaveLength(1);
    expect(targets[0].range.toString()).toBe("😀 财政体制");
    expect(doc.body.innerHTML).toBe(before);
  });
});

describe("EPUB 可见区域与缩放坐标", () => {
  it("将 iframe CSS 缩放与偏移应用到点和矩形，不使用宿主窗口原点", () => {
    const frame = document.createElement("iframe"); document.body.append(frame);
    Object.defineProperties(frame, { clientWidth: { value: 400 }, clientHeight: { value: 300 }, getBoundingClientRect: { value: () => rect(100, 50, 800, 450) } });
    expect(epubPointToHost(frame.contentDocument!, 10, 20)).toEqual({ x: 120, y: 80 });
    expect(epubRectToHost(frame.contentDocument!, { left: 10, top: 20, right: 60, bottom: 40 })).toEqual(rect(120, 80, 100, 30));
  });
  it("无 iframe 的文档坐标保持不变", () => {
    expect(epubPointToHost(new DOMParser().parseFromString("<p>x</p>", "text/html"), 12, 34)).toEqual({ x: 12, y: 34 });
  });
  it("仅保留宿主当前页可见交集，完全离屏或零面积返回 null", () => {
    expect(clipReaderRect(rect(-10, 5, 30, 50), rect(0, 0, 100, 20))).toEqual(rect(0, 5, 20, 15));
    expect(clipReaderRect(rect(110, 0, 20, 20), rect(0, 0, 100, 100))).toBeNull();
    expect(clipReaderRect(rect(100, 0, 0, 20), rect(0, 0, 100, 100))).toBeNull();
  });
  it("命中包含边界但不延伸到概念之外", () => {
    expect(insideRect(rect(10, 20, 30, 40), 10, 20)).toBe(true);
    expect(insideRect(rect(10, 20, 30, 40), 40, 60)).toBe(true);
    expect(insideRect(rect(10, 20, 30, 40), 40.01, 60)).toBe(false);
  });
});
