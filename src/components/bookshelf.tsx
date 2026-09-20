"use client";

import { useMemo, useState } from "react";
import { editionActionLabel, editionImportTime, type WorkspaceBook } from "./workspace-editions";
import "./bookshelf.css";

export type BookshelfProps = {
  books: readonly WorkspaceBook[];
  currentBookId: string;
  currentEditionId?: string;
  loading?: boolean;
  importing?: boolean;
  busy?: boolean;
  error?: string;
  onOpenBook: (id: string, editionId?: string) => void;
  onImport: () => void;
  onRefresh: () => void;
};
export function Bookshelf({ books, currentBookId, currentEditionId, loading, importing, busy, error, onOpenBook, onImport, onRefresh }: BookshelfProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    return books.filter((book) => terms.every((term) => ([book.title, book.author, book.id, ...(book.editions ?? []).flatMap(edition => [edition.fileName, edition.id])].join(" ")).toLocaleLowerCase().includes(term)));
  }, [books, query]);
  return <section className="bookshelf-workspace" aria-label="我的书架" aria-busy={!!loading || !!importing}>
    <header className="workspace-heading"><div><p>我的阅读空间</p><h1>书架 <span>{books.length}</span></h1></div><button type="button" onClick={onImport} disabled={busy || importing}>{importing ? "正在导入…" : "导入新书"}</button></header>
    <div className="bookshelf-toolbar"><label><span className="workspace-sr-only">按书名或作者筛选书架</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="查找书名或作者" /></label><button type="button" onClick={onRefresh} disabled={loading || importing}>刷新书架</button></div>
    {error && <div className="workspace-inline-error" role="alert">{error}<button type="button" onClick={onRefresh}>重新加载书架</button></div>}
    <div className="bookshelf-scroll">
      {loading && <p role="status">正在读取书架…</p>}
      {!loading && !error && books.length === 0 && <div className="workspace-empty"><h2>从一本书开始</h2><p>导入 EPUB、PDF、FB2/FBZ、CBZ，也可导入 TXT、Markdown。书籍会保存在本地书架。</p><button type="button" onClick={onImport} disabled={busy || importing}>导入第一本书</button></div>}
      {!loading && books.length > 0 && filtered.length === 0 && <div className="workspace-empty" role="status"><h2>没有找到这本书</h2><p>试试书名中的另一个词，或按作者查找。</p><button type="button" onClick={() => setQuery("")}>清空筛选</button></div>}
      <div className="bookshelf-grid">{filtered.map((book, index) => <article className="bookshelf-card" key={book.id} data-book-id={book.id}>
        <button type="button" className="bookshelf-open" disabled={busy} aria-label={"阅读《" + book.title + "》"} onClick={() => onOpenBook(book.id)}>
          <span className={"bookshelf-cover cover-tone-" + index % 4} aria-hidden="true"><span>{book.title}</span><small>{book.author || "作者未注明"}</small></span>
          <strong>{book.title}</strong><span className="bookshelf-author">{book.author || "作者未注明"}</span>
          <span className="bookshelf-read-action">{currentBookId === book.id ? "继续阅读" : "打开阅读"}<span aria-hidden="true">↗</span></span>
        </button>
        {!!book.editions?.length && <div className="bookshelf-editions" aria-label="可选版本">
          <p>书籍 {book.id.slice(0, 8)} · {book.editions.length} 个版本</p>
          {book.editions.map(edition => <button type="button" key={edition.id} disabled={busy} data-edition-id={edition.id} aria-label={editionActionLabel(book, edition)}
            aria-current={book.id === currentBookId && edition.id === currentEditionId ? "true" : undefined} onClick={() => onOpenBook(book.id, edition.id)} title={editionActionLabel(book, edition)}>
            <strong>{edition.fileName || "文件名未记录"}</strong><time dateTime={edition.createdAt}>{editionImportTime(edition.createdAt)}</time><small>{edition.fileType.toUpperCase()} · {edition.id.slice(0, 8)}</small>
          </button>)}
        </div>}
      </article>)}</div>
    </div>
    <footer className="bookshelf-footer">导入与书籍管理集中在这里，阅读时保留干净的正文空间。</footer>
  </section>;
}
