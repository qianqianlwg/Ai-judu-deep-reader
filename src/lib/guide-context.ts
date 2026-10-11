import { z } from 'zod';
import { GuideError, type GuideNode } from './guide';
import { newestGuideNode } from './guide-timeline';
import { estimateTextTokens } from './token-usage';
export const GUIDE_FRAMEWORK_TOKENS = 6000;
export const GUIDE_READ_DESCRIPTION = '按需查看当前导图的真实节点；action=details读取完整详情的分页（summaryOffset/summaryLimit按Unicode字符、sourceOffset/limit按来源项），action=children展开母节点的直接子节点（offset/limit分页）。nodeId=null仅用于列出书名下的二级主题。nextOffset或nextSummaryOffset/nextSourceOffset非null时可继续读取。只读同一版本快照，不生成或保存内容。';
export const guideReadSchema = z.object({
 action: z.enum(['details', 'children']), nodeId: z.string().min(1).max(160).nullable(),
 summaryLimit: z.number().int().min(50).max(1000).default(500),
 offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(20).default(10),
 summaryOffset: z.number().int().nonnegative().default(0), sourceOffset: z.number().int().nonnegative().default(0),
}).strict();
export type GuideReadRequest = z.infer<typeof guideReadSchema>;
type Entry = { node: GuideNode; level: number; branchId: string };
function indexGuide(nodes: readonly GuideNode[]) {
 const byId = new Map(nodes.map(node => [node.id, node])), children = new Map<string | null, GuideNode[]>();
 if (byId.size !== nodes.length) throw new GuideError('导图节点ID重复');
 for (const node of nodes) {
  if (node.parentId !== null && !byId.has(node.parentId)) throw new GuideError('导图父节点缺失');
  const list = children.get(node.parentId) ?? []; list.push(node); children.set(node.parentId, list);
 }
 const entries: Entry[] = (children.get(null) ?? []).map(node => ({ node, level: 2, branchId: node.id }));
 for (let i = 0; i < entries.length; i++) {
  const entry = entries[i];
  for (const node of children.get(entry.node.id) ?? []) entries.push({ node, level: entry.level + 1, branchId: entry.branchId });
 }
 if (entries.length !== nodes.length) throw new GuideError('导图层级存在循环');
 return { byId, children, entries };
}
export function latestGuideBranchId(nodes: readonly GuideNode[]): string | null {
 const { entries } = indexGuide(nodes), latest = newestGuideNode(nodes);
 return entries.find(entry => entry.node.id === latest?.id)?.branchId ?? null;
}
function content(node: GuideNode) {
 return { id: node.id, parentId: node.parentId, title: node.title, summary: node.summary, sourceIds: [...node.sourceIds] };
}
export function projectGuideFramework(nodes: readonly GuideNode[], maxTokens = GUIDE_FRAMEWORK_TOKENS) {
 const { children, entries } = indexGuide(nodes), latestBranchId = latestGuideBranchId(nodes);
 const candidates = entries.filter(entry => entry.level <= 3 || entry.branchId === latestBranchId);
 // WHY：书名是一级、parentId=null的主题是二级；最新内容所在的整条二级分支优先保留，绝不根据语义猜测或生成摘要。
 candidates.sort((a, b) => Number(b.branchId === latestBranchId) - Number(a.branchId === latestBranchId) || a.level - b.level);
 type Injected = { id: string; parentId: string | null; title: string; level: number; childCount: number; omittedChildren: number; detailsIncluded: boolean; summary?: string; sourceIds?: string[] };
 const injected: Injected[] = [], included = new Set<string>();
 let budgetLimited = false;
 const snapshot = () => ({ bookRootLevel: 1, defaultDepth: 3, latestBranchId, totalNodes: nodes.length, rootCount: children.get(null)?.length ?? 0, omittedNodes: nodes.length - injected.length, budgetLimited, nodes: injected });
 let usedTokens=estimateTextTokens(JSON.stringify(snapshot()))+32;
 for (const entry of candidates) {
  if (entry.node.parentId !== null && !included.has(entry.node.parentId)) { budgetLimited = true; continue; }
  const base = { id: entry.node.id, parentId: entry.node.parentId, title: entry.node.title, level: entry.level, childCount: children.get(entry.node.id)?.length ?? 0, omittedChildren: children.get(entry.node.id)?.length ?? 0 };
  let item:Injected={ ...base, ...content(entry.node), detailsIncluded: true };
  let cost=estimateTextTokens(JSON.stringify(item))+1;
  if (usedTokens+cost>maxTokens) {
   budgetLimited=true;item={...base,detailsIncluded:false};cost=estimateTextTokens(JSON.stringify(item))+1;
   if(usedTokens+cost>maxTokens)continue;
  }
  // WHY：大图按单节点累计估算，末尾核验真实JSON；不能对上万节点反复序列化整个已注入框架。
  injected.push(item);usedTokens+=cost;
  included.add(entry.node.id);
 }
 for (const item of injected) item.omittedChildren = (children.get(item.id) ?? []).filter(child => !included.has(child.id)).length;
 // WHY：预算只控制上下文投影，不改写持久化内容；省略数量与详情标记使Agent能明确按需展开。
 while (injected.length && estimateTextTokens(JSON.stringify(snapshot())) > maxTokens) {
  included.delete(injected.pop()!.id); budgetLimited = true;
  for (const item of injected) item.omittedChildren = (children.get(item.id) ?? []).filter(child => !included.has(child.id)).length;
 }
 return snapshot();
}
export function readGuideSnapshot(nodes: readonly GuideNode[], request: GuideReadRequest) {
 const { byId, children } = indexGuide(nodes), node = request.nodeId === null ? undefined : byId.get(request.nodeId);
 if (request.nodeId !== null && !node) throw new GuideError('找不到当前导图节点，请使用注入或展开返回的真实ID');
 if (request.action === 'children') {
  const list = children.get(request.nodeId) ?? [];
  if (request.offset > list.length) throw new GuideError('子节点分页起点超出范围');
  const items = list.slice(request.offset, request.offset + request.limit);
  return { action: 'children' as const, parentId: request.nodeId, total: list.length, offset: request.offset, nextOffset: request.offset + items.length < list.length ? request.offset + items.length : null,
   nodes: items.map(item => ({ id: item.id, parentId: item.parentId, title: item.title, childCount: children.get(item.id)?.length ?? 0 })) };
 }
 if (!node) throw new GuideError('查看详情必须提供具体节点ID，书名根节点没有分析详情');
 const chars = Array.from(node.summary);
 if (request.summaryOffset > chars.length || request.sourceOffset > node.sourceIds.length) throw new GuideError('节点详情分页起点超出范围');
 const summary = chars.slice(request.summaryOffset, request.summaryOffset + request.summaryLimit).join(''), sourceIds = node.sourceIds.slice(request.sourceOffset, request.sourceOffset + request.limit);
 // WHY：手动合并的旧摘要和来源可很长，只对真实字段做显式分页，不能截成一段伪造的新摘要。
 return { action: 'details' as const, id: node.id, parentId: node.parentId, title: node.title, summary, sourceIds, childCount: children.get(node.id)?.length ?? 0,
  summaryOffset: request.summaryOffset, summaryCharacters: chars.length, nextSummaryOffset: request.summaryOffset + Array.from(summary).length < chars.length ? request.summaryOffset + Array.from(summary).length : null,
  sourceOffset: request.sourceOffset, sourceCount: node.sourceIds.length, nextSourceOffset: request.sourceOffset + sourceIds.length < node.sourceIds.length ? request.sourceOffset + sourceIds.length : null };
}

export function readBudgetedGuideSnapshot(nodes: readonly GuideNode[], request: GuideReadRequest, maxTokens: number) {
 const page={...request};
 for(;;) {
  const snapshot=readGuideSnapshot(nodes,page);
  if(estimateTextTokens(JSON.stringify({ok:true,...snapshot}))+64<=maxTokens)return snapshot;
  // WHY：分页大小可向下调整以容纳长标题/旧来源ID；游标依据实际返回长度，不截断单个字段、不虚报已读完。
  if(page.action==='details'&&page.summaryLimit>50)page.summaryLimit=Math.max(50,Math.floor(page.summaryLimit/2));
  else if(page.limit>1)page.limit=Math.max(1,Math.floor(page.limit/2));
  else throw new GuideError('节点单页详情超过读取预算，请提高输入预算后重试');
 }
}
