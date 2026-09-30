import type { GuideNode } from "./guide";
export type GuideRow = { node: GuideNode; depth: number; childCount: number; siblingIndex: number; siblingCount: number };
export function guideRows(nodes: readonly GuideNode[], expanded: ReadonlySet<string>, query: string): GuideRow[] {
  const children = new Map<string | null, GuideNode[]>(), byId = new Map(nodes.map(node => [node.id, node]));
  for (const node of nodes) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  const needle = query.trim().toLocaleLowerCase(), allowed = new Set<string>();
  if (needle) for (const node of nodes) if ((node.title + " " + node.summary).toLocaleLowerCase().includes(needle)) {
    let current: GuideNode | undefined = node;
    while (current && !allowed.has(current.id)) { allowed.add(current.id); current = current.parentId ? byId.get(current.parentId) : undefined; }
  }
  const result: GuideRow[] = [], roots = children.get(null) ?? [];
  const stack = roots.map((node, index) => ({ node, depth: 0, siblingIndex: index + 1, siblingCount: roots.length })).reverse();
  while (stack.length) {
    const row = stack.pop()!;
    if (needle && !allowed.has(row.node.id)) continue;
    const below = children.get(row.node.id) ?? [];
    result.push({ ...row, childCount: below.length });
    if (needle || expanded.has(row.node.id)) stack.push(...below.map((node, index) => ({ node, depth: row.depth + 1, siblingIndex: index + 1, siblingCount: below.length })).reverse());
  }
  return result;
}
export function guidePath(nodes: readonly GuideNode[], id: string): string {
  const byId = new Map(nodes.map(node => [node.id, node])), parts: string[] = [];
  let node = byId.get(id);
  while (node) { parts.unshift(node.title); node = node.parentId ? byId.get(node.parentId) : undefined; }
  return parts.join(" / ");
}
export function guideMarkdown(title: string, nodes: readonly GuideNode[]): string {
  const rows = guideRows(nodes, new Set(nodes.map(node => node.id)), "");
  return `# ${title} · 思维导读\n\n仅依据已完成的句读整理，非全书摘要。\n\n` + rows.map(({ node, depth }) => `${"  ".repeat(depth)}- **${node.title.replace(/\*/gu, "")}**${node.summary ? "：" + node.summary.replace(/\n/gu, " ") : ""}`).join("\n");
}
