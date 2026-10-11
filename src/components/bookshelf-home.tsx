"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { applyReadingAppearanceToRoot, readReadingAppearance } from "@/lib/reading-appearance";
import { bookResumeHref } from "@/lib/book-resume";
import { importFileSizeError, IMPORT_TOO_LARGE } from "@/lib/import-limits";
import { readBookResponse } from "@/lib/library";
import { Bookshelf } from "./bookshelf";
import { ImportBookDialog } from "./import-book-dialog";
import { ImportIndexTask } from "./import-index-task";
import { useWorkspaceLibrary } from "./workspace-library";
import "./bookshelf-home.css";

const doNotRestoreBook = async () => undefined;
const stayOnBookshelf = () => undefined;

export function BookshelfHome() {
  const router = useRouter();
  const library = useWorkspaceLibrary(doNotRestoreBook, stayOnBookshelf, fetch, "shelf");
  const input = useRef<HTMLInputElement>(null);
  const autoIndex = useRef(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [indexTask, setIndexTask] = useState<{ editionId: string; title: string } | null>(null);

  useEffect(() => {
    const syncAppearance = () => {
      try { applyReadingAppearanceToRoot(document.documentElement, readReadingAppearance(localStorage).preferences); }
      catch (cause: unknown) { console.error("恢复书架外观失败", cause); setError("书架外观未能恢复，请检查浏览器存储。"); }
    };
    void Promise.resolve().then(syncAppearance);
    window.addEventListener("storage", syncAppearance); window.addEventListener("judu:settings-updated", syncAppearance);
    return () => { window.removeEventListener("storage", syncAppearance); window.removeEventListener("judu:settings-updated", syncAppearance); };
  }, []);

  async function importBook(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const field = event.currentTarget;
    const file = field.files?.[0];
    field.value = "";
    if (!file || importing) return;
    const sizeError = importFileSizeError(file.size);
    if (sizeError) { setError(sizeError); return; }
    setImporting(true); setError(""); setNotice("正在解析书籍…");
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/api/import", { method: "POST", headers: { "X-Judu-Import-Response": "compact" }, body: form });
      const value: unknown = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
      if (!response.ok) {
        const message = typeof value === "object" && value !== null && "error" in value && typeof value.error === "string" ? value.error : response.status === 413 ? IMPORT_TOO_LARGE : "导入失败（HTTP " + response.status + "）";
        throw new Error(message);
      }
      if (typeof value !== "object" || value === null || !("id" in value) || typeof value.id !== "string") throw new Error("导入结果无效，请重试");
      const book = readBookResponse(value, value.id);
      library.setBooks(previous => [book, ...previous.filter(item => item.id !== book.id)]);
      library.refresh();
      // WHY：导入只更新外层书架；进入阅读与书内功能必须由用户再次明确选择书籍。
      setNotice("书籍已导入，请在书架选择它进入阅读。");
      if (autoIndex.current && book.editionId) setIndexTask({ editionId: book.editionId, title: book.title });
    } catch (cause: unknown) {
      console.error("导入书籍失败", cause); setNotice(""); setError(cause instanceof Error ? cause.message : "导入失败，请重试");
    } finally { setImporting(false); }
  }

  return <main className="bookshelf-home" id="main-content" tabIndex={-1}>
    <header className="bookshelf-home-topbar">
      <Link className="bookshelf-home-brand" href="/"><span aria-hidden="true">句</span><strong>句读<small>深度阅读，从一本书开始</small></strong></Link>
      <Link href="/settings" className="bookshelf-home-settings">设置</Link>
    </header>
    <div className="bookshelf-home-intro"><p>你的全部书籍</p><span>选择一本书，进入它的阅读、思维导读和知识库。</span></div>
    {notice && <p className="bookshelf-home-notice" role="status">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice("")}>×</button></p>}
    {error && <p className="bookshelf-home-notice" role="alert">{error}<button type="button" aria-label="关闭错误" onClick={() => setError("")}>×</button></p>}
    <Bookshelf books={library.books} currentBookId="" loading={library.loading} importing={importing} busy={library.loading || importing} error={library.error}
      onOpenBook={(id, editionId) => router.push(bookResumeHref(id, editionId))} onImport={() => setImportOpen(true)} onRefresh={library.refresh}
      onBookArchived={id => library.setBooks(previous => previous.filter(book => book.id !== id))} />
    <input ref={input} id="book-file" hidden type="file" aria-label="导入书籍文件" accept=".mobi,.epub,.pdf,.fb2,.fbz,.fb2.zip,.cbz,.txt,.md,.umd" onChange={event => void importBook(event)} />
    {importOpen && <ImportBookDialog onClose={() => setImportOpen(false)} onChoose={enabled => { autoIndex.current = enabled; setImportOpen(false); input.current?.click(); }} />}
    {indexTask && <ImportIndexTask key={indexTask.editionId} {...indexTask} onClose={() => setIndexTask(null)} onReady={() => setNotice("语义索引已建立，可以进入书籍使用知识库检索。")} onError={setError} />}
  </main>;
}
