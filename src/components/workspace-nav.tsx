"use client";

import { useState, type ReactNode } from "react";
import { editionActionLabel, editionImportTime, editionLabel, type WorkspaceBook } from "./workspace-editions";
export type { WorkspaceBook } from "./workspace-editions";
import "./workspace-nav.css";

export type WorkspaceView = "reader" | "bookshelf" | "knowledge";
type Chapter = { id: string; title: string };
export type WorkspaceNavProps = {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  view: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  books: readonly WorkspaceBook[];
  currentBookId: string;
  currentEditionId?: string;
  chapters: readonly Chapter[];
  currentChapterId?: string;
  onOpenBook: (id: string, editionId?: string) => void;
  onOpenChapter: (id: string) => void;
  onImport: () => void;
  busy?: boolean;
  importing?: boolean;
  mobileOpen?: boolean;
  onDismiss?: () => void;
  children?: ReactNode;
};
function Icon({ name }: { name: WorkspaceView | "import" | "settings" }) {
  const paths = {
    reader: "M3 4h6l3 2 3-2h6v15h-6l-3 2-3-2H3zM12 6v15",
    bookshelf: "M4 4h4v16H4zM10 4h4v16h-4zM16 5l4-1 3 15-4 1z",
    knowledge: "M4 4h7v7H4zM14 4h6v7h-6zM4 14h7v6H4zM14 14h6v6h-6z",
    import: "M12 3v12M7 8l5-5 5 5M4 14v6h16v-6",
    settings: "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0",
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
export function WorkspaceNav({ collapsed=false, onToggleCollapse, view, onNavigate, books, currentBookId, currentEditionId, chapters, currentChapterId, onOpenBook, onOpenChapter, onImport, busy, importing, mobileOpen, onDismiss, children }: WorkspaceNavProps) {
  const [booksOpen, setBooksOpen] = useState(true);
  const [tocOpen, setTocOpen] = useState(true);
  const navigate = (next: WorkspaceView) => { onNavigate(next); onDismiss?.(); };
  return <aside className={"workspace-nav toc-panel" + (mobileOpen ? " mobile-open" : "")} aria-label="工作台导航">
    {onToggleCollapse && <button type="button" className="workspace-collapse-toggle" aria-label={collapsed?"展开左侧导航":"收起左侧导航"} aria-expanded={!collapsed} onClick={onToggleCollapse} title={collapsed?"展开左侧导航":"收起左侧导航"}>{collapsed?"☰":"«"}</button>}
    <div className="workspace-brand"><span aria-hidden="true">句</span><strong>句读</strong><button type="button" className="workspace-nav-close" aria-label="关闭导航" onClick={onDismiss}>×</button></div>
    <nav className="workspace-destinations" aria-label="主导航">
      {([ ["reader", "阅读"], ["bookshelf", "书架"], ["knowledge", "知识库"] ] as const).map(([id, label]) => <button type="button" key={id}
        aria-current={view === id ? "page" : undefined} className={"workspace-nav-item" + (view === id ? " active" : "")}
        onClick={() => navigate(id)}><Icon name={id} /><span>{label}</span></button>)}
      <button type="button" className="workspace-nav-item workspace-import-nav" disabled={busy || importing} onClick={() => { onNavigate("bookshelf"); onImport(); }}><Icon name="import" /><span>{importing ? "正在导入…" : "导入书籍"}</span></button>
    </nav>
    <div className="workspace-nav-scroll">
      {view !== "bookshelf" && <><div className="workspace-section-title"><button type="button" aria-expanded={booksOpen} aria-label={booksOpen ? "收起书籍" : "展开书籍"} onClick={() => setBooksOpen(!booksOpen)}><span aria-hidden="true">{booksOpen ? "⌄" : "›"}</span> 我的书籍 <small>{books.length}</small></button></div>
      {booksOpen && <div className="book-shelf">{books.map(book => <div key={book.id} className="shelf-book-group" data-book-id={book.id}>
        <button type="button" disabled={busy} className={"shelf-book" + (book.id === currentBookId ? " active" : "")} aria-current={book.id === currentBookId ? "true" : undefined}
          onClick={() => { onOpenBook(book.id); onDismiss?.(); }} title={book.title + " · BookID " + book.id}><span className="workspace-book-spine" aria-hidden="true" /><span>{book.title}</span></button>
        {!!book.editions?.length && <details className="shelf-editions" open={book.id === currentBookId}><summary>{book.editions.length} 个版本 · {book.id.slice(0, 8)}</summary>
          {book.editions.map(edition => <button type="button" key={edition.id} disabled={busy} data-edition-id={edition.id} aria-label={editionActionLabel(book, edition)}
            aria-current={book.id === currentBookId && edition.id === currentEditionId ? "true" : undefined} title={editionLabel(edition) + " · EditionID " + edition.id}
            onClick={() => { onOpenBook(book.id, edition.id); onDismiss?.(); }}><span>{edition.fileName || "文件名未记录"}</span><small>{editionImportTime(edition.createdAt)} · {edition.id.slice(0, 8)}</small></button>)}
        </details>}
      </div>)}</div>}
      </>}
      {view === "bookshelf" && <p className="workspace-nav-hint">在书架搜索、筛选与管理书籍。打开一本书后，这里显示书籍和目录。</p>}
      {busy && <p className="workspace-nav-hint" role="status">当前任务处理中，完成后可切换书籍。</p>}
      {view === "reader" && <>
        <div className="workspace-section-title"><button type="button" aria-expanded={tocOpen} aria-label={tocOpen ? "收起目录" : "展开目录"} onClick={() => setTocOpen(!tocOpen)}><span aria-hidden="true">{tocOpen ? "⌄" : "›"}</span> 目录</button></div>
        {tocOpen && <nav aria-label="本书目录">{chapters.map((chapter, index) => <button type="button" key={chapter.id}
          className={"toc-item" + (chapter.id === currentChapterId ? " active" : "")} aria-current={chapter.id === currentChapterId ? "location" : undefined}
          onClick={() => { onOpenChapter(chapter.id); onDismiss?.(); }}><small>{String(index + 1).padStart(2, "0")}</small><span>{chapter.title}</span></button>)}</nav>}
        {children}
      </>}
    </div>
    <footer className="workspace-nav-footer"><a href="/settings"><Icon name="settings" /><span>设置</span></a></footer>
  </aside>;
}
