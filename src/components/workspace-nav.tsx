"use client";

import Link from "next/link";
import { BookToc } from "./book-toc";
import type { BookNavigationItem } from "@/lib/book-navigation";
import { useState, type ReactNode } from "react";
import type { WorkspaceBook } from "./workspace-editions";
export type { WorkspaceBook } from "./workspace-editions";
import "./workspace-nav.css";

export type WorkspaceView = "reader" | "knowledge" | "guide";
type Chapter = { id: string; title: string; sourceHref?:string };
export type WorkspaceNavProps = {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  view: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  books: readonly WorkspaceBook[];
  currentBookId: string;
  currentEditionId?: string;
  chapters: readonly Chapter[];
  navigation?: readonly BookNavigationItem[];
  activeNavigationId?: string;
  onOpenNavigation?: (item:BookNavigationItem)=>void;
  currentChapterId?: string;
  onOpenChapter: (id: string) => void;
  busy?: boolean;
  mobileOpen?: boolean;
  onDismiss?: () => void;
  children?: ReactNode;
};
function Icon({ name }: { name: WorkspaceView | "bookshelf" | "settings" }) {
  const paths = {
    guide: "M4 4h6v5H4zM14 15h6v5h-6zM4 15h6v5H4zM7 9v3h10v3M7 12v3",
    reader: "M3 4h6l3 2 3-2h6v15h-6l-3 2-3-2H3zM12 6v15",
    bookshelf: "M4 4h4v16H4zM10 4h4v16h-4zM16 5l4-1 3 15-4 1z",
    knowledge: "M4 4h7v7H4zM14 4h6v7h-6zM4 14h7v6H4zM14 14h6v6h-6z",
    settings: "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0",
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
export function WorkspaceNav({ collapsed=false, onToggleCollapse, view, onNavigate, chapters, navigation, activeNavigationId, onOpenNavigation, currentChapterId, onOpenChapter, books, currentBookId, busy, mobileOpen, onDismiss, children }: WorkspaceNavProps) {
  const [tocOpen, setTocOpen] = useState(true);
  const navigate = (next: WorkspaceView) => { onNavigate(next); onDismiss?.(); };
  return <aside id="workspace-navigation" className={"workspace-nav toc-panel" + (mobileOpen ? " mobile-open" : "")} aria-label="工作台导航">
    {onToggleCollapse && <button type="button" className="workspace-collapse-toggle" aria-label={collapsed?"展开左侧导航":"收起左侧导航"} aria-expanded={!collapsed} onClick={onToggleCollapse} title={collapsed?"展开左侧导航":"收起左侧导航"}>{collapsed?"☰":"«"}</button>}
    <div className="workspace-brand"><span aria-hidden="true">句</span><strong>句读</strong><button type="button" className="workspace-nav-close" aria-label="关闭导航" onClick={onDismiss}>×</button></div>
    {/* WHY：返回全局书架是离开当前书籍，不再作为与阅读、导读、知识库平级的书内视图。 */}
    <Link className="workspace-shelf-back" href="/" aria-disabled={busy || undefined} onClick={event => { if (busy) event.preventDefault(); }}>← 返回书架</Link>
    <div className="workspace-book-context"><small>当前书籍</small><strong>{books.find(book => book.id === currentBookId)?.title || "正在打开书籍…"}</strong></div>
    <nav className="workspace-destinations" aria-label="主导航">
      {([ ["reader", "阅读"], ["guide", "思维导读"], ["knowledge", "知识库"] ] as const).map(([id, label]) => <button type="button" key={id}
        aria-current={view === id ? "page" : undefined} className={"workspace-nav-item" + (view === id ? " active" : "")}
        onClick={() => navigate(id)}><Icon name={id} /><span>{label}</span></button>)}
    </nav>
    <div className="workspace-nav-scroll">
      {/* WHY：选书与版本管理统一留在书架，侧栏不再重复书籍树；阅读目录保持原行为。 */}
      {busy && <p className="workspace-nav-hint" role="status">当前任务处理中，完成后可返回书架。</p>}
      {view === "reader" && <>
        <div className="workspace-section-title"><button type="button" aria-expanded={tocOpen} aria-label={tocOpen ? "收起目录" : "展开目录"} onClick={() => setTocOpen(!tocOpen)}><span aria-hidden="true">{tocOpen ? "⌄" : "›"}</span> 目录</button></div>
        {tocOpen && navigation && onOpenNavigation ? navigation.length ? <BookToc items={navigation} activeId={activeNavigationId} currentChapterId={currentChapterId} onOpen={item=>{onOpenNavigation(item);onDismiss?.();}}/>
          : <div><p className="workspace-nav-hint">原书未提供目录。以下按文件顺序导航，不推测章标题。</p><nav aria-label="正文文件顺序">{chapters.map((chapter,index)=><button type="button" className="toc-item" key={chapter.id} onClick={()=>{onOpenChapter(chapter.id);onDismiss?.();}}><span>{chapter.sourceHref?.split('/').pop()??('正文文件 '+(index+1))}</span></button>)}</nav></div>
          : tocOpen && <nav aria-label="本书目录">{chapters.map((chapter, index) => <button type="button" key={chapter.id}
          className={"toc-item" + (chapter.id === currentChapterId ? " active" : "")} aria-current={chapter.id === currentChapterId ? "location" : undefined}
          onClick={() => { onOpenChapter(chapter.id); onDismiss?.(); }}><small>{String(index + 1).padStart(2, "0")}</small><span>{chapter.title}</span></button>)}</nav>}
        {children}
      </>}
    </div>
    <footer className="workspace-nav-footer"><a href="/settings"><Icon name="settings" /><span>设置</span></a></footer>
  </aside>;
}
