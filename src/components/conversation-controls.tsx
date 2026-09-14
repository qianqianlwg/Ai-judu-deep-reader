"use client";

import { useEffect, useRef, useState } from "react";
import { conversationTitle, type ConversationSummary } from "@/lib/conversations";
import styles from "./conversation-controls.module.css";

type Action = () => void | Promise<void>;
export type ConversationControlsProps = {
  conversations: ConversationSummary[]; activeThreadId?: string | null; editionId?: string;
  busy?: boolean; error?: string;
  onNewConversation?: Action;
  onSelectConversation?: (threadId: string) => void | Promise<void>;
  onRenameConversation?: (threadId: string, title: string) => void | Promise<void>;
};
export function ConversationControls({ conversations, activeThreadId, editionId, busy = false, error, onNewConversation, onSelectConversation, onRenameConversation }: ConversationControlsProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const operationRunning = useRef(false);
  const locked = busy || pending;
  const scoped = conversations.filter((conversation) => !editionId || conversation.editionId === editionId);
  const active = scoped.find((conversation) => conversation.id === activeThreadId);
  const filtered = scoped.filter((conversation) => conversation.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus({ preventScroll: true });
    const closeOutside = (event: PointerEvent) => { if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  async function perform(action?: Action) {
    if (locked || operationRunning.current || !action) return;
    // WHY：同步锁挡住同一帧双击，不能等 React 下一次渲染才阻止第二个会话操作。
    operationRunning.current = true;
    setPending(true); setLocalError("");
    try {
      await action();
      if (mounted.current) { setOpen(false); setRenaming(false); setQuery(""); }
    } catch (cause: unknown) {
      console.error("会话操作失败", cause);
      if (mounted.current) setLocalError(cause instanceof Error ? cause.message : "会话操作失败，请重试");
    } finally { operationRunning.current = false; if (mounted.current) setPending(false); }
  }
  const rename = () => {
    if (!active || !onRenameConversation || locked) return;
    try { const title = conversationTitle(draft); void perform(() => onRenameConversation(active.id, title)); }
    catch (cause: unknown) { setLocalError(cause instanceof Error ? cause.message : "会话名称不合法"); }
  };
  return <div ref={rootRef} className={styles.controls} data-testid="conversation-controls" aria-busy={pending}
    onKeyDown={(event) => { if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); setRenaming(false); triggerRef.current?.focus({ preventScroll: true }); } }}>
    <div className={styles.toolbar}>
      <button ref={triggerRef} type="button" className={styles.trigger} aria-label="切换会话" aria-haspopup="dialog" aria-expanded={open} disabled={locked}
        title={busy ? "生成或加载期间不能切换会话" : active?.title ?? "查看当前书籍会话"} onClick={() => { setOpen(!open); setLocalError(""); }}>
        <span className={styles.heading}>{active?.title ?? "新会话"}</span><span aria-hidden="true">⌄</span>
      </button>
      <button type="button" className={styles.iconButton} aria-label="新建会话" title={busy ? "请等待当前生成结束" : "新建会话"} disabled={locked || !onNewConversation} onClick={() => void perform(onNewConversation)}>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
    </div>
    {open && <div className={styles.popover} role="dialog" aria-label="当前书籍会话">
      <div className={styles.popoverHeading}><span>会话历史</span><button type="button" disabled={locked || !active || !onRenameConversation} onClick={() => { if (active) { setDraft(active.title); setRenaming(!renaming); setLocalError(""); } }}>重命名当前会话</button></div>
      {renaming && <form className={styles.renameForm} onSubmit={(event) => { event.preventDefault(); rename(); }}>
        <input aria-label="会话名称" value={draft} maxLength={160} disabled={locked} onChange={(event) => setDraft(event.target.value)} />
        <button type="submit" disabled={locked}>保存</button><button type="button" disabled={locked} onClick={() => setRenaming(false)}>取消</button>
      </form>}
      <input ref={searchRef} type="search" className={styles.search} aria-label="搜索会话" placeholder="搜索会话" value={query} disabled={locked} onChange={(event) => setQuery(event.target.value)} />
      <ul className={styles.list}>{filtered.map((conversation) => <li key={conversation.id}>
        <button type="button" disabled={locked || !onSelectConversation} aria-current={conversation.id === activeThreadId ? "true" : undefined}
          onClick={() => { if (locked) return; if (conversation.id === activeThreadId) { setOpen(false); return; } void perform(() => onSelectConversation?.(conversation.id)); }}>
          <span className={styles.rowTitle}>{conversation.title}</span>
          <span className={styles.rowMeta}>{conversation.messageCount} 条消息{conversation.id === activeThreadId ? " · 当前" : ""}</span>
        </button>
      </li>)}</ul>
      {filtered.length === 0 && <p className={styles.empty}>{query ? "没有匹配的会话" : "暂无会话，点击 + 新建"}</p>}
      {busy && <p className={styles.hint}>当前生成或加载结束后可切换会话</p>}
    </div>}
    {(localError || error) && <p className={styles.error} role="alert">{localError || error}</p>}
  </div>;
}
