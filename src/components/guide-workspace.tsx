"use client";
import { useCallback, useEffect, useState } from "react";
import { useBookGuide } from "@/hooks/use-book-guide";
import { guideMarkdown } from "@/lib/guide-view";
import type { GuideNode } from "@/lib/guide";
import type { GuideSource } from "@/lib/guide-sources";
import { GuideMindMap } from "./guide-mind-map";
import { GuideTree } from "./guide-tree";
import { GuideHistory } from "./guide-history";
import { GuideInspector } from "./guide-inspector";
import { GuideNodeEditor } from "./guide-node-editor";
import styles from "./guide-workspace.module.css";
type Props = {
  bookId: string | null;
  bookTitle: string;
  onReturnReading: () => void;
  onOpenSource: (source: GuideSource, conversation: boolean) => void;
};
export function GuideWorkspace({
  bookId,
  bookTitle,
  onReturnReading,
  onOpenSource,
}: Props) {
  const { state, busy, error, refresh, command } = useBookGuide(bookId);
  const [selected, setSelected] = useState<string | null>(null),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [query, setQuery] = useState("");
  const [history, setHistory] = useState(false),
    [creating, setCreating] = useState<GuideNode | null>(null),
    [notice, setNotice] = useState(""),
    [importConfirm, setImportConfirm] = useState(false);
  const [view, setView] = useState<"map" | "outline">("map"),
    [inspectorMode, setInspectorMode] = useState<"read" | "edit">("read");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [preferencesBook, setPreferencesBook] = useState<string | null>(null);
  useEffect(() => {
    if (!bookId) return;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("judu:guide-view:" + bookId) || "{}");
      if (saved && typeof saved === "object" && "collapsed" in saved && Array.isArray(saved.collapsed) && saved.collapsed.every(id => typeof id === "string")) {
        // WHY：这只是浏览器中的阅读视图偏好，不参与AI或手动编辑版本。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCollapsed(new Set(saved.collapsed));
      }
    } catch (cause: unknown) { console.warn("导读展开状态未恢复", cause); setNotice("无法恢复上次展开位置，导读内容不受影响。"); }
    setPreferencesBook(bookId);
  }, [bookId]);
  useEffect(() => {
    // WHY：恢复完成前不能把初始空集合写回，页面刷新时React会先装配空书籍状态。
    if (!bookId || preferencesBook !== bookId) return;
    try { localStorage.setItem("judu:guide-view:" + bookId, JSON.stringify({ collapsed: [...collapsed] })); }
    catch (cause: unknown) { console.warn("导读展开状态未保存", cause); }
  }, [bookId, preferencesBook, collapsed]);
  const node = state?.nodes.find((item) => item.id === selected) ?? null;
  const select = useCallback((id: string | null) => {
    setSelected(id);
    setInspectorMode("read");
    setInspectorOpen(false);
    setHistory(false);
    setCreating(null);
  }, []);
  const edit = useCallback((id: string) => {
    setSelected(id);
    setInspectorMode("edit");
    setInspectorOpen(true);
    setHistory(false);
    setCreating(null);
  }, []);
  const create = useCallback((parentId: string | null) => {
    setCreating({
      id: crypto.randomUUID(),
      parentId,
      title: "",
      summary: "",
      sourceIds: [],
    });
    setHistory(false);
  }, []);
  const toggle = useCallback(
    (id: string) =>
      setCollapsed((value) => {
        const next = new Set(value);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  async function act(action: "undo" | "redo") {
    if (await command({ action })) {
      setNotice(action === "undo" ? "已撤销上一次改动" : "已重做上一次改动");
      setCreating(null);
    }
  }
  function exportGuide() {
    if (!state) return;
    const url = URL.createObjectURL(
      new Blob([guideMarkdown(bookTitle, state.nodes)], {
        type: "text/markdown;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = bookTitle.replace(/[<>:"/\\|?*]/gu, "_") + "-思维导读.md";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const detailOpen = Boolean((node && inspectorOpen) || creating || history);
  return (
    <section
      className={styles.workspace}
      aria-label="思维导读工作区"
      onKeyDown={(event) => {
        if (
          view === "map" ||
          (event.target instanceof HTMLElement &&
            event.target.isContentEditable) ||
          !(event.metaKey || event.ctrlKey) ||
          event.key.toLowerCase() !== "z" ||
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        if (!busy && (event.shiftKey ? state?.canRedo : state?.canUndo))
          void act(event.shiftKey ? "redo" : "undo");
      }}
    >
      <header className={styles.header}>
        <div className={styles.headingIdentity}>
          <h1>思维导读</h1>
          <span className={styles.headingDivider} />
          <p className={styles.bookTitle}>{bookTitle || "从一本书开始"}</p>
        </div>
        <button className={styles.returnButton} onClick={onReturnReading}>
          返回阅读 ↗
        </button>
      </header>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
          <button disabled={busy} onClick={() => void refresh()}>
            重新读取
          </button>
        </div>
      )}
      {state?.lastError && !error && (
        <div role="alert" className={styles.error}>
          {state.lastError}
        </div>
      )}
      {notice && (
        <div className={styles.inlineNotice} role="status">
          {notice}
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
      {!bookId && (
        <div className={styles.empty}>
          <h2>从一本书开始</h2>
          <p>打开书籍，完成句读后，这里会生长出它的思维导图。</p>
          <button onClick={onReturnReading}>返回阅读</button>
        </div>
      )}
      {bookId && !state && !error && (
        <p className={styles.loading} role="status">
          正在展开阅读脉络…
        </p>
      )}
      {state && (
        <>
          {state.historicalCount > 0 && (
            <div className={styles.historyImport}>
              <span>
                还有 {state.historicalCount} 则此前完成的句读未纳入导图。
              </span>
              <button
                disabled={busy}
                onClick={() => setImportConfirm(!importConfirm)}
              >
                纳入已有句读
              </button>
              {importConfirm && (
                <div className={styles.confirm}>
                  <p>
                    只整理已完成句读的选文，不读取其他正文。将使用已配置的模型，产生相应调用用量。
                  </p>
                  <div className={styles.actions}>
                    <button onClick={() => setImportConfirm(false)}>
                      取消
                    </button>
                    <button
                      disabled={busy}
                      onClick={async () => {
                        if (await command({ action: "import-history" })) {
                          setImportConfirm(false);
                          setNotice("已有句读已加入更新队列，可以继续阅读。");
                        }
                      }}
                    >
                      确认纳入
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className={styles.body} data-detail-open={detailOpen}>
            <div
              className={styles.toolbar}
              role="toolbar"
              aria-label="思维导图工具栏"
            >
              <div
                className={styles.viewSwitch}
                role="group"
                aria-label="导读展示方式"
              >
                <button
                  aria-pressed={view === "map"}
                  onClick={() => setView("map")}
                >
                  画板
                </button>
                <button
                  aria-pressed={view === "outline"}
                  onClick={() => setView("outline")}
                >
                  提纲
                </button>
              </div>
              <label className={styles.search}>
                <span aria-hidden="true">⌕</span>
                <input
                  aria-label="搜索导读"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索主题"
                />
                {query && (
                  <button aria-label="清空搜索" onClick={() => setQuery("")}>
                    ×
                  </button>
                )}
              </label>
              <div className={styles.tools}>
                <button
                  disabled={!state.nodes.length}
                  onClick={() =>
                    setCollapsed(
                      new Set(
                        collapsed.size
                          ? []
                          : state.nodes
                              .filter((item) =>
                                state.nodes.some(
                                  (child) => child.parentId === item.id,
                                ),
                              )
                              .map((item) => item.id),
                      ),
                    )
                  }
                >
                  {collapsed.size ? "展开全部" : "收起分支"}
                </button>
                <button
                  title="撤销 · Ctrl / ⌘ Z"
                  aria-label="撤销导读改动"
                  disabled={busy || !state.canUndo}
                  onClick={() => void act("undo")}
                >
                  <span aria-hidden="true">↶</span>撤销
                </button>
                <button
                  title="重做 · Ctrl / ⌘ Shift Z"
                  aria-label="重做导读改动"
                  disabled={busy || !state.canRedo}
                  onClick={() => void act("redo")}
                >
                  <span aria-hidden="true">↷</span>重做
                </button>
                <button
                  aria-pressed={history}
                  onClick={() => {
                    setHistory(!history);
                    setCreating(null);
                  }}
                >
                  <span aria-hidden="true">◷</span>历史
                </button>
                <button disabled={!state.nodes.length} onClick={exportGuide}>
                  <span aria-hidden="true">⇩</span>导出提纲
                </button>
                <button
                  disabled={busy || !node}
                  onClick={() => create(node?.parentId ?? null)}
                >
                  <span aria-hidden="true">⊞</span>同级
                </button>
                <button
                  disabled={busy || !node}
                  onClick={() => create(node?.id ?? null)}
                >
                  <span aria-hidden="true">⑂</span>子主题
                </button>
                <button disabled={busy} onClick={() => create(null)}>
                  <span aria-hidden="true">＋</span>主题
                </button>
              </div>
            </div>
            {view === "map" ? (
              <GuideMindMap
                bookId={state.bookId}
                title={bookTitle}
                nodes={state.nodes}
                version={state.version}
                busy={busy}
                selected={selected}
                query={query}
                collapsed={collapsed}
                onToggle={toggle}
                onSelect={select}
                onInspect={() => setInspectorOpen(true)}
                onEdit={edit}
                onCreate={create}
                onCommand={command}
              />
            ) : (
              <div className={styles.outline}>
                <div className={styles.root}>
                  <div className={styles.rootMark}>卷</div>
                  <div>
                    <strong>{bookTitle}</strong>
                    <small>{state.nodes.length} 个节点</small>
                  </div>
                </div>
                <GuideTree
                  nodes={state.nodes}
                  selected={selected}
                  expanded={
                    new Set(
                      state.nodes
                        .filter((item) => !collapsed.has(item.id))
                        .map((item) => item.id),
                    )
                  }
                  query={query}
                  onSelect={(id) => {
                    select(id);
                    setInspectorOpen(true);
                  }}
                  onToggle={toggle}
                />
              </div>
            )}
            {!state.nodes.length && !creating && (
              <div className={styles.emptyHint}>
                <strong>让理解，随着阅读生长</strong>
                <p>每完成一次句读，新的主题就在这张画板上连接起来。</p>
                <button onClick={onReturnReading}>回到书中，开始句读</button>
              </div>
            )}
            {history ? (
              <GuideHistory revisions={state.revisions} busy={busy} command={command} onClose={() => setHistory(false)} setNotice={setNotice} />
            ) : creating ? (
              <aside className={styles.inspector}>
                <div className={styles.inspectorTop}>
                  <span>添加主题</span>
                  <button
                    aria-label="关闭添加主题"
                    onClick={() => setCreating(null)}
                  >
                    ×
                  </button>
                </div>
                <GuideNodeEditor
                  key={creating.id}
                  node={creating}
                  nodes={state.nodes}
                  version={state.version}
                  busy={busy}
                  creating
                  onCommand={command}
                  onClose={() => setCreating(null)}
                />
              </aside>
            ) : node && inspectorOpen ? (
              <GuideInspector
                key={node.id + ":" + inspectorMode}
                initialMode={inspectorMode}
                bookId={state.bookId}
                node={node}
                nodes={state.nodes}
                version={state.version}
                busy={busy}
                onCommand={command}
                onClose={() => setInspectorOpen(false)}
                onCreate={create}
                onOpenSource={onOpenSource}
              />
            ) : null}
          </div>
          <footer className={styles.footer}>
            <span className={styles.footerStatus}>
              <i
                className={state.pending ? styles.working : styles.statusDot}
              />
              <span role="status">
                {busy ? "正在保存改动…" : state.pending
                  ? `${state.pending} 则句读正在整理`
                  : state.failed
                    ? `${state.failed} 则更新待重试`
                    : `已整理 ${state.processed} 则句读 · ${state.nodes.length} 个节点`}
              </span>
              {state.failed > 0 && (
                <button
                  disabled={busy}
                  onClick={() => void command({ action: "retry" })}
                >
                  重试更新
                </button>
              )}
            </span>
            <span>
              只随阅读生长
              {state.updatedAt
                ? ` · ${new Date(state.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 更新`
                : ""}
            </span>
          </footer>
        </>
      )}
    </section>
  );
}
