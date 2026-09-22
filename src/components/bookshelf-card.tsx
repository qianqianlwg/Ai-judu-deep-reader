"use client";
import {useEffect, useRef} from "react";
import {BookCover} from "./book-cover";
import type {BookDetailsSection} from "./book-details-panel";
import type {WorkspaceBook} from "./workspace-editions";
import {formatName, shelfTitle} from "./bookshelf-model";

export type BookshelfCardProps = {
  book: WorkspaceBook; location?: string; resumeEdition?: string; currentBookId: string;
  coverRevision?: number; busy?: boolean;
  onOpen: (id: string, editionId?: string) => void;
  onDetails: (id: string, section: BookDetailsSection) => void;
};
export function BookshelfCard({book, location, resumeEdition, currentBookId, coverRevision = 0, busy, onOpen, onDetails}: BookshelfCardProps) {
  const menu = useRef<HTMLDetailsElement>(null);
  const title = shelfTitle(book);
  const formats = [...new Set(book.editions?.map(e => formatName(e.fileType)))].join(" / ");
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (menu.current?.open && event.target instanceof Node && !menu.current.contains(event.target)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  const details = (section: BookDetailsSection) => {
    if (menu.current) {
      menu.current.open = false;
      // WHY：对话框关闭时回到可见的更多按钮，而非已折叠菜单里的隐藏按钮。
      menu.current.querySelector("summary")?.focus();
    }
    onDetails(book.id, section);
  };
  return <article className="bookshelf-card" data-book-id={book.id}>
    <button type="button" className="bookshelf-open" disabled={busy} aria-label={"阅读《" + title + "》"}
      onClick={() => resumeEdition ? onOpen(book.id, resumeEdition) : onOpen(book.id)}>
      <BookCover key={coverRevision + ":" + book.id + ":" + (resumeEdition ?? book.editions?.[0]?.id ?? "")} book={book} editionId={resumeEdition} />
      <span className="bookshelf-card-copy"><strong title={title}>{title}</strong><span className="bookshelf-author">{book.author || "作者未注明"}</span>
        {location && <span className="bookshelf-location" title={location}>{location}</span>}
        <span className="bookshelf-read-action">{currentBookId === book.id || resumeEdition ? "继续阅读" : "打开阅读"}<span aria-hidden="true">↗</span></span>
      </span>
    </button>
    <div className="bookshelf-card-meta">
      <span className="bookshelf-format">{formats || "文档"}{(book.editions?.length ?? 0) > 1 && <span> · {book.editions!.length} 个版本</span>}</span>
      <details className="bookshelf-menu" ref={menu} onKeyDown={event => {
        if (event.key === "Escape" && event.currentTarget.open) {
          event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}>
        <summary aria-label={"《" + title + "》的更多操作"}><span aria-hidden="true">⋯</span></summary>
        <div className="bookshelf-menu-content" role="group" aria-label={"《" + title + "》的操作"}>
          <button type="button" onClick={() => details("overview")}>书籍信息</button>
          <button type="button" onClick={() => details("files")}>文件与版本</button>
          <button type="button" onClick={() => details("manage")}>管理书籍</button>
        </div>
      </details>
    </div>
  </article>;
}
