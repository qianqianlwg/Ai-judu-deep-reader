import { expect, it } from "vitest";
import { guideLocationsSchema, guideNodePosition, guidePositionColor, guidePositionLabel, GUIDE_POSITION_STOPS, GUIDE_POSITION_GRADIENT, guideColorScale, groupGuideLocations } from "./guide-locations";
const span = { paragraphId: "p", chapterId: "c", chapterTitle: "一", start: .1, end: .2 };
const data = { bookId: "b", version: 1, issues: [], sources: [{ sourceId: "s", editionId: "e", editionLabel: "原书", spans: [span, { ...span, start: .8, end: .9 }] }] };
it("同一位置颜色稳定，色带端点和插值一致，不接受非有限值", () => {
  expect(guidePositionColor(0)).toBe(GUIDE_POSITION_STOPS[0]);
  GUIDE_POSITION_STOPS.forEach((color,index) => expect(guidePositionColor(index / (GUIDE_POSITION_STOPS.length - 1))).toBe(color));
  expect(guidePositionColor(1)).toBe(GUIDE_POSITION_STOPS.at(-1));
  expect(guidePositionColor(.0625)).toBe("#2885cc");
  expect(() => guidePositionColor(NaN)).toThrow();
});
it("多处来源保留独立区段，父主题仅在无直接来源时明确汇总子主题", () => {
  const parent = { id: "a", parentId: null, title: "父", summary: "", sourceIds: [] };
  const child = { ...parent, id: "b", parentId: "a", sourceIds: ["s"] };
  expect(guideNodePosition(child, [parent, child], data)).toMatchObject({ inherited: false, missing: 0, sources: [{ spans: [span, { ...span, start: .8, end: .9 }] }] });
  expect(guideNodePosition(parent, [parent, child], data).inherited).toBe(true);
  expect(guideNodePosition({ ...parent, sourceIds: ["unknown"] }, [parent, child].map(node => node.id === "a" ? { ...node, sourceIds: ["unknown"] } : node), data)).toEqual({ inherited: false, missing: 1, sources: [] });
});
it("拒绝倒置或越界区段，短来源用约数避免冗长小数", () => {
  expect(guideLocationsSchema.safeParse({ ...data, sources: [{ ...data.sources[0], spans: [{ ...span, end: .05 }] }] }).success).toBe(false);
  expect(guideLocationsSchema.safeParse({ ...data, sources: [{ ...data.sources[0], spans: [{ ...span, end: 2 }] }] }).success).toBe(false);
  expect(guidePositionLabel(span)).toBe("10%–20%");
  expect(guidePositionLabel({ ...span, start: 0, end: .000001 })).toBe("约 0%");
});

it("长书集中在前段时放大已关联色阶，但真实百分比不变，全书模式保持稳定", () => {
  const near = { ...data, sources: [{ ...data.sources[0], spans: [{ ...span, start: .0168, end: .0173 }, { ...span, paragraphId: "p2", start: .0271, end: .0274 }] }] };
  const scale = guideColorScale(near, "mapped");
  expect(scale).toEqual({ mode: "mapped", start: .0168, end: .0274 });
  expect(guidePositionColor(scale.start, scale)).toBe(GUIDE_POSITION_STOPS[0]);
  expect(guidePositionColor(scale.end, scale)).toBe(GUIDE_POSITION_STOPS.at(-1));
  expect(guideColorScale(near, "book")).toEqual({ mode: "book", start: 0, end: 1 });
  expect(near.sources[0].spans[0].start).toBe(.0168);
});
it("截图中的近似位置合成一行，即使不在相邻段；底层真实来源及间隔仍保留", () => {
  const first = { ...span, paragraphId: "p457", paragraphIndex: 457, start: .027137966, end: .027272918 };
  const second = { ...span, paragraphId: "p459", paragraphIndex: 469, start: .027334880, end: .027422048 };
  const sourceA = { ...data.sources[0], sourceId: "a", spans: [first] };
  const sourceB = { ...data.sources[0], sourceId: "b", spans: [second] };
  const before = JSON.stringify([sourceA, sourceB]);
  const groups = groupGuideLocations([sourceB, sourceA]);
  expect(groups).toHaveLength(1); expect(guidePositionLabel(groups[0])).toBe("2.71%–2.74%");
  expect(groups[0].hasGap).toBe(true); expect(groups[0].spans).toEqual([first, second]);
  expect(JSON.stringify([sourceA, sourceB])).toBe(before);
});
it("相近但跨版本不能合并，同段、连续、近邻来源合并，远处来源保持分开", () => {
  const original = { ...data.sources[0], spans: [{ ...span, paragraphIndex: 1, start: .1, end: .2 }] };
  const adjacent = { ...original, sourceId: "s2", spans: [{ ...span, paragraphId: "p2", paragraphIndex: 2, start: .3, end: .4 }] };
  const near = { ...original, sourceId: "s3", spans: [{ ...span, paragraphId: "p3", paragraphIndex: 9, start: .40005, end: .5 }] };
  const distant = { ...original, sourceId: "s4", spans: [{ ...span, paragraphId: "p4", paragraphIndex: 20, start: .8, end: .9 }] };
  expect(groupGuideLocations([original, adjacent, near, distant])).toHaveLength(2);
  expect(groupGuideLocations([original, { ...adjacent, editionId: "other", spans: original.spans }])).toHaveLength(2);
});

it("九个主色覆盖完整色带且与连线色阶一致，不截断在原五色范围", () => {
  expect(GUIDE_POSITION_STOPS).toHaveLength(9);
  expect(new Set(GUIDE_POSITION_STOPS).size).toBe(9);
  GUIDE_POSITION_STOPS.forEach((color,index)=>expect(GUIDE_POSITION_GRADIENT).toContain(color + " " + index * 12.5 + "%"));
  expect(GUIDE_POSITION_GRADIENT).not.toContain("112.5%");
});
