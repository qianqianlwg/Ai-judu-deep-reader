"use client";

import { useState, type FormEvent } from "react";
import type { Analysis, ChatMessage } from "@/lib/chat-stream";
import styles from "./message-actions.module.css";

type CopyableMessage = Pick<ChatMessage, "role" | "content" | "analysis" | "outputFormat">;
export type MessageActionsProps = {
  message: CopyableMessage & { id?: string };
  editingDisabled?: boolean;
  onEditMessage?: (userMessageId: string, newPrompt: string) => void;
};

function analysisText(analysis: Analysis): string {
  const sections: string[] = [];
  if (analysis.readingText?.trim()) sections.push("句读文本\n" + analysis.readingText.trim());
  if (analysis.summary.trim()) sections.push(analysis.summary.trim());
  if (analysis.breakdown.length) sections.push("句读要点\n" + analysis.breakdown.map(item => item.label + "：" + item.text).join("\n"));
  if (analysis.concepts.length) sections.push("关键概念\n" + analysis.concepts.map(item => item.name + "：" + item.text).join("\n"));
  if (analysis.context.trim()) sections.push("上下文\n" + analysis.context.trim());
  if (analysis.uncertainty.trim()) sections.push("说明\n" + analysis.uncertainty.trim());
  return sections.join("\n\n");
}
function legacyReadable(value: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const item = parsed as Partial<Analysis>;
    if (typeof item.summary !== "string" || !Array.isArray(item.breakdown) || !Array.isArray(item.concepts) || typeof item.context !== "string" || typeof item.uncertainty !== "string") return undefined;
    const normalized: Analysis = {
      readingText: typeof item.readingText === "string" ? item.readingText : undefined,
      summary: item.summary,
      breakdown: item.breakdown.filter((part): part is { label: string; text: string } => Boolean(part && typeof part === "object" && typeof part.label === "string" && typeof part.text === "string")),
      concepts: item.concepts.filter((part): part is { name: string; text: string } => Boolean(part && typeof part === "object" && typeof part.name === "string" && typeof part.text === "string")),
      context: item.context,
      uncertainty: item.uncertainty,
      citations: [],
    };
    return analysisText(normalized);
  } catch { return undefined; }
}

export function readableAssistantText(message: CopyableMessage): string {
  if (message.analysis) return analysisText(message.analysis);
  const content = message.content.trim();
  if (message.outputFormat === "legacy-json" || content.startsWith("{")) return legacyReadable(content) ?? message.content;
  return message.content;
}

async function copyText(text: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("当前环境不支持复制，请手动选择文本复制");
  await navigator.clipboard.writeText(text);
}

export function MessageActions({ message, editingDisabled = false, onEditMessage }: MessageActionsProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [feedback, setFeedback] = useState("");

  if (message.role === "user") {
    const canEdit = Boolean(message.id && onEditMessage && !editingDisabled);
    if (editing) return <form className={styles.editor} onSubmit={(event: FormEvent) => {
      event.preventDefault();
      const prompt = draft.trim();
      if (!prompt) { setFeedback("问题不能为空"); return; }
      if (!message.id || !onEditMessage) { setFeedback("当前消息暂不可编辑"); return; }
      onEditMessage(message.id, prompt); setEditing(false); setFeedback("");
    }}>
      <textarea aria-label="编辑原始问题" value={draft} onChange={event => setDraft(event.target.value)} disabled={editingDisabled} />
      <div className={styles.editorActions}><button type="button" onClick={() => { setEditing(false); setFeedback(""); }} disabled={editingDisabled}>取消</button><button type="submit" disabled={editingDisabled}>保存修改</button></div>
      {feedback && <p className={styles.feedback} role="alert">{feedback}</p>}
    </form>;
    return <div className={styles.actions}><button type="button" aria-label="编辑原始问题" title={editingDisabled ? "生成中不能编辑" : "编辑原始问题"} disabled={!canEdit} onClick={() => { setDraft(message.content); setEditing(true); setFeedback(""); }}>编辑</button></div>;
  }

  if (!message.content && !message.analysis) return null;
  return <div className={styles.actions}>
    <button type="button" aria-label="复制回答" onClick={() => { setFeedback(""); void copyText(readableAssistantText(message)).then(() => setFeedback("已复制")).catch(error => setFeedback(error instanceof Error ? error.message : "复制失败，请重试")); }}>复制</button>
    {feedback && <span className={styles.feedback} role="status">{feedback}</span>}
  </div>;
}
