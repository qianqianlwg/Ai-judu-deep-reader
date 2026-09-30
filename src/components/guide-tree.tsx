"use client";
import { useRef, type KeyboardEvent } from "react";
import { guideRows } from "@/lib/guide-view";
import type { GuideNode } from "@/lib/guide";
import styles from "./guide-workspace.module.css";
type Props = {
  nodes: GuideNode[];
  selected: string | null;
  expanded: Set<string>;
  query: string;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
};
export function GuideTree({
  nodes,
  selected,
  expanded,
  query,
  onSelect,
  onToggle,
}: Props) {
  const ref = useRef<HTMLDivElement>(null),
    rows = guideRows(nodes, expanded, query);
  function keyboard(event: KeyboardEvent<HTMLDivElement>, index: number) {
    const row = rows[index];
    let target = index;
    if (event.key === "ArrowDown")
      target = Math.min(rows.length - 1, index + 1);
    else if (event.key === "ArrowUp") target = Math.max(0, index - 1);
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = rows.length - 1;
    else if (event.key === "ArrowRight") {
      if (row.childCount && !expanded.has(row.node.id) && !query)
        onToggle(row.node.id);
      else if (row.childCount) target = index + 1;
    } else if (event.key === "ArrowLeft") {
      if (expanded.has(row.node.id) && !query) onToggle(row.node.id);
      else if (row.node.parentId)
        target = rows.findIndex((item) => item.node.id === row.node.parentId);
    } else if (event.key === "Enter" || event.key === " ")
      onSelect(row.node.id);
    else return;
    event.preventDefault();
    if (target >= 0 && target !== index) {
      onSelect(rows[target].node.id);
      ref.current
        ?.querySelectorAll<HTMLElement>('[role="treeitem"]')
        [target]?.focus();
    }
  }
  return (
    <div
      ref={ref}
      className={styles.tree}
      role="tree"
      aria-label="本书主题提纲"
    >
      {rows.map(
        ({ node, depth, childCount, siblingIndex, siblingCount }, index) => (
          <div
            key={node.id}
            className={`${styles.treeRow} ${selected === node.id ? styles.selected : ""}`}
            role="treeitem"
            aria-label={node.title}
            aria-level={depth + 1}
            aria-posinset={siblingIndex}
            aria-setsize={siblingCount}
            aria-selected={selected === node.id}
            aria-expanded={
              childCount ? Boolean(query || expanded.has(node.id)) : undefined
            }
            tabIndex={
              selected === node.id ||
              (!rows.some((row) => row.node.id === selected) && index === 0)
                ? 0
                : -1
            }
            onClick={() => onSelect(node.id)}
            onKeyDown={(event) => keyboard(event, index)}
            style={{ marginLeft: `${Math.min(depth, 12) * 22}px` }}
          >
            <button
              type="button"
              tabIndex={-1}
              className={styles.branchToggle}
              aria-label={
                (expanded.has(node.id) ? "收起" : "展开") + node.title
              }
              disabled={!childCount}
              onClick={(event) => {
                event.stopPropagation();
                onToggle(node.id);
              }}
            >
              {childCount ? (query || expanded.has(node.id) ? "⌄" : "›") : "·"}
            </button>
            <div className={styles.nodeText}>
              <strong>{node.title}</strong>
              {node.summary && <span>{node.summary}</span>}
            </div>
            <small className={styles.nodeCount} title="直接关联的句读依据">
              {node.sourceIds.length
                ? `${node.sourceIds.length} 则`
                : childCount
                  ? `${childCount} 个子主题`
                  : "个人整理"}
            </small>
          </div>
        ),
      )}
      {!rows.length && query && (
        <p className={styles.searchEmpty}>
          没有找到“{query}”，试试主题名或归纳中的词。
        </p>
      )}
    </div>
  );
}
