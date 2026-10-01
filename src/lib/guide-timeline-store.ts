import { validateGuide, type GuideNode } from './guide';
import type { GuideDb } from './guide-store';
import { stampGuideTimeline } from './guide-timeline';
type Revision = { id: number; parent_id: number | null; nodes_json: string; actor: 'user' | 'ai'; created_at: string };
const cache = new WeakMap<GuideDb, { id: number; raw: string; nodes: GuideNode[] }>();
function readRevision(db: GuideDb, id: number): Revision {
  const row = db.prepare('SELECT id,parent_id,nodes_json,actor,created_at FROM guide_revisions WHERE id=?').get(id) as Revision | undefined;
  if (!row) throw new Error('导读版本快照丢失');
  if (row.actor !== 'user' && row.actor !== 'ai') throw new Error('导读版本作者无效');
  return row;
}
export function readTimedGuideNodes(db: GuideDb, revisionId: number | null): GuideNode[] {
  if (revisionId === null) return [];
  const current = readRevision(db, revisionId), saved = cache.get(db);
  if (saved?.id === revisionId && saved.raw === current.nodes_json) return structuredClone(saved.nodes);
  let nodes = validateGuide(JSON.parse(current.nodes_json));
  if (nodes.some(node => !node.timeline)) {
    const chain: { revision: Revision; nodes: GuideNode[] }[] = [{ revision: current, nodes }], visited = new Set([revisionId]);
    let parent = current.parent_id; nodes = [];
    // WHY：旧节点的时间来自真实版本祖先链，不根据标题、布局或来源原文猜测；只读恢复，不改写已有历史快照。
    while (parent !== null) {
      if (visited.has(parent)) throw new Error('导读版本祖先链存在循环');
      visited.add(parent);
      const revision = readRevision(db, parent), previous = validateGuide(JSON.parse(revision.nodes_json));
      if (previous.every(node => node.timeline)) { nodes = previous; break; }
      chain.push({ revision, nodes: previous }); parent = revision.parent_id;
    }
    for (const entry of chain.reverse()) nodes = stampGuideTimeline(entry.nodes, nodes, entry.revision.id, entry.revision.actor, entry.revision.created_at);
  }
  // WHY：旧快照的首次恢复只缓存当前版本，避免每次轮询扫描历史，也避免多本大图的无界版本缓存；返回副本不允许调用者篡改缓存。
  cache.set(db, { id: revisionId, raw: current.nodes_json, nodes });
  return structuredClone(nodes);
}
