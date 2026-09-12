"use client";

import { useEffect, useMemo, useState } from "react";

type Paragraph = { id: string; text: string; textHash?: string };
type Chapter = { id: string; title: string; paragraphs: Paragraph[] };
type Book = { id: string; editionId?: string; title: string; author: string; fileName?: string; chapters: Chapter[] };
type Analysis = { summary: string; breakdown: { label: string; text: string }[]; concepts: { name: string; text: string }[]; context: string; uncertainty: string };

const demoBook: Book = { id: "demo", title: "国富论", author: "亚当·斯密", chapters: [
  { id: "chapter-1", title: "第一章 论分工", paragraphs: [
    { id: "p1", text: "劳动生产力上最大的增进，以及运用劳动时所表现的更大的熟练、技巧和判断力，似乎都是分工的结果。" },
    { id: "p2", text: "分工的原因，或许不是人类智慧的结果，而是人类本性中某种倾向的缓慢而逐渐的结果；这种倾向就是互通有无、物物交换、互相交易。" },
    { id: "p3", text: "人们在交换过程中，往往不是因为仁慈，而是因为能够从交换中获得对自己有利的东西。" },
    { id: "p4", text: "正是这种交换的倾向，使每个人都专门从事某种工作，并以自己的劳动成果换取他人的劳动成果。" },
  ] },
  { id: "chapter-2", title: "第二章 论交换的起源", paragraphs: [{ id: "p5", text: "在社会建立以后，人们不可能完全依靠自己的劳动满足一切需要。" }] },
  { id: "chapter-3", title: "第三章 论分工受市场范围的限制", paragraphs: [{ id: "p6", text: "分工的程度，必然受交换能力的大小，或者说受市场范围的限制。" }] },
] };

export default function Home() {
  const [book, setBook] = useState<Book>(demoBook);
  const [activeChapter, setActiveChapter] = useState(demoBook.chapters[0].id);
  const [selected, setSelected] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadedName, setUploadedName] = useState("");
  const chapter = useMemo(() => book.chapters.find((item) => item.id === activeChapter) ?? book.chapters[0], [activeChapter, book]);
  const analysisVisible = loading || Boolean(analysis);

  useEffect(() => {
    fetch("/api/books").then((response) => response.json()).then((books: Book[]) => {
      if (books[0]?.chapters?.length) { setBook(books[0]); setActiveChapter(books[0].chapters[0].id); }
    }).catch(() => undefined);
  }, []);

  function handleSelection() { const value = window.getSelection()?.toString().trim() ?? ""; if (value) setSelected(value); }

  async function runAnalysis() {
    if (!selected) return;
    setAnalysis(null); setLoading(true);
    const currentIndex = chapter.paragraphs.findIndex((paragraph) => paragraph.text.includes(selected.slice(0, 8)));
    const context = chapter.paragraphs.slice(Math.max(0, currentIndex - 1), currentIndex + 2).map((paragraph) => paragraph.text).join("\n");
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selectedText: selected, context, chapterTitle: chapter.title, bookTitle: book.title, editionId: book.editionId, chapterId: chapter.id, paragraphId: currentIndex >= 0 ? chapter.paragraphs[currentIndex].id : null }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "句读失败");
      setAnalysis(data.result);
    } catch { setAnalysis({ summary: "句读服务暂时不可用，请稍后重试。", breakdown: [], concepts: [], context: "", uncertainty: "请求失败。" }); }
    finally { setLoading(false); }
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setUploadedName(file.name); setLoading(true);
    const form = new FormData(); form.append("file", file);
    try {
      const response = await fetch("/api/import", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "导入失败");
      if (!data.chapters?.length) throw new Error("文件中没有提取到正文");
      setBook(data); setActiveChapter(data.chapters[0].id); setSelected(""); setAnalysis(null);
    } catch (error) { setUploadedName(error instanceof Error ? error.message : "导入失败"); }
    finally { setLoading(false); }
  }

  return <main className="app-shell">
    <header className="topbar"><a className="brand-wrap" href="/library"><div className="brand-mark">句</div><div><div className="brand-name">句读</div><div className="brand-subtitle">深度阅读器</div></div></a><div className="book-meta"><span className="book-title">《{book.title}》</span><span className="book-divider">/</span><span>{chapter?.title}</span></div><div className="top-actions"><label className="import-button"><span>＋</span> 导入书籍<input type="file" accept=".epub,.pdf,.txt,.md" onChange={handleFile} /></label><button className="avatar" aria-label="用户菜单">Q</button></div></header>
    {uploadedName && <div className="upload-toast">{loading ? "正在解析书籍……" : `已加载：${uploadedName}`}</div>}
    <section className="reader-layout"><aside className="sidebar"><div className="sidebar-heading"><span>目录</span><span className="muted">{book.chapters.length} 章</span></div><div className="chapter-list">{book.chapters.map((item, index) => <button key={item.id} className={`chapter-item ${activeChapter === item.id ? "active" : ""}`} onClick={() => { setActiveChapter(item.id); setAnalysis(null); setSelected(""); }}><span className="chapter-index">{String(index + 1).padStart(2, "0")}</span><span>{item.title.replace(/^第[一二三四五六七八九十]+章\s*/, "")}</span></button>)}</div><div className="sidebar-footer"><span className="status-dot" />本地阅读空间</div></aside>
      <article className={`reading-pane ${analysisVisible ? "with-panel" : ""}`}><div className="reading-toolbar"><div className="eyebrow">{book.author.toUpperCase()} · CLASSICS</div><div className="toolbar-actions"><button>−</button><span>Aa</span><button>＋</button><button className="more-button">···</button></div></div><div className="reading-content" onMouseUp={handleSelection}><div className="chapter-kicker">{chapter.title.split(" ")[0]}</div><h1>{chapter.title.substring(chapter.title.indexOf(" ") + 1)}</h1><div className="ornament">✦</div>{chapter.paragraphs.map((paragraph) => <p key={paragraph.id}>{paragraph.text}</p>)}<div className="page-marker">— {String(chapter.paragraphs.length).padStart(2, "0")} —</div></div>{selected && !analysisVisible && <div className="selection-toolbar"><span className="selection-count">已选择 {selected.length} 个字</span><button onClick={runAnalysis}><span>✦</span> 句读一下</button></div>}</article>
      {analysisVisible && <aside className="analysis-panel"><div className="analysis-header"><div><div className="panel-kicker">AI READING TOOL</div><h2>句读</h2></div><button className="close-button" onClick={() => setAnalysis(null)}>×</button></div>{loading ? <div className="loading-state"><div className="loading-orbit">✦</div><h3>正在理解这段文字</h3><p>正在结合当前章节和前后文进行分析……</p></div> : <div className="analysis-content"><section className="analysis-section selected-section"><div className="section-label">原文 <span>当前选择</span></div><blockquote>“{selected}”</blockquote></section><section className="analysis-section"><div className="section-label"><span className="number">01</span> 通俗解释</div><p>{analysis!.summary}</p></section><section className="analysis-section"><div className="section-label"><span className="number">02</span> 句子拆解</div><div className="breakdown">{analysis!.breakdown.length ? analysis!.breakdown.map((item) => <div key={item.label}><b>{item.label}</b><span>{item.text}</span></div>) : <div><b>提示</b><span>暂无拆解结果。</span></div>}</div></section><section className="analysis-section"><div className="section-label"><span className="number">03</span> 关键词</div><div className="tags">{analysis!.concepts.length ? analysis!.concepts.map((item) => <span key={item.name} title={item.text}>{item.name}</span>) : <span>暂无关键词</span>}</div></section><div className="panel-footer"><button onClick={() => setAnalysis(null)}>← 回到原文</button><span>{analysis!.uncertainty || "基于当前段落"}</span></div></div>}</aside>}
    </section></main>;
}











