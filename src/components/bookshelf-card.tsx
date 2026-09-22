"use client";
import {useState} from "react";
import {BookCover} from "./book-cover";
import {BookDisplayTitle} from "./book-display-title";
import { BookShelfAction } from "./book-shelf-action";
import { editionActionLabel, editionImportTime, type WorkspaceBook } from "./workspace-editions";
import { formatName, shelfTitle } from "./bookshelf-model";
export type BookshelfCardProps = {
  book: WorkspaceBook; location?: string; resumeEdition?: string; currentBookId: string; currentEditionId?: string;
  busy?: boolean; onOpen: (id: string, editionId?: string) => void; onChanged: () => void; onUpdated?: () => void;
};
export function BookshelfCard({book, location, resumeEdition, currentBookId, currentEditionId, busy, onOpen, onChanged, onUpdated}: BookshelfCardProps) {
  const [coverRevision,setCoverRevision]=useState(0);
  const title = shelfTitle(book);
  const formats = [...new Set(book.editions?.map(e => formatName(e.fileType)))].join(" / ");
  return <article className="bookshelf-card" data-book-id={book.id}>
    <button type="button" className="bookshelf-open" disabled={busy} aria-label={"阅读《" + title + "》"}
      onClick={() => resumeEdition ? onOpen(book.id, resumeEdition) : onOpen(book.id)}>
      <BookCover key={coverRevision+":"+book.id+":"+(resumeEdition ?? book.editions?.[0]?.id ?? "")} book={book} editionId={resumeEdition} />
      <span className="bookshelf-card-copy"><strong title={title}>{title}</strong><span className="bookshelf-author">{book.author || "作者未注明"}</span>
        <span className="bookshelf-format">{formats}</span>{location && <span className="bookshelf-location" title={location}>{location}</span>}
        <span className="bookshelf-read-action">{currentBookId === book.id || resumeEdition ? "继续阅读" : "打开阅读"}<span aria-hidden="true">↗</span></span>
      </span>
    </button>
    <details className="bookshelf-details" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
      <summary aria-label={"《" + title + "》的更多与版本"}><span>{(book.editions?.length ?? 0) > 1 ? book.editions!.length + " 个版本" : "书籍详情"}</span><span aria-hidden="true">⋯</span></summary>
      <div className="bookshelf-detail-content">
        {book.editions?.some(e=>e.hasOriginalFile && ["EPUB","PDF"].includes(formatName(e.fileType))) && <button type="button" className="bookshelf-cover-retry" onClick={()=>setCoverRevision(value=>value+1)}>重新加载封面</button>}
        <BookDisplayTitle book={book} disabled={busy} onSaved={() => onUpdated?.()} />
        <p className="bookshelf-identity">书籍 ID：{book.id}</p>
        {resumeEdition && (book.editions?.length ?? 0) > 1 && <p className="bookshelf-resume-edition">上次阅读：{book.editions?.find(e => e.id === resumeEdition)?.fileName}</p>}
        {!!book.editions?.length && <div className="bookshelf-editions" aria-label="可选版本">{book.editions.map(edition =>
          <button type="button" key={edition.id} disabled={busy} data-edition-id={edition.id} aria-label={editionActionLabel(book, edition)}
            aria-current={book.id === currentBookId && edition.id === currentEditionId ? "true" : undefined}
            onClick={() => onOpen(book.id, edition.id)}>
            <strong>{edition.fileName || "文件名未记录"}</strong><time dateTime={edition.createdAt}>{editionImportTime(edition.createdAt)}</time>
            <small>{formatName(edition.fileType)} · 版本 ID：{edition.id}</small>
          </button>)}</div>}
        <BookShelfAction bookId={book.id} title={title} disabled={busy} onChanged={onChanged} />
      </div>
    </details>
  </article>;
}
