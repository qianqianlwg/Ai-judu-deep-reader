"use client";
import { useState } from "react";
import {
  guideDescendants,
  type GuideCommand,
  type GuideNode,
} from "@/lib/guide";
import { guidePath } from "@/lib/guide-view";
import styles from "./guide-workspace.module.css";
type Props = {
  node: GuideNode;
  nodes: GuideNode[];
  version: number;
  busy: boolean;
  creating?: boolean;
  onCommand: (command: GuideCommand, version?: number) => Promise<boolean>;
  onClose: () => void;
};
export function GuideNodeEditor({
  node,
  nodes,
  version,
  busy,
  creating = false,
  onCommand,
  onClose,
}: Props) {
  const [title, setTitle] = useState(node.title),
    [summary, setSummary] = useState(node.summary),
    [parentId, setParent] = useState(node.parentId ?? "");
  const [baseVersion, setBaseVersion] = useState(version);
  const changedOutside = baseVersion !== version;
  return (
    <form
      className={styles.editor}
      onSubmit={async (event) => {
        event.preventDefault();
        if (changedOutside) {
          setBaseVersion(version);
          return;
        }
        const change = creating
          ? {
              type: "create" as const,
              node: { ...node, title, summary, parentId: parentId || null },
            }
          : { type: "edit" as const, id: node.id, title, summary };
        if (await onCommand({ action: "change", change }, baseVersion))
          onClose();
      }}
    >
      <h3>{creating ? "添加主题" : "编辑节点"}</h3>
      <label>
        标题
        <input
          autoFocus
          required
          maxLength={160}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="一个清晰的主题"
        />
      </label>
      <label>
        内容
        <textarea
          rows={9}
          maxLength={6000}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="记录这个主题的核心理解…"
        />
      </label>
      {creating && (
        <label>
          放在
          <select
            value={parentId}
            onChange={(event) => setParent(event.target.value)}
          >
            <option value="">全书 · 顶层主题</option>
            {nodes.map((item) => (
              <option key={item.id} value={item.id}>
                {guidePath(nodes, item.id)}
              </option>
            ))}
          </select>
        </label>
      )}
      {changedOutside && (
        <p className={styles.inlineNotice}>
          导读有新的更新，你的草稿已保留。请核对后继续保存。
        </p>
      )}
      <p className={styles.hint}>AI 会继续维护这份导读。所有改动都可以撤销。</p>
      <div className={styles.actions}>
        <button type="button" onClick={onClose} disabled={busy}>
          取消
        </button>
        <button className={styles.primary} disabled={busy || !title.trim()}>
          {busy ? "保存中…" : changedOutside ? "已核对，继续" : "保存修改"}
        </button>
      </div>
    </form>
  );
}
export function GuideStructureEditor({
  node,
  nodes,
  version,
  busy,
  onCommand,
  onClose,
}: Props) {
  const [parent, setParent] = useState(node.parentId ?? ""),
    [before, setBefore] = useState(""),
    [target, setTarget] = useState(""),
    [confirm, setConfirm] = useState<"merge" | "remove" | null>(null);
  const descendants = guideDescendants(nodes, node.id),
    choices = nodes.filter((item) => !descendants.has(item.id));
  const siblings = choices.filter((item) => item.parentId === (parent || null));
  return (
    <section className={styles.editor} aria-label="整理节点结构">
      <h3>整理结构</h3>
      <p className={styles.hint}>
        调整「{node.title}」的位置，子主题会一起移动。
      </p>
      <label>
        移至
        <select
          value={parent}
          onChange={(event) => {
            setParent(event.target.value);
            setBefore("");
          }}
        >
          <option value="">全书 · 顶层主题</option>
          {choices.map((item) => (
            <option key={item.id} value={item.id}>
              {guidePath(nodes, item.id)}
            </option>
          ))}
        </select>
      </label>
      <label>
        排列位置
        <select
          value={before}
          onChange={(event) => setBefore(event.target.value)}
        >
          <option value="">放在最后</option>
          {siblings.map((item) => (
            <option key={item.id} value={item.id}>
              在「{item.title}」之前
            </option>
          ))}
        </select>
      </label>
      <button
        className={styles.primary}
        disabled={busy}
        onClick={async () => {
          if (
            await onCommand(
              {
                action: "change",
                change: {
                  type: "move",
                  id: node.id,
                  parentId: parent || null,
                  beforeId: before || null,
                },
              },
              version,
            )
          )
            onClose();
        }}
      >
        保存位置
      </button>
      <hr />
      <h4>合并重复主题</h4>
      <label>
        合并到
        <select
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
            setConfirm(null);
          }}
        >
          <option value="">选择目标主题</option>
          {choices.map((item) => (
            <option key={item.id} value={item.id}>
              {guidePath(nodes, item.id)}
            </option>
          ))}
        </select>
      </label>
      <button disabled={busy || !target} onClick={() => setConfirm("merge")}>
        合并到此主题
      </button>
      <hr />
      <button
        className={styles.danger}
        disabled={busy}
        onClick={() => setConfirm("remove")}
      >
        移除此主题
        {descendants.size > 1 ? `及 ${descendants.size - 1} 个子主题` : ""}
      </button>
      {confirm && (
        <div className={styles.confirm} role="alert">
          <p>
            {confirm === "merge"
              ? "内容、子主题与原文依据都会保留在目标主题下。"
              : "仅从导读中移除，不删除书籍或句读记录。"}
            这次操作可以撤销。
          </p>
          <div className={styles.actions}>
            <button disabled={busy} onClick={() => setConfirm(null)}>
              取消
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                if (
                  await onCommand(
                    {
                      action: "change",
                      change:
                        confirm === "merge"
                          ? { type: "merge", id: node.id, targetId: target }
                          : { type: "remove", id: node.id },
                    },
                    version,
                  )
                )
                  onClose();
              }}
            >
              确认{confirm === "merge" ? "合并" : "移除"}
            </button>
          </div>
        </div>
      )}
      <button className={styles.textButton} onClick={onClose}>
        返回节点
      </button>
    </section>
  );
}
