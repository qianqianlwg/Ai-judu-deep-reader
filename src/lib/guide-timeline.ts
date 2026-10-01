import { z } from 'zod';
import type { GuideNode } from './guide';
export const guideTimelineSchema = z.object({
  created: z.number().int().nonnegative(), updated: z.number().int().nonnegative(),
  createdAt: z.string().min(1), updatedAt: z.string().min(1),
}).strict();
export type GuideTimeline = z.infer<typeof guideTimelineSchema>;
function changedContent(before: GuideNode, after: GuideNode): boolean {
  return before.title !== after.title || before.summary !== after.summary || before.sourceIds.length !== after.sourceIds.length || after.sourceIds.some(id => !before.sourceIds.includes(id));
}
export function stampGuideTimeline(nodes: readonly GuideNode[], previous: readonly GuideNode[], revision: number, actor: 'user' | 'ai', time: string): GuideNode[] {
  const old = new Map(previous.map(node => [node.id, node]));
  return nodes.map((node, index) => {
    const before = old.get(node.id), order = revision * 10001 + index;
    // WHY：时间由真实版本事务记录，Agent和画板工具不能提交；移动、排版、仅重排来源均不制造新的阅读内容。
    const initial = before?.timeline ?? node.timeline ?? { created: order, updated: order, createdAt: time, updatedAt: time };
    const timeline = actor === 'ai' && before && changedContent(before, node) ? { ...initial, updated: order, updatedAt: time } : actor === 'user' && node.timeline ? node.timeline : initial;
    return { ...node, sourceIds: [...node.sourceIds], timeline: { ...timeline } };
  });
}
export function newestGuideNode(nodes: readonly GuideNode[]): GuideNode | undefined {
  let newest: GuideNode | undefined, order = -1;
  const max = Math.max(0, ...nodes.map(node => node.timeline?.updated ?? 0));
  nodes.forEach((node, index) => { const score = node.timeline?.updated ?? max + index + 1; if (score >= order) { newest = node; order = score; } });
  return newest;
}
export function chronologicalGuideNodes(nodes: readonly GuideNode[]): GuideNode[] {
  const byId = new Map(nodes.map(node => [node.id, node])), children = new Map<string, number>();
  const base = Math.max(0, ...nodes.map(node => node.timeline?.updated ?? 0));
  const score = new Map(nodes.map((node, index) => [node.id, node.timeline?.updated ?? base + index + 1]));
  for (const node of nodes) if (node.parentId) children.set(node.parentId, (children.get(node.parentId) ?? 0) + 1);
  const pending = nodes.filter(node => !children.has(node.id)).map(node => node.id);
  for (let index = 0; index < pending.length; index++) {
    const node = byId.get(pending[index])!;
    if (!node.parentId) continue;
    if (!byId.has(node.parentId)) throw new Error('时间线的父主题缺失');
    score.set(node.parentId, Math.max(score.get(node.parentId)!, score.get(node.id)!));
    const remaining = children.get(node.parentId)! - 1; children.set(node.parentId, remaining);
    if (!remaining) pending.push(node.parentId);
  }
  if (pending.length !== nodes.length) throw new Error('时间线的主题层级存在循环或重复');
  // WHY：按整条分支的最新内容排序，新的深层句读也带着其祖先分支排在最后；不拆散父子关系、不按标题或坐标排序。
  const index = new Map(nodes.map((node, index) => [node.id, index]));
  return [...nodes].sort((a, b) => score.get(a.id)! - score.get(b.id)! || index.get(a.id)! - index.get(b.id)!);
}
