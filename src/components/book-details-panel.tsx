"use client";
import {useEffect, useId, useRef, useState} from "react";
import {BookCover} from "./book-cover";
import {BookDisplayTitle} from "./book-display-title";
import {BookShelfAction} from "./book-shelf-action";
import {formatName, shelfTitle} from "./bookshelf-model";
import {editionActionLabel, editionImportTime, type WorkspaceBook} from "./workspace-editions";
import "./book-details-panel.css";

export type BookDetailsSection = "overview" | "files" | "manage";
export type BookDetailsPanelProps = {
  book: WorkspaceBook; initialSection?: BookDetailsSection; resumeEdition?: string; location?: string;
  currentBookId: string; currentEditionId?: string; coverRevision?: number; busy?: boolean;
  onClose: () => void; onOpen: (id: string, editionId?: string) => void;
  onUpdated: () => void; onArchived: () => void; onRetryCover: () => void;
};
const sections = [["overview", "概览"], ["files", "文件与版本"], ["manage", "管理"]] as const;
export function BookDetailsPanel({book, initialSection = "overview", resumeEdition, location, currentBookId, currentEditionId,
  coverRevision = 0, busy, onClose, onOpen, onUpdated, onArchived, onRetryCover}: BookDetailsPanelProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPressed = useRef(false);
  const [section, setSection] = useState<BookDetailsSection>(initialSection);
  const heading = useId();
  const title = shelfTitle(book);
  const editions = book.editions ?? [];
  const resume = editions.find(edition => edition.id === resumeEdition);
  const formats = [...new Set(editions.map(edition => formatName(edition.fileType)))].join(" / ");
  const canResume = currentBookId === book.id || !!resume;
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    // WHY：原生模态层负责焦点约束与背景 inert，详情不挤压书架网格，也不更改阅读工作区。
    element?.showModal();
    return () => {
      element?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  const outside = (x: number, y: number) => {
    const rect = dialog.current?.getBoundingClientRect();
    return !!rect && (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom);
  };
  return <dialog ref={dialog} className="book-details-panel" aria-labelledby={heading}
    onCancel={event => {event.preventDefault(); onClose();}}
    onPointerDown={event => {backdropPressed.current = event.target === event.currentTarget && outside(event.clientX, event.clientY);}}
    onClick={event => {
      if (backdropPressed.current && event.target === event.currentTarget && outside(event.clientX, event.clientY)) onClose();
      backdropPressed.current = false;
    }}>
    <header className="book-details-heading"><div><p>书架</p><h2 id={heading}>书籍信息</h2></div>
      <button type="button" className="book-details-close" aria-label="关闭书籍信息" onClick={onClose}>×</button>
    </header>
    <div className="book-details-body">
      <div className="book-details-identity">
        <BookCover key={coverRevision + ":" + (resumeEdition ?? editions[0]?.id ?? "")} book={book} editionId={resumeEdition} />
        <div><h3>{title}</h3><p>{book.author || "作者未注明"}</p><span>{formats || "文档"}{editions.length > 1 ? " · " + editions.length + " 个版本" : ""}</span></div>
      </div>
      <div className="book-details-sections" role="group" aria-label="书籍信息分类">
        {sections.map(([value, label]) => <button key={value} type="button" aria-pressed={section === value} aria-controls={heading + "-" + value} onClick={() => setSection(value)}>{label}</button>)}
      </div>
      <section id={heading + "-overview"} hidden={section !== "overview"} aria-label="书籍概览">
        <h4>阅读记录</h4>
        <dl className="book-details-facts"><div><dt>阅读位置</dt><dd>{location || (canResume ? "已有阅读记录，打开后恢复位置" : "尚未开始阅读")}</dd></div>
          {resume && <div><dt>上次版本</dt><dd>{resume.fileName || formatName(resume.fileType)}</dd></div>}
          <div><dt>文件版本</dt><dd>{editions.length ? editions.length + " 个版本" : "默认版本"}</dd></div>
          {book.createdAt && <div><dt>导入时间</dt><dd>{editionImportTime(book.createdAt)}</dd></div>}
        </dl>
        <p className="book-details-note">查看书籍信息不会切换正在阅读的书籍。</p>
      </section>
      <section id={heading + "-files"} hidden={section !== "files"} aria-label="文件与版本">
        <h4>选择要阅读的版本</h4>
        <p className="book-details-note">每个版本分别保留阅读位置。同名文件也不会合并。</p>
        {editions.length === 0 && <p className="book-details-note">暂无独立版本信息，可使用下方按钮打开默认版本。</p>}
        <div className="book-details-editions">{editions.map(edition => <article key={edition.id}>
          <div className="book-details-edition-heading"><span>{formatName(edition.fileType)}</span>
            {book.id === currentBookId && edition.id === currentEditionId ? <small>当前打开</small> : edition.id === resumeEdition ? <small>上次阅读</small> : null}
          </div>
          <strong>{edition.fileName || "文件名未记录"}</strong>
          <time dateTime={edition.createdAt}>导入于 {editionImportTime(edition.createdAt)}</time>
          {edition.fileSize !== undefined && <span className="book-details-file-size">{new Intl.NumberFormat("zh-CN", {maximumFractionDigits: 1}).format(edition.fileSize / 1024 / 1024)} MB</span>}
          <button type="button" data-edition-id={edition.id} disabled={busy} aria-label={editionActionLabel(book, edition)}
            aria-current={book.id === currentBookId && edition.id === currentEditionId ? "true" : undefined} onClick={() => onOpen(book.id, edition.id)}>阅读此版本 <span aria-hidden="true">↗</span></button>
        </article>)}</div>
        <details className="book-details-technical"><summary>技术信息</summary><dl><dt>书籍 ID</dt><dd>{book.id}</dd>
          {editions.map(edition => <div key={edition.id}><dt>{edition.fileName || "版本 ID"}</dt><dd>{edition.id}</dd></div>)}
        </dl></details>
      </section>
      <section id={heading + "-manage"} hidden={section !== "manage"} aria-label="管理书籍">
        <h4>显示名称</h4><BookDisplayTitle book={book} disabled={busy} onSaved={onUpdated} />
        {editions.some(edition => edition.hasOriginalFile && ["EPUB", "PDF"].includes(formatName(edition.fileType))) && <div className="book-details-management">
          <h4>书籍封面</h4><p className="book-details-note">封面未显示时可以重试，不会重新导入书籍。</p>
          <button type="button" disabled={busy} onClick={onRetryCover}>重新加载封面</button>
        </div>}
        <div className="book-details-management"><h4>从书架下架</h4><p className="book-details-note">只隐藏书架条目，保留原文件和阅读数据；之后可恢复。</p>
          <BookShelfAction bookId={book.id} title={title} disabled={busy} onChanged={onArchived} />
        </div>
      </section>
    </div>
    <footer className="book-details-footer"><button type="button" disabled={busy} onClick={() => resumeEdition ? onOpen(book.id, resumeEdition) : onOpen(book.id)}>{canResume ? "继续阅读" : "开始阅读"}<span aria-hidden="true">↗</span></button></footer>
  </dialog>;
}
