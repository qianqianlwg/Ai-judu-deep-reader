"use client";
import {useBookResumes} from "@/hooks/use-book-resumes";
import {ArchivedBooks} from "./archived-books";
import {BookshelfCard} from "./bookshelf-card";
import {BookDetailsPanel, type BookDetailsSection} from "./book-details-panel";
import {formatName, selectShelfBooks, type ShelfSort, type ShelfStatus, shelfTitle} from "./bookshelf-model";
import {useMemo, useState} from "react";
import type {WorkspaceBook} from "./workspace-editions";
import "./bookshelf.css";
export type BookshelfProps = {
  books: readonly WorkspaceBook[]; currentBookId: string; currentEditionId?: string;
  loading?: boolean; importing?: boolean; busy?: boolean; error?: string;
  assistantOpen?: boolean; onToggleAssistant?: () => void; preferenceError?: string;
  onOpenBook: (id: string, editionId?: string) => void; onImport: () => void;
  onRefresh: () => void; onBookArchived?: (bookId: string) => void;
};
export function Bookshelf({books, currentBookId, currentEditionId, loading, importing, busy, error, assistantOpen, onToggleAssistant, preferenceError, onOpenBook, onImport, onRefresh, onBookArchived}: BookshelfProps) {
  const resumes = useBookResumes(books);
  const [archiveRevision, setArchiveRevision] = useState(0);
  // WHY：查看信息的选择独立于当前阅读书籍，不触发加载、进度保存或最近阅读更新。
  const [selection, setSelection] = useState<{id: string; section: BookDetailsSection} | null>(null);
  const [coverRevisions, setCoverRevisions] = useState<Record<string, number>>({});
  const selectedBook = books.find(book => book.id === selection?.id);
  const openDetails = (id: string, section: BookDetailsSection) => setSelection({id, section});
  const archived = (id: string) => {
    setSelection(null); setArchiveRevision(value => value + 1); onBookArchived?.(id); onRefresh();
  };
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ShelfSort>("recent");
  const [format, setFormat] = useState("");
  const [status, setStatus] = useState<ShelfStatus>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const formats = useMemo(() => [...new Set(books.flatMap(book => book.editions?.map(e => formatName(e.fileType)) ?? []))].sort(), [books]);
  const filtered = useMemo(() => selectShelfBooks(books, {query, sort, format, status, resumes: resumes.editions, recent: Object.fromEntries(Object.entries(resumes.history).map(([id, item]) => [id, item.updatedAt]))}), [books, query, sort, format, status, resumes.editions, resumes.history]);
  const recent = books.filter(book => resumes.history[book.id] && resumes.editions[book.id] === resumes.history[book.id].editionId).sort((a,b) => resumes.history[b.id].updatedAt - resumes.history[a.id].updatedAt)[0];
  const reset = () => {setQuery(""); setFormat(""); setStatus("all");};
  return <section className="bookshelf-workspace" aria-label="我的书架" aria-busy={!!loading || !!importing}>
    <header className="workspace-heading"><div><p>我的阅读空间</p><h1>书架 <span>{books.length}</span></h1></div><div className="bookshelf-heading-actions">
      <button type="button" className="bookshelf-import" onClick={onImport} disabled={busy || importing}>{importing ? "正在导入…" : "导入书籍"}</button>
      {onToggleAssistant && <button type="button" aria-expanded={!!assistantOpen} aria-controls="chat-panel" onClick={onToggleAssistant}>{assistantOpen ? "收起助手" : "展开助手"}</button>}
    </div></header>
    <div className="bookshelf-toolbar">
      <label className="bookshelf-search"><span className="workspace-sr-only">按书名或作者筛选书架</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索书名、作者或文件名" /></label>
      <label><span className="workspace-sr-only">文件格式</span><select aria-label="文件格式" value={format} onChange={event => setFormat(event.target.value)}><option value="">全部格式</option>{formats.map(item => <option key={item}>{item}</option>)}</select></label>
      <label><span className="workspace-sr-only">阅读状态</span><select aria-label="阅读状态" value={status} onChange={event => {const value=event.target.value;if(value==="all"||value==="reading"||value==="unread")setStatus(value);}}><option value="all">全部书籍</option><option value="reading">有阅读记录</option><option value="unread">尚未阅读</option></select></label>
      <label><span className="workspace-sr-only">排序方式</span><select aria-label="排序方式" value={sort} onChange={event => {const value=event.target.value;if(value==="recent"||value==="imported"||value==="title")setSort(value);}}><option value="recent">最近阅读</option><option value="imported">最近导入</option><option value="title">书名排序</option></select></label>
      <div className="bookshelf-view-switch" role="group" aria-label="书架视图"><button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")}>网格</button><button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>列表</button></div>
      <button type="button" className="bookshelf-refresh" onClick={onRefresh} disabled={loading || importing} aria-label="刷新书架" title="刷新书架">↻</button>
    </div>
    {(resumes.error || preferenceError) && <p className="workspace-inline-error" role="status">{resumes.error || preferenceError}</p>}
    {error && <div className="workspace-inline-error" role="alert">{error}<button type="button" onClick={onRefresh}>重新加载书架</button></div>}
    <div className="bookshelf-scroll">
      {!loading && !error && recent && !query && !format && status === "all" && <section className="bookshelf-recent" aria-label="最近阅读"><div><small>继续上次阅读</small><strong>{shelfTitle(recent)}</strong><p>{resumes.history[recent.id].location} · <time dateTime={new Date(resumes.history[recent.id].updatedAt).toISOString()}>{new Date(resumes.history[recent.id].updatedAt).toLocaleDateString("zh-CN")}</time></p></div><button type="button" disabled={busy || importing} onClick={() => onOpenBook(recent.id, resumes.history[recent.id].editionId)}>继续阅读 ↗</button></section>}
      {loading && <p role="status">正在读取书架…</p>}
      {!loading && !error && books.length === 0 && <div className="workspace-empty"><h2>从一本书开始</h2><p>导入图书或文档，在这里继续你的阅读。原文件和阅读记录保存在本地。</p><button type="button" onClick={onImport} disabled={busy || importing}>导入第一本书</button></div>}
      {!loading && books.length > 0 && filtered.length === 0 && <div className="workspace-empty" role="status"><h2>没有找到这本书</h2><p>试试其他关键词，或清空格式与阅读状态筛选。</p><button type="button" onClick={reset}>清空筛选</button></div>}
      {(query || format || status !== "all") && <p className="bookshelf-result-count" role="status">找到 {filtered.length} 本书</p>}
      <div className={"bookshelf-grid" + (view === "list" ? " bookshelf-list" : "")}>{filtered.map(book => <BookshelfCard key={book.id} book={book} resumeEdition={resumes.editions[book.id]} location={resumes.history[book.id]?.editionId === resumes.editions[book.id] ? resumes.history[book.id]?.location : undefined} currentBookId={currentBookId} coverRevision={coverRevisions[book.id]} busy={busy || importing || loading} onOpen={onOpenBook} onDetails={openDetails} />)}</div>
      <ArchivedBooks revision={archiveRevision} busy={busy || importing || loading} onRestored={onRefresh} />
    </div>
    <footer className="bookshelf-footer">单文件最大 300 MB · 在书籍的「⋯」中查看信息、版本与管理操作</footer>
    {selectedBook && selection && <BookDetailsPanel key={selectedBook.id} book={selectedBook} initialSection={selection.section}
      currentBookId={currentBookId} currentEditionId={currentEditionId} resumeEdition={resumes.editions[selectedBook.id]}
      location={resumes.history[selectedBook.id]?.editionId === resumes.editions[selectedBook.id] ? resumes.history[selectedBook.id]?.location : undefined}
      coverRevision={coverRevisions[selectedBook.id]} busy={busy || importing || loading} onClose={() => setSelection(null)}
      onOpen={(id, editionId) => {setSelection(null); onOpenBook(id, editionId);}} onUpdated={onRefresh} onArchived={() => archived(selectedBook.id)}
      onRetryCover={() => setCoverRevisions(previous => ({...previous, [selectedBook.id]: (previous[selectedBook.id] ?? 0) + 1}))} />}

  </section>;
}
