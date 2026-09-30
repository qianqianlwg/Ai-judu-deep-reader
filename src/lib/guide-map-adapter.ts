import {
  guideCanvasNodeSchema,
  GuideError,
  validateGuide,
  type GuideCanvasNode,
  type GuideNode,
} from "./guide";
import { isRecord } from "./chat-stream";
export const GUIDE_ROOT_ID = "__judu-guide-root__";
export type MindTree = {
  data: {
    uid: string;
    text: string;
    expand: boolean;
    customLeft?: number;
    customTop?: number;
  };
  children: MindTree[];
};
// WHY：库仅负责画板；原文来源和归纳不交给第三方节点状态保存，避免复制、粘贴或删除时篡改阅读数据。
export function toMindTree(
  title: string,
  nodes: readonly GuideNode[],
  collapsed: ReadonlySet<string>,
): MindTree {
  const children = new Map<string | null, GuideNode[]>();
  for (const node of nodes)
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  const root: MindTree = {
    data: { uid: GUIDE_ROOT_ID, text: title, expand: true },
    children: [],
  };
  const pending = (children.get(null) ?? [])
    .map((node) => ({ node, parent: root }))
    .reverse();
  while (pending.length) {
    const { node, parent } = pending.pop()!;
    const next: MindTree = {
      data: {
        uid: node.id,
        text: node.title,
        expand: !collapsed.has(node.id),
        ...(node.position
          ? { customLeft: node.position.x, customTop: node.position.y }
          : {}),
      },
      children: [],
    };
    parent.children.push(next);
    pending.push(
      ...(children.get(node.id) ?? [])
        .map((child) => ({ node: child, parent: next }))
        .reverse(),
    );
  }
  return root;
}
export function fromMindTree(value: unknown): {
  nodes: GuideCanvasNode[];
  collapsed: Set<string>;
} {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    value.data.uid !== GUIDE_ROOT_ID ||
    !Array.isArray(value.children)
  )
    throw new GuideError("画板根节点无效，未保存");
  const nodes: GuideCanvasNode[] = [],
    collapsed = new Set<string>(),
    pending: { value: unknown; parentId: string | null }[] = value.children
      .map((value) => ({ value, parentId: null }))
      .reverse();
  while (pending.length) {
    if (nodes.length >= 10000)
      throw new GuideError("画板节点数量过多，未保存本次修改");
    const { value, parentId } = pending.pop()!;
    if (
      !isRecord(value) ||
      !isRecord(value.data) ||
      !Array.isArray(value.children)
    )
      throw new GuideError("画板节点格式不正确");
    const d = value.data;
    const node = guideCanvasNodeSchema.parse({
      id: d.uid,
      title: d.text,
      parentId,
      ...(typeof d.customLeft === "number" && typeof d.customTop === "number"
        ? { position: { x: d.customLeft, y: d.customTop } }
        : {}),
    });
    nodes.push(node);
    if (d.expand === false) collapsed.add(node.id);
    pending.push(
      ...value.children
        .map((value) => ({ value, parentId: node.id }))
        .reverse(),
    );
  }
  validateGuide(nodes.map((node) => ({ ...node, summary: "", sourceIds: [] })));
  return { nodes, collapsed };
}
export function mindCanvasSignature(nodes: readonly GuideCanvasNode[]): string {
  return JSON.stringify(
    nodes.map((node) => ({
      id: node.id,
      parentId: node.parentId,
      title: node.title,
      ...(node.position ? { position: node.position } : {}),
    })),
  );
}
export function guideMapMatches(
  nodes: readonly GuideNode[],
  query: string,
): GuideNode[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle
    ? nodes.filter((node) =>
        (node.title + " " + node.summary).toLocaleLowerCase().includes(needle),
      )
    : [];
}

// WHY：视角来自本地存储，只恢复内核需要的有限数值，不能将任意属性注入View实例。
export function parseMindView(value: unknown) {
  if (!isRecord(value) || !isRecord(value.state) || !isRecord(value.transform))
    return undefined;
  const { scale, x, y, sx, sy } = value.state;
  const { a, b, c, d, e, f } = value.transform;
  if (
    ![scale, x, y, sx, sy, a, b, c, d, e, f].every(
      (item) => typeof item === "number" && Number.isFinite(item),
    )
  )
    return undefined;
  if (typeof scale !== "number" || scale < 0.2 || scale > 2.5) return undefined;
  return { state: { scale, x, y, sx, sy }, transform: { a, b, c, d, e, f } };
}
