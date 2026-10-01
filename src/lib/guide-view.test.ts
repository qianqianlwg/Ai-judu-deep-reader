import { expect, it } from "vitest";
import { guideMarkdown, guidePath, guideRows } from "./guide-view";
const nodes = [{ id: "a", parentId: null, title: "实践", summary: "来源", sourceIds: [] }, { id: "b", parentId: "a", title: "认识", summary: "进一步理解", sourceIds: [] }];
it("折叠、展开、搜索包含祖先链", () => { expect(guideRows(nodes, new Set(), "")).toHaveLength(1); expect(guideRows(nodes, new Set(["a"]), "")).toHaveLength(2); expect(guideRows(nodes, new Set(), "认识").map(row => row.node.id)).toEqual(["a", "b"]); expect(guideRows(nodes, new Set(), "不存在")).toEqual([]); });
it("节点路径与Markdown保持层级", () => { expect(guidePath(nodes, "b")).toBe("实践 / 认识"); expect(guideMarkdown("书", nodes)).toContain("  - **认识**"); });

it('提纲与画板同样按分支最新内容排，Markdown保留父子关系', () => {
  const mark = (updated: number) => ({ created: 1, updated, createdAt: 't', updatedAt: 't' });
  const data = [
    { ...nodes[0], timeline: mark(1) }, { ...nodes[0], id: 'other', title: '中间', timeline: mark(2) },
    { ...nodes[1], timeline: mark(9) },
  ];
  expect(guideRows(data, new Set(['a']), '').map(item => item.node.id)).toEqual(['other', 'a', 'b']);
  expect(guideMarkdown('书', data).indexOf('**中间**')).toBeLessThan(guideMarkdown('书', data).indexOf('**实践**'));
});
