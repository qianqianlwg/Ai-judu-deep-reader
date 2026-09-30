import { z } from "zod";

export const guidePositionSchema = z.object({ x: z.number().finite().min(-1000000).max(1000000), y: z.number().finite().min(-1000000).max(1000000) }).strict();
const id = z.string().min(1).max(160);
export const guideNodeSchema = z.object({
  id, parentId: id.nullable(), title: z.string().trim().min(1).max(160),
  summary: z.string().max(6000), position: guidePositionSchema.optional(), sourceIds: z.array(id).max(4000),
}).strict();
export type GuideNode = z.infer<typeof guideNodeSchema>;
export const guideNodesSchema = z.array(guideNodeSchema).max(10000);
export const guideCanvasNodeSchema = z.object({ id, parentId: id.nullable(), title: z.string().trim().min(1).max(160), position: guidePositionSchema.optional() }).strict();
export type GuideCanvasNode = z.infer<typeof guideCanvasNodeSchema>;
export const guideChangeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("canvas"), nodes: z.array(guideCanvasNodeSchema).max(10000) }).strict(),
  z.object({ type: z.literal("layout"), positions: z.array(z.object({ id, position: guidePositionSchema }).strict()).max(10000), reset: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("create"), node: guideNodeSchema }).strict(),
  z.object({ type: z.literal("edit"), id, title: z.string().trim().min(1).max(160), summary: z.string().max(6000), sourceIds: z.array(id).max(4000).optional() }).strict(),
  z.object({ type: z.literal("move"), id, parentId: id.nullable(), beforeId: id.nullable() }).strict(),
  z.object({ type: z.literal("merge"), id, targetId: id }).strict(),
  z.object({ type: z.literal("remove"), id }).strict(),
]);
export type GuideChange = z.infer<typeof guideChangeSchema>;
export class GuideError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); this.name = "GuideError"; }
}
export function validateGuide(nodes: GuideNode[], sourceIds?: ReadonlySet<string>): GuideNode[] {
  guideNodesSchema.parse(nodes);
  const byId = new Map(nodes.map(node => [node.id, node]));
  if (byId.size !== nodes.length) throw new GuideError("节点编号重复，请刷新后重试");
  for (const node of nodes) {
    if (node.id === "__judu-guide-root__") throw new GuideError("此节点编号为书籍根节点保留");
    if (node.parentId && !byId.has(node.parentId)) throw new GuideError("父主题不存在，未保存此次调整");
    if (sourceIds && node.sourceIds.some(source => !sourceIds.has(source))) throw new GuideError("引用必须来自本书已完成的句读");
  }
  // WHY：一书一图会持续变大；每条父链只核验一次，避免深树在轮询和保存时反复遍历全部祖先。
  const completed = new Set<string>();
  for (const node of nodes) {
    const path = new Set<string>();
    let current: string | null = node.id;
    while (current && !completed.has(current)) {
      if (path.has(current)) throw new GuideError("不能把主题放进自身或其子主题");
      path.add(current);
      current = byId.get(current)!.parentId;
    }
    for (const id of path) completed.add(id);
  }
  return nodes.map(node => ({ ...node, sourceIds: [...new Set(node.sourceIds)] }));
}
export function guideDescendants(nodes: readonly GuideNode[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = children.get(node.parentId);
    if (siblings) siblings.push(node.id);
    else children.set(node.parentId, [node.id]);
  }
  const ids = new Set<string>(), pending = [id];
  while (pending.length) {
    const current = pending.pop()!;
    if (ids.has(current)) continue;
    ids.add(current);
    for (const child of children.get(current) ?? []) pending.push(child);
  }
  return ids;
}
export function changeGuide(current: readonly GuideNode[], change: GuideChange): { nodes: GuideNode[]; reason: string } {
  let nodes = current.map(node => ({ ...node, sourceIds: [...node.sourceIds] }));
  const selected = change.type === "create" || change.type === "layout" || change.type === "canvas" ? undefined : nodes.find(node => node.id === change.id);
  if (change.type !== "create" && change.type !== "layout" && change.type !== "canvas" && !selected) throw new GuideError("此节点已变化，请刷新后再编辑", 409);
  let reason = "";
  switch (change.type) {
    case "canvas": {
      const previous = new Map(nodes.map(node => [node.id, node]));
      nodes = change.nodes.map(item => ({ ...item, summary: previous.get(item.id)?.summary ?? "", sourceIds: previous.get(item.id)?.sourceIds ?? [] }));
      reason = "编辑思维导图画板"; break;
    }
    case "layout": {
      const positions = new Map(change.positions.map(item => [item.id, item.position]));
      if (positions.size !== change.positions.length || [...positions.keys()].some(id => !nodes.some(node => node.id === id))) throw new GuideError("画板节点已变化，请重新调整", 409);
      nodes = nodes.map(node => { const { position, ...rest } = node; return change.reset ? rest : { ...rest, ...(positions.has(node.id) ? { position: positions.get(node.id) } : position ? { position } : {}) }; });
      reason = change.reset ? "自动整理画板布局" : "调整节点位置"; break;
    }
    case "create": nodes.push(change.node); reason = `新增「${change.node.title}」`; break;
    case "edit": Object.assign(selected!, { title: change.title, summary: change.summary, ...(change.sourceIds ? { sourceIds: change.sourceIds } : {}) }); reason = `编辑「${change.title}」`; break;
    case "move": {
      if (change.beforeId === change.id) throw new GuideError("不能移动到自身之前");
      const before = change.beforeId ? nodes.find(node => node.id === change.beforeId) : undefined;
      if (change.beforeId && (!before || before.parentId !== change.parentId)) throw new GuideError("目标位置已变化，请重新选择");
      const movedIds = guideDescendants(nodes, change.id);
      selected!.parentId = change.parentId;
      for (const node of nodes) if (movedIds.has(node.id)) delete node.position;
      nodes = nodes.filter(node => node.id !== change.id);
      nodes.splice(before ? nodes.findIndex(node => node.id === before.id) : nodes.length, 0, selected!);
      reason = `移动「${selected!.title}」`; break;
    }
    case "merge": {
      const target = nodes.find(node => node.id === change.targetId);
      if (!target || guideDescendants(nodes, change.id).has(change.targetId)) throw new GuideError("不能合并到自身或下级主题");
      target.summary = [target.summary, selected!.summary].filter(Boolean).join("\n\n");
      target.sourceIds = [...new Set([...target.sourceIds, ...selected!.sourceIds])];
      nodes = nodes.filter(node => node.id !== change.id).map(node => node.parentId === change.id ? { ...node, parentId: target.id } : node);
      reason = `将「${selected!.title}」合并至「${target.title}」`; break;
    }
    case "remove": { const ids = guideDescendants(nodes, change.id); nodes = nodes.filter(node => !ids.has(node.id)); reason = `移除「${selected!.title}」及其子主题`; break; }
  }
  return { nodes: validateGuide(nodes), reason };
}
export const guidePatchSchema = z.object({
  reason: z.string().trim().min(1).max(600),
  upserts: z.array(guideNodeSchema).max(200), removeIds: z.array(id).max(200),
}).strict();
export type GuidePatch = z.infer<typeof guidePatchSchema>;
export function applyGuidePatch(current: readonly GuideNode[], patch: GuidePatch, sources: ReadonlySet<string>): GuideNode[] {
  const updates = new Map(patch.upserts.map(node => [node.id, node]));
  if (updates.size !== patch.upserts.length) throw new GuideError("AI 返回了重复节点");
  if (patch.removeIds.some(id => updates.has(id) || !current.some(node => node.id === id))) throw new GuideError("AI 返回的删除节点不一致");
  const deleted = new Set(patch.removeIds);
  const nodes = current.filter(node => !deleted.has(node.id)).map(node => { const update = updates.get(node.id); return update ? { ...update, ...(update.position ? {} : update.parentId === node.parentId && node.position ? { position: node.position } : {}) } : node; });
  nodes.push(...patch.upserts.filter(node => !current.some(old => old.id === node.id)));
  return validateGuide(nodes, sources);
}
export type GuideRevision = { id: number; actor: "user" | "ai"; reason: string; createdAt: string; current: boolean };
export type GuideState = { bookId: string; title: string; version: number; nodes: GuideNode[]; canUndo: boolean; canRedo: boolean; revisions: GuideRevision[]; pending: number; failed: number; processed: number; lastError: string | null; updatedAt: string | null; historicalCount: number };
export const guideStateSchema = z.object({
  bookId: z.string(), title: z.string(), version: z.number().int().nonnegative(), nodes: guideNodesSchema,
  canUndo: z.boolean(), canRedo: z.boolean(), revisions: z.array(z.object({ id: z.number(), actor: z.enum(["user", "ai"]), reason: z.string(), createdAt: z.string(), current: z.boolean() })),
  pending: z.number(), failed: z.number(), processed: z.number(), lastError: z.string().nullable(), updatedAt: z.string().nullable(), historicalCount: z.number(),
});
export type GuideCommand = { action: "change"; change: GuideChange } | { action: "undo" | "redo" | "retry" | "import-history" } | { action: "restore"; revisionId: number };
