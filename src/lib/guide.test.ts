import { describe, expect, it } from "vitest";
import { applyGuidePatch, changeGuide, guideDescendants, validateGuide, type GuideNode } from "./guide";
const nodes: GuideNode[] = [{ id: "a", parentId: null, title: "实践", summary: "起点", sourceIds: ["m"] }, { id: "b", parentId: "a", title: "认识", summary: "发展", sourceIds: ["n"] }, { id: "c", parentId: null, title: "其他", summary: "", sourceIds: [] }];
describe("导读树变化", () => {
  it("编辑不会突变输入", () => { const result = changeGuide(nodes, { type: "edit", id: "a", title: "新标题", summary: "新归纳" }); expect(result.nodes[0].title).toBe("新标题"); expect(nodes[0].title).toBe("实践"); });
  it("移动和兄弟顺序", () => { const result = changeGuide(nodes, { type: "move", id: "c", parentId: "a", beforeId: "b" }); expect(result.nodes.map(n => n.id)).toEqual(["a", "c", "b"]); expect(result.nodes[1].parentId).toBe("a"); });
  it("禁止循环而不限制业务层级", () => { expect(() => changeGuide(nodes, { type: "move", id: "a", parentId: "b", beforeId: null })).toThrow("自身"); expect(() => validateGuide([{ ...nodes[0], parentId: "missing" }])).toThrow("父主题"); });
  it("合并保留内容、依据和子节点", () => { const result = changeGuide(nodes, { type: "merge", id: "a", targetId: "c" }); expect(result.nodes.find(n => n.id === "b")?.parentId).toBe("c"); expect(result.nodes.find(n => n.id === "c")?.sourceIds).toEqual(["m"]); });
  it("删除整个子树", () => { expect(changeGuide(nodes, { type: "remove", id: "a" }).nodes.map(n => n.id)).toEqual(["c"]); });
  it("AI能编辑手动节点与结构，但不能伪造来源", () => { const patch = { reason: "整理", upserts: [{ ...nodes[0], parentId: "c", title: "实践的地位" }], removeIds: [] }; expect(applyGuidePatch(nodes, patch, new Set(["m", "n"]))[0].parentId).toBe("c"); expect(() => applyGuidePatch(nodes, patch, new Set())).toThrow("已完成的句读"); });
  it("AI删除父级时必须同时处理孩子", () => { expect(() => applyGuidePatch(nodes, { reason: "合并", upserts: [], removeIds: ["a"] }, new Set(["m", "n"]))).toThrow("父主题"); });
});


describe("整书大图的结构操作", () => {
  const chain = (count: number): GuideNode[] => Array.from({ length: count }, (_, index) => ({
    id: "topic-" + index, parentId: index ? "topic-" + (index - 1) : null,
    title: "主题" + index, summary: "", sourceIds: [], position: { x: index, y: index },
  }));
  it("不依赖数组父子顺序，万层主题也能迭代验证、找子树", () => {
    const deep = chain(10000).reverse();
    expect(validateGuide(deep)).toHaveLength(10000);
    expect(guideDescendants(deep, "topic-0").size).toBe(10000);
    expect(guideDescendants(deep, "topic-5000").size).toBe(5000);
  });
  it("深层闭环及不相连的闭环都被拒绝，不会把已核验分支误作安全", () => {
    const deep = chain(5000).reverse();
    deep[deep.length - 1].parentId = "topic-4999";
    expect(() => validateGuide(deep)).toThrow("自身");
    expect(() => validateGuide([...nodes, { ...nodes[0], id: "x", parentId: "y" }, { ...nodes[0], id: "y", parentId: "x" }])).toThrow("自身");
  });
  it("移动大子树只清除该子树坐标，源输入与其他分支不受影响", () => {
    const tree = chain(2000).reverse();
    tree.push({ id: "other", parentId: null, title: "另一个主题", summary: "", sourceIds: [], position: { x: 99, y: 88 } });
    const moved = changeGuide(tree, { type: "move", id: "topic-0", parentId: "other", beforeId: null }).nodes;
    expect(moved.find(node => node.id === "topic-0")?.parentId).toBe("other");
    expect(moved.filter(node => node.position)).toEqual([tree[tree.length - 1]]);
    expect(tree.every(node => node.position)).toBe(true);
  });
});
