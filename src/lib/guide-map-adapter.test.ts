import { expect, it } from "vitest";
import {
  parseMindView,
  fromMindTree,
  mindCanvasSignature,
  toMindTree,
  GUIDE_ROOT_ID,
} from "./guide-map-adapter";
import { changeGuide } from "./guide";
const nodes = [
  {
    id: "a",
    parentId: null,
    title: "认识",
    summary: "原有归纳",
    sourceIds: ["m"],
  },
  {
    id: "b",
    parentId: "a",
    title: "经验",
    summary: "已有依据",
    sourceIds: ["n"],
    position: { x: 2, y: 9 },
  },
];
it("库数据双向转换保留身份层级和位置，折叠只是视图", () => {
  const tree = toMindTree("书", nodes, new Set(["a"]));
  expect(tree.data.uid).toBe(GUIDE_ROOT_ID);
  expect(tree.children[0].data.expand).toBe(false);
  const round = fromMindTree(tree);
  expect(round.nodes).toEqual(
    nodes.map((node) => ({
      id: node.id,
      parentId: node.parentId,
      title: node.title,
      ...(node.position ? { position: node.position } : {}),
    })),
  );
  expect([...round.collapsed]).toEqual(["a"]);
  expect(mindCanvasSignature(round.nodes)).not.toContain("summary");
});
it("原文依据不能被图库json重写，新增节点只是个人整理", () => {
  const tree = toMindTree("书", nodes, new Set());
  tree.children[0].data.text = "新的理解";
  const input = fromMindTree(tree);
  const result = changeGuide(nodes, { type: "canvas", nodes: input.nodes });
  expect(result.nodes[0]).toMatchObject({
    title: "新的理解",
    summary: "原有归纳",
    sourceIds: ["m"],
  });
});
it("畸形数据和根节点冒名拒绝", () => {
  expect(() => fromMindTree({ data: { uid: "wrong" }, children: [] })).toThrow(
    "根节点",
  );
  const tree = toMindTree("书", nodes, new Set());
  tree.children[0].data.uid = GUIDE_ROOT_ID;
  expect(() => fromMindTree(tree)).toThrow("保留");
});

it("视角恢复拒绝畸形、越界和任意状态字段", () => {
  expect(parseMindView({ state: { scale: 1 }, transform: {} })).toBeUndefined();
  const view = { state: { scale: 1, x: 0, y: 0, sx: 0, sy: 0, injected: "bad" }, transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } };
  expect(parseMindView(view)?.state).not.toHaveProperty("injected");
  expect(parseMindView({ ...view, state: { ...view.state, scale: 10 } })).toBeUndefined();
});

it('画板把最新内容所在分支和最新子节点排最下面，不改变身份层级', () => {
  const mark = (updated: number) => ({ created: 1, updated, createdAt: 't', updatedAt: 't' });
  const data = [
    { ...nodes[0], timeline: mark(1) },
    { ...nodes[0], id: 'other', timeline: mark(2) },
    { ...nodes[0], id: 'older', parentId: 'a', timeline: mark(3) },
    { ...nodes[0], id: 'latest', parentId: 'a', timeline: mark(9) },
  ];
  const tree = toMindTree('书', data, new Set());
  expect(tree.children.map(item => item.data.uid)).toEqual(['other', 'a']);
  expect(tree.children[1].children.map(item => item.data.uid)).toEqual(['older', 'latest']);
  expect(data[0].id).toBe('a');
});

it('时间线不受旧自由拖拽坐标覆盖，但不会删除持久化坐标', () => {
  const data = [{ ...nodes[0], position: { x: 99, y: -1000 }, timeline: { created: 1, updated: 1, createdAt: 't', updatedAt: 't' } }];
  const tree = toMindTree('书', data, new Set());expect(tree.children[0].data).not.toHaveProperty('customTop');
  expect(data[0].position).toEqual({ x: 99, y: -1000 });
});
