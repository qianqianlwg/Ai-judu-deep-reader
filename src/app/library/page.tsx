"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Book = { id: string; title: string; author: string; chapters: { id: string; title: string; paragraphs: unknown[] }[] };

export default function LibraryPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetch("/api/books").then((response) => response.json()).then(setBooks).finally(() => setLoading(false)); }, []);
  return <main className="library-shell">
    <header className="library-topbar"><Link className="library-brand" href="/"><span className="library-mark">句</span><span><b>句读</b><small>深度阅读器</small></span></Link><Link className="library-back" href="/">返回阅读器 →</Link></header>
    <section className="library-content"><div className="library-heading"><div><div className="library-kicker">MY LIBRARY</div><h1>我的书架</h1><p>选择一本书，继续你的深度阅读。</p></div><label className="library-import">＋ 导入书籍<input type="file" accept=".epub,.pdf,.txt,.md" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; const form = new FormData(); form.append("file", file); await fetch("/api/import", { method: "POST", body: form }); window.location.reload(); }} /></label></div>
      {loading ? <div className="library-empty">正在读取书架……</div> : books.length === 0 ? <div className="library-empty"><div className="empty-symbol">＋</div><h2>还没有书籍</h2><p>导入一本 EPUB、文字型 PDF 或 TXT，开始第一次句读。</p></div> : <div className="book-grid">{books.map((book) => <Link className="book-card" href={`/?bookId=${book.id}`} key={book.id}><div className="book-cover"><span>句读</span><i>经典原著<br />深度阅读</i></div><div className="book-card-info"><h2>{book.title}</h2><p>{book.author}</p><span>{book.chapters.length} 个章节</span></div></Link>)}</div>}
    </section>
  </main>;
}

