"use client";

import { useEffect, useId, useState } from "react";
import { fetchBookKnowledge, filterBookKnowledge, type BookKnowledge, type KnowledgeAnchor,
  type KnowledgeConcept, type KnowledgeRecord } from "@/lib/knowledge";
import styles from "./knowledge-panel.module.css";

export type KnowledgePanelProps = {
  editionId: string | null;
  bookTitle?: string;
  refreshToken?: string | number;
  className?: string;
  onClose?: () => void;
  onRefreshRequested?: () => void;
  onOpenSource?: (anchor: KnowledgeAnchor, record: KnowledgeRecord) => void;
  onOpenConversation?: (threadId: string, messageId: string | null) => void;
};
export type KnowledgeTab = "concepts" | "records";
export type KnowledgePanelState =
  | { status: "idle" | "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: BookKnowledge };
export type KnowledgePanelViewProps = Omit<KnowledgePanelProps, "editionId" | "refreshToken"> & {
  state: KnowledgePanelState;
  tab: KnowledgeTab;
  query: string;
  idPrefix: string;
  onTabChange: (tab: KnowledgeTab) => void;
  onQueryChange: (query: string) => void;
  onRefresh: () => void;
};

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function RecordActions({ record, onOpenSource, onOpenConversation }: {
  record: KnowledgeRecord;
} & Pick<KnowledgePanelProps, "onOpenSource" | "onOpenConversation">) {
  const sourceReason = record.anchor ? "" : record.locationReason ?? "缺少准确锚点，暂不支持原文跳转。";
  return <>
    {sourceReason && <p className={styles.notice}>{sourceReason}</p>}
    <div className={styles.actions}>
      <button type="button" disabled={!record.anchor || !onOpenSource}
        title={sourceReason || (onOpenSource ? "定位到这次句读的原文" : "尚未接入原文导航")}
        onClick={() => { if (record.anchor) onOpenSource?.(record.anchor, record); }}>打开原文</button>
      <button type="button" disabled={!record.threadId || !onOpenConversation}
        title={!record.threadId ? "这条历史记录未关联有效对话" : record.messageId ? "定位到这次句读消息" : "历史记录无消息 ID，只能打开所属对话"}
        onClick={() => { if (record.threadId) onOpenConversation?.(record.threadId, record.messageId); }}>
        {record.messageId ? "打开对话" : "打开所属对话"}
      </button>
    </div>
  </>;
}

function RecordCard({ record, ...callbacks }: {
  record: KnowledgeRecord;
} & Pick<KnowledgePanelProps, "onOpenSource" | "onOpenConversation">) {
  return <article className={styles.card} data-record-id={record.id}>
    <div className={styles.meta}>
      <span>{record.chapterTitle ?? "历史句读"}</span>
      <time dateTime={record.createdAt}>{formatTime(record.createdAt)}</time>
    </div>
    <p className={styles.summary}>{record.summary || "这次句读已保存概念解释。"}</p>
    {record.excerpt ? <details className={styles.source} open={record.excerpt.length < 160}>
      <summary>{record.anchor ? "原文摘录" : "历史选文（未定位）"} · {record.excerpt.length} 字</summary>
      <blockquote>{record.excerpt}</blockquote>
    </details> : <p className={styles.notice}>旧记录未保存可核验的原文摘录。</p>}
    {record.concepts.length > 0 && <ul className={styles.tags} aria-label="本次关键概念">
      {[...new Set(record.concepts.map((item) => item.name))].map((name) => <li key={name}>{name}</li>)}
    </ul>}
    <RecordActions record={record} {...callbacks} />
  </article>;
}

function ConceptCard({ concept, records, ...callbacks }: {
  concept: KnowledgeConcept;
  records: Map<string, KnowledgeRecord>;
} & Pick<KnowledgePanelProps, "onOpenSource" | "onOpenConversation">) {
  const sources = concept.recordIds.flatMap((id) => { const record = records.get(id); return record ? [record] : []; });
  return <article className={styles.card} data-concept-name={concept.name}>
    <div className={styles.cardHeading}><h3>{concept.name}</h3><span>{sources.length} 次句读</span></div>
    {concept.definitions.length ? concept.definitions.map((definition, index) =>
      <div className={styles.definition} key={definition.text}>
        {concept.definitions.length > 1 && <small>解释 {index + 1} · {definition.recordIds.length} 次句读来源</small>}
        <p>{definition.text}</p>
      </div>) : <p className={styles.notice}>这条历史记录未保存概念定义，可打开所属对话查看。</p>}
    <details className={styles.sources}>
      <summary>查看 {sources.length} 条句读来源</summary>
      {sources.map((record) => <RecordCard key={record.id} record={record} {...callbacks} />)}
    </details>
  </article>;
}

export function KnowledgePanelView({ state, tab, query, idPrefix, onTabChange, onQueryChange,
  onRefresh, bookTitle, className, onClose, onOpenSource, onOpenConversation }: KnowledgePanelViewProps) {
  const data = state.status === "ready" ? state.data : null;
  const filtered = data ? filterBookKnowledge(data, query) : null;
  const allRecords = new Map(data?.records.map((record) => [record.id, record]) ?? []);
  const callbacks = { onOpenSource, onOpenConversation };
  const empty = filtered && !(tab === "concepts" ? filtered.concepts.length : filtered.records.length);
  return <aside className={[styles.panel, className].filter(Boolean).join(" ")}
    aria-label="本书知识卡片" aria-busy={state.status === "loading"}>
    <header className={styles.header}>
      <div><h2>本书知识</h2><p>{bookTitle || "当前书籍"} · 全书范围</p></div>
      <div className={styles.headerActions}>
        <button type="button" disabled={state.status === "idle" || state.status === "loading"}
          onClick={onRefresh} aria-label="刷新本书知识">刷新</button>
        {onClose && <button type="button" onClick={onClose} aria-label="返回对话">返回对话</button>}
      </div>
    </header>
    <div className={styles.tabs} role="tablist" aria-label="知识分类">
      {(["concepts", "records"] as const).map((value) => <button type="button" role="tab" key={value}
        id={idPrefix + "-" + value} aria-controls={idPrefix + "-content"} aria-selected={tab === value}
        tabIndex={tab === value ? 0 : -1} onClick={() => onTabChange(value)}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "concepts" : event.key === "End" ? "records"
            : value === "concepts" ? "records" : "concepts";
          onTabChange(next);
          const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
          tabs?.[next === "concepts" ? 0 : 1]?.focus();
        }}>
        {value === "concepts" ? "概念" : "句读记录"}
        <span>{data ? value === "concepts" ? data.concepts.length : data.records.length : "—"}</span>
      </button>)}
    </div>
    <label className={styles.search}>
      <span className={styles.srOnly}>搜索本书概念和句读记录</span>
      <input type="search" value={query} onChange={(event) => onQueryChange(event.currentTarget.value)}
        placeholder="搜索概念、解释或原文…" disabled={state.status === "idle"} />
    </label>
    <div className={styles.content} role="tabpanel" id={idPrefix + "-content"}
      aria-labelledby={idPrefix + "-" + tab} tabIndex={0}>
      {state.status === "idle" && <div className={styles.empty}>请先选择或导入一本书。</div>}
      {state.status === "loading" && <div className={styles.empty} role="status">正在读取本书知识…</div>}
      {state.status === "error" && <div className={styles.empty} role="alert">
        <p>{state.error}</p><button type="button" onClick={onRefresh}>重新加载</button>
      </div>}
      {empty && <div className={styles.empty} role="status">
        <h3>{query.trim() ? "没有找到匹配的知识卡片" : tab === "concepts" ? "还没有关键概念" : "还没有句读记录"}</h3>
        <p>{query.trim() ? "试试其他词语，或清空搜索。" : "选中原文并完成一次句读后，会在这里汇集全书的记录。普通聊天不会列入。"}</p>
        {query.trim() && <button type="button" onClick={() => onQueryChange("")}>清空搜索</button>}
      </div>}
      {filtered && (tab === "concepts"
        ? filtered.concepts.map((concept) => <ConceptCard key={concept.id} concept={concept} records={allRecords} {...callbacks} />)
        : filtered.records.map((record) => <RecordCard key={record.id} record={record} {...callbacks} />))}
    </div>
    <footer className={styles.footer}>来自本书已保存的 AI 句读，请结合原文辨析。</footer>
  </aside>;
}

function KnowledgePanelSession(props: KnowledgePanelProps) {
  const { editionId, refreshToken = 0 } = props;
  const [tab, setTab] = useState<KnowledgeTab>("concepts");
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [resource, setResource] = useState<{ key: string; state: KnowledgePanelState } | null>(null);
  const idPrefix = useId();
  const requestKey = JSON.stringify([editionId, refreshToken, revision]);
  useEffect(() => {
    if (!editionId) return;
    const controller = new AbortController();
    void fetchBookKnowledge(editionId, controller.signal).then((data) => {
      if (!controller.signal.aborted) setResource({ key: requestKey, state: { status: "ready", data } });
    }).catch((error: unknown) => {
      // WHY：切书、刷新和卸载会主动取消旧请求；旧版本结果不得覆盖当前书籍的卡片。
      if (controller.signal.aborted) return;
      console.error("加载本书知识卡片失败", error);
      setResource({ key: requestKey, state: { status: "error",
        error: error instanceof Error ? error.message : "知识卡片读取失败，请重试。" } });
    });
    return () => controller.abort();
  }, [editionId, requestKey]);
  const state: KnowledgePanelState = !editionId ? { status: "idle" }
    : resource?.key === requestKey ? resource.state : { status: "loading" };
  return <KnowledgePanelView {...props} state={state} tab={tab} query={query} idPrefix={idPrefix}
    onTabChange={setTab} onQueryChange={setQuery} onRefresh={() => { setRevision((value) => value + 1); props.onRefreshRequested?.(); }} />;
}

export function KnowledgePanel(props: KnowledgePanelProps) {
  // WHY：切换版本时重建局部筛选状态，避免把上一本书的搜索、卡片或错误带到下一本书。
  return <KnowledgePanelSession key={props.editionId ?? "no-edition"} {...props} />;
}
