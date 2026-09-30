"use client";
import { useEffect, useMemo, useState } from "react";
import {
  guideDescendants,
  type GuideCommand,
  type GuideNode,
} from "@/lib/guide";
import { anchorParts, readReadingAnchor } from "@/lib/reading-anchors";
import { isRecord } from "@/lib/chat-stream";
import type { GuideSource } from "@/lib/guide-sources";
import { guidePath } from "@/lib/guide-view";
import { GuideNodeEditor, GuideStructureEditor } from "./guide-node-editor";
import styles from "./guide-workspace.module.css";
export type GuideInspectorProps = {
  initialMode?: "read" | "edit";
  bookId: string;
  node: GuideNode;
  nodes: GuideNode[];
  version: number;
  busy: boolean;
  onCommand: (command: GuideCommand, version?: number) => Promise<boolean>;
  onClose: () => void;
  onCreate: (parentId: string) => void;
  onOpenSource: (source: GuideSource, conversation: boolean) => void;
};
export function GuideInspector({
  initialMode = "read",
  bookId,
  node,
  nodes,
  version,
  busy,
  onCommand,
  onClose,
  onCreate,
  onOpenSource,
}: GuideInspectorProps) {
  const [mode, setMode] = useState<"read" | "edit" | "structure">(initialMode),
    [sources, setSources] = useState<GuideSource[]>([]),
    [error, setError] = useState(""),
    [limit, setLimit] = useState(8),
    [retry, setRetry] = useState(0);
  const ids = useMemo(() => {
    const descendants = guideDescendants(nodes, node.id);
    return [
      ...new Set(
        nodes
          .filter((item) => descendants.has(item.id))
          .flatMap((item) => item.sourceIds),
      ),
    ];
  }, [nodes, node.id]);
  const idsKey = ids.slice(0, limit).join("\n");
  useEffect(() => {
    const abort = new AbortController();
    const selectedIds = idsKey ? idsKey.split("\n") : [];
    if (!selectedIds.length) return;
    void (async () => {
      try {
        const collected: unknown[] = [];
        // WHY：一书的依据可能超过单请求限制；分批读取，不在100条后截断来源。
        for (let offset = 0; offset < selectedIds.length; offset += 32) {
        const query = new URLSearchParams();
        for (const id of selectedIds.slice(offset, offset + 32)) query.append("sourceId", id);
        const response = await fetch(
          `/api/books/${encodeURIComponent(bookId)}/guide?${query}`,
          { signal: abort.signal },
        );
        const value: unknown = await response.json();
        if (!response.ok || !isRecord(value) || !Array.isArray(value.sources))
          throw new Error("暂时无法读取句读依据，请重试");
        collected.push(...value.sources);
        }
        const checked: GuideSource[] = collected.map((item: unknown) => {
          if (
            !isRecord(item) ||
            typeof item.id !== "string" ||
            item.bookId !== bookId ||
            typeof item.editionId !== "string" ||
            typeof item.threadId !== "string" ||
            typeof item.messageId !== "string" ||
            typeof item.chapterId !== "string" ||
            typeof item.chapterTitle !== "string" ||
            typeof item.createdAt !== "string"
          )
            throw new Error("句读依据身份不完整");
          const anchor = readReadingAnchor(item.anchor);
          if (!anchor) throw new Error("句读依据位置不完整");
          return {
            id: item.id,
            bookId,
            editionId: item.editionId,
            threadId: item.threadId,
            messageId: item.messageId,
            anchor,
            chapterTitle: item.chapterTitle,
            chapterId: item.chapterId,
            createdAt: item.createdAt,
          };
        });
        if (!abort.signal.aborted) {
          setSources(checked);
          setError("");
        }
      } catch (cause: unknown) {
        if (!abort.signal.aborted) {
          console.error("读取导读依据失败", cause);
          setError(cause instanceof Error ? cause.message : "读取依据失败");
        }
      }
    })();
    return () => abort.abort();
  }, [bookId, idsKey, retry]);
  const props = {
    node,
    nodes,
    version,
    busy,
    onCommand,
    onClose: () => setMode("read"),
  };
  return (
    <aside className={styles.inspector} aria-label="主题详情">
      <div className={styles.inspectorTop}>
        <span>主题详情</span>
        <button aria-label="关闭主题详情" onClick={onClose}>
          ×
        </button>
      </div>
      {mode === "edit" ? (
        <GuideNodeEditor {...props} />
      ) : mode === "structure" ? (
        <GuideStructureEditor {...props} />
      ) : (
        <>
          <p className={styles.breadcrumb}>{guidePath(nodes, node.id)}</p>
          <h2>{node.title}</h2>
          <div className={styles.nodeActions}>
            <button onClick={() => setMode("edit")}>编辑内容</button>
            <button onClick={() => setMode("structure")}>整理结构</button>
            <button onClick={() => onCreate(node.id)}>添加子主题</button>
          </div>
          {node.summary ? (
            <div className={styles.summary}>{node.summary}</div>
          ) : (
            <p className={styles.hint}>
              这个主题还没有归纳，可以编辑内容，或继续句读让它生长。
            </p>
          )}
          <div className={styles.evidenceHeading}>
            <h3>原文依据</h3>
            <span>
              {ids.length} 则句读
              {ids.length > node.sourceIds.length ? " · 含子主题" : ""}
            </span>
          </div>
          <p className={styles.hint}>归纳可以修改，原文仍保留它自己的声音。</p>
          {error && (
            <p className={styles.inlineNotice} role="alert">
              {error}
              <button onClick={() => setRetry((value) => value + 1)}>
                重试
              </button>
            </p>
          )}
          {!ids.length && (
            <p className={styles.hint}>目前是个人整理，尚未关联已句读选文。</p>
          )}
          {ids.length > 0 && sources.length === 0 && !error && (
            <p role="status" className={styles.hint}>
              正在读取依据…
            </p>
          )}
          {sources
            .filter((source) => ids.includes(source.id))
            .map((source, index) => (
              <details
                key={source.id}
                className={styles.evidence}
                open={index === 0}
              >
                <summary>
                  <span>{String(index + 1).padStart(2, "0")}</span>{" "}
                  {source.chapterTitle || "已句读选文"}
                </summary>
                <blockquote>
                  {anchorParts(source.anchor)
                    .map((part) => part.selectedText)
                    .join("\n\n")}
                </blockquote>
                <div className={styles.sourceActions}>
                  <button onClick={() => onOpenSource(source, false)}>
                    打开原文 ↗
                  </button>
                  <button onClick={() => onOpenSource(source, true)}>
                    打开句读 ↗
                  </button>
                </div>
              </details>
            ))}
          {ids.length > limit && (
            <button
              onClick={() => setLimit((value) => value + 8)}
            >
              查看更多依据
            </button>
          )}
          <p className={styles.footnote}>
            仅来自已经句读的选文 · AI 归纳请结合原文理解
          </p>
        </>
      )}
    </aside>
  );
}
