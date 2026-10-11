// @vitest-environment jsdom
import { expect, it } from "vitest";
import { applyGuideLocationLines } from "./guide-location-lines";
import { GUIDE_ROOT_ID } from "./guide-map-adapter";
import { guidePositionColor, GUIDE_NO_POSITION_COLOR, type GuideLocations } from "./guide-locations";
const ns = "http://www.w3.org/2000/svg";
function fixture() {
  const svg = document.createElementNS(ns, "svg"), path = document.createElementNS(ns, "path"); svg.append(path); document.body.append(svg);
  const child = { isRoot: false, uid: "child", getData: () => "child", left: 300, top: 80, width: 100, height: 30 };
  const parent = { isRoot: false, uid: "parent", getData: () => "parent", left: 20, top: 20, width: 100, height: 30, children: [child], _lines: [{ node: path }] };
  const engine = { renderer: { findNodeByUid: (id: string) => id === "parent" || id === GUIDE_ROOT_ID ? parent : undefined } };
  const nodes = [{ id: "parent", parentId: null, title: "父", summary: "", sourceIds: ["s1"] }, { id: "child", parentId: "parent", title: "子", summary: "", sourceIds: ["s2"] }];
  const span = { paragraphId: "p", chapterId: "c", chapterTitle: "章", start: .1, end: .2 };
  const locations: GuideLocations = { bookId: "b", version: 1, issues: [], sources: [{ sourceId: "s1", editionId: "e", editionLabel: "书", spans: [span] }, { sourceId: "s2", editionId: "e", editionLabel: "书", spans: [{ ...span, start: .8, end: .9 }] }] };
  return { svg, path, engine, nodes, locations };
}
it("现有连接线从父位置渐变到子位置，不改导图节点内容", () => {
  const f = fixture(), before = JSON.stringify(f.nodes);
  applyGuideLocationLines(f.engine, f.nodes, f.locations);
  const gradient = f.svg.querySelector("linearGradient")!;
  expect(f.path.getAttribute("stroke")).toBe("url(#" + gradient.id + ")");
  expect([...gradient.querySelectorAll("stop")].map(stop => stop.getAttribute("stop-color"))).toEqual([guidePositionColor(.15), guidePositionColor(.85)]);
  expect(gradient.getAttribute("gradientUnits")).toBe("userSpaceOnUse");
  expect(JSON.stringify(f.nodes)).toBe(before); f.svg.remove();
});
it("重复绘制不积累渐变定义，无依据连接线恢复灰色虚线", () => {
  const f = fixture(); applyGuideLocationLines(f.engine, f.nodes, f.locations); applyGuideLocationLines(f.engine, f.nodes, f.locations);
  expect(f.svg.querySelectorAll("linearGradient")).toHaveLength(1);
  applyGuideLocationLines(f.engine, f.nodes, { ...f.locations, sources: [] });
  expect(f.path.getAttribute("stroke")).toBe(GUIDE_NO_POSITION_COLOR); expect(f.path.getAttribute("stroke-dasharray")).toBe("3 3");
  expect(f.svg.querySelectorAll("linearGradient")).toHaveLength(0); f.svg.remove();
});
it("多处来源保持不同目标色，折叠后没有渲染线时安全跳过", () => {
  const f = fixture(); f.locations.sources[1].spans.push({ ...f.locations.sources[1].spans[0], start: .3, end: .4 });
  applyGuideLocationLines(f.engine, f.nodes, f.locations);
  expect(f.svg.querySelectorAll("stop")).toHaveLength(3);
  expect(() => applyGuideLocationLines({ renderer: { findNodeByUid: () => undefined } }, f.nodes, f.locations)).not.toThrow(); f.svg.remove();
});

it("连接线遵循局部色阶，颜色差异放大不改变原文位置", () => {
  const f = fixture(); f.locations.sources[0].spans[0] = { ...f.locations.sources[0].spans[0], start: .0168, end: .0169 };
  f.locations.sources[1].spans[0] = { ...f.locations.sources[1].spans[0], start: .0273, end: .0274 };
  const scale = { mode: "mapped" as const, start: .0168, end: .0274 };
  applyGuideLocationLines(f.engine, f.nodes, f.locations, scale);
  const stops = [...f.svg.querySelectorAll("stop")].map(stop => stop.getAttribute("stop-color"));
  expect(stops).toEqual([guidePositionColor(.01685, scale), guidePositionColor(.02735, scale)]);
  expect(stops[0]).not.toBe(stops[1]); expect(f.locations.sources[0].spans[0].start).toBe(.0168); f.svg.remove();
});
