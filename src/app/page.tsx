"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { AnalysisPanel } from "@/components/analysis-panel";
import { type Analysis, type ChatMessage, type MessageAnchor } from "@/lib/chat-stream";
import { createReadingRequest, restoreReadingRequest, beginReadingRequest, applyReadingRequest, executeReadingRequest, type ReadingRequestState } from "@/lib/reading-request";
import { KnowledgePanel } from "@/components/knowledge-panel";
import { fetchBookKnowledge } from "@/lib/knowledge";
import { hydrateChatHistory } from "@/lib/chat-history";
import { type PaginatedParagraph } from "@/lib/pagination";
import { readReadingSelection, type ReadingSelection } from "@/lib/reader-selection";
import { useConceptPreference, setConceptPreference } from "@/hooks/use-concept-preference";
import { useReaderPages } from "@/hooks/use-reader-pages";
import "@/components/reader-workspace.css";
import { collapseButtonState } from "@/lib/reader-layout";
import { AnnotatedParagraph } from "@/components/annotated-paragraph";
import { createAnnotation, dedupeAnnotations, type TextAnnotation } from "@/lib/annotations";

type Paragraph = { id: string; text: string };
type Chapter = { id: string; title: string; paragraphs: Paragraph[] };
type Book = { id: string; editionId?: string; title: string; author: string; chapters: Chapter[] };
type SearchResult = {
  paragraphId: string;
  chapterId: string;
  chapterTitle: string;
  excerpt: string;
  matchedText?: string;
  startOffset?: number;
  sourceId?: string;
  retrieval?: { backend: "postgres" | "sqlite"; keywordScore: number; vectorSimilarity: number; rrfScore: number; vectorUsed: boolean };
};
type SearchStatus = { backend: "postgres" | "sqlite"; editionId: string; paragraphCount: number; indexedCount: number; vectorIndexed: boolean; note: string };
type RestoredMessage = { id: string; role: "user" | "assistant"; content: string; structuredOutput?: string | null; status?: "streaming" | "completed" | "error" };

const demoBook: Book = {
  id: "demo",
  title: "国富论",
  author: "亚当·斯密",
  chapters: [
    { id: "chapter-1", title: "第一章 论分工", paragraphs: [
      { id: "p1", text: "劳动生产力上最大的增进，以及运用劳动时所表现的更大的熟练、技巧和判断力，似乎都是分工的结果。" },
      { id: "p2", text: "分工的原因，也许不是人类智慧的结果，而是人类本性中某种倾向的缓慢而逐渐的结果；这种倾向就是互通有无、物物交换、互相交易。" },
      { id: "p3", text: "人们在交换过程中，往往不是因为仁慈，而是因为能够从交换中获得对自己有利的东西。" },
      { id: "p4", text: "正是这种交换的倾向，使每个人都专门从事某种工作，并以自己的劳动成果换取他人的劳动成果。" },
    ] },
    { id: "chapter-2", title: "第二章 论交换的起源", paragraphs: [{ id: "p5", text: "在社会建立以后，人们不可能完全依靠自己的劳动满足一切需要。" }] },
    { id: "chapter-3", title: "第三章 论分工受市场范围的限制", paragraphs: [{ id: "p6", text: "分工的程度，必然受交换能力的大小，或者说受市场范围的限制。" }] },
  ],
};

function flatten(book: Book): PaginatedParagraph[] {
  return book.chapters.flatMap((chapter) => chapter.paragraphs.map((paragraph) => ({ ...paragraph, chapterId: chapter.id, chapterTitle: chapter.title })));
}

export default function Home() {
  const [book, setBook] = useState<Book>(demoBook);
  const [books, setBooks] = useState<Book[]>([]);
  const [booksCollapsed, setBooksCollapsed] = useState(false);
  const [tocCollapsed, setTocCollapsed] = useState(false);
  const [mobileTocOpen, setMobileTocOpen] = useState(false);
  const [mobileAnalysisOpen, setMobileAnalysisOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [selectionAnchor, setSelectionAnchor] = useState<ReadingSelection | null>(null);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeRevision, setKnowledgeRevision] = useState(0);
  const [activeSource, setActiveSource] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [bookLoading, setBookLoading] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [theme] = useState("light");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<SearchStatus | null>(null);
  const [threadId, setThreadId] = useState("");
  const [notice, setNotice] = useState("");
  const [annotations, setAnnotations] = useState<TextAnnotation[]>(() => {
    if (typeof window === "undefined") return [];
    return [];
  });
  const showConcepts = useConceptPreference();
  const [bookConcepts, setBookConcepts] = useState<{name:string;text:string}[]>([]);
  const [error, setError] = useState("");
  const readingRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeRequestRef = useRef(false);
  const lastRequestRef = useRef<ReadingRequestState | null>(null);
  const [conversationRevision, setConversationRevision] = useState(0);
  const bookLoadSequence = useRef(0);
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
  const sourceParagraphs = useMemo(() => flatten(book), [book]);
  const { pages, pageIndex: safePageIndex, currentPage, setPageIndex, setAnchor: setReadingAnchor, busy: paginating, error: paginationError, renderedScale } = useReaderPages(sourceParagraphs, readingRef, fontScale);
  const shelfBooks = books.length ? books : [book];
  const annotationStorageKey = `judu:annotations:${book.id}:${book.editionId ?? "demo"}`;
  const shelfCollapse = collapseButtonState(!booksCollapsed, "书籍");
  const tocCollapse = collapseButtonState(!tocCollapsed, "目录");

  useEffect(() => {
    let disposed = false;
    const fallback = (): void => {
      const raw = localStorage.getItem(annotationStorageKey);
      try {
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (!disposed && Array.isArray(parsed)) setAnnotations(dedupeAnnotations(parsed as TextAnnotation[]));
      } catch (loadError: unknown) {
        console.error("加载标注失败", loadError);
        if (!disposed) setAnnotations([]);
      }
    };
    void fetch(`/api/annotations?editionId=${encodeURIComponent(book.editionId ?? "demo")}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("加载标注请求失败");
        return response.json() as Promise<{ annotations?: TextAnnotation[] }>;
      })
      .then((data) => { if (!disposed) setAnnotations(dedupeAnnotations(data.annotations ?? [])); })
      .catch((loadError: unknown) => { console.error("加载标注请求失败", loadError); fallback(); });
    return () => { disposed = true; };
  }, [annotationStorageKey, book.editionId]);

  useEffect(() => {
    const editionId = book.editionId;
    if (!editionId) return;
    let disposed = false;
    void fetch("/api/search/status?editionId=" + encodeURIComponent(editionId))
      .then(async (response) => {
        if (!response.ok) throw new Error("读取检索状态失败");
        return response.json() as Promise<SearchStatus>;
      })
      .then((status) => { if (!disposed) setSearchStatus(status); })
      .catch((statusError: unknown) => { console.error("读取检索状态失败", statusError); if (!disposed) setSearchStatus(null); });
    return () => { disposed = true; };
  }, [book.editionId]);

  useEffect(() => {
    void fetch("/api/library")
      .then(async (response) => {
        if (!response.ok) throw new Error("加载书籍请求失败");
        return response.json() as Promise<{ id: string; title: string; author: string }[]>;
      })
      .then((items) => {
        setBooks(items.map((item) => ({ ...item, chapters: [] })));
      })
      .catch((loadError: unknown) => console.error("加载书籍失败", loadError));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (book.editionId) void fetchBookKnowledge(book.editionId, controller.signal)
      .then(data => { if(!controller.signal.aborted) setBookConcepts(data.concepts.flatMap(c=>c.definitions.length ? c.definitions.map(d=>({name:c.name,text:d.text})) : [{name:c.name,text:""}])); })
      .catch((cause:unknown)=>{ if(controller.signal.aborted)return; console.error("读取本书概念失败",cause); setNotice("本书概念读取失败，请刷新知识卡片。"); });
    return ()=>controller.abort();
  }, [book.editionId, knowledgeRevision]);
  const visibleConcepts = useMemo(()=>[...bookConcepts,...annotations.flatMap(a=>a.conceptDetails??[])],[bookConcepts,annotations]);

  useEffect(() => {
    if (!threadId || activeRequestRef.current) return;
    let disposed = false;
    void fetch(`/api/threads/${encodeURIComponent(threadId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("读取对话失败");
        return response.json() as Promise<{ thread?: { selectedText?: string | null }; messages?: RestoredMessage[] }>;
      })
      .then((data) => {
        if (disposed || activeRequestRef.current) return;
        const restored = hydrateChatHistory(data.messages ?? []);
        setMessages(restored);
        setAnalysis(restored.at(-1)?.analysis ?? null);
        const lastSaved = data.messages?.at(-1);
        const retry = lastSaved ? restoreReadingRequest(threadId, { ...lastSaved, status:lastSaved.status ?? "completed" }, restored) : null;
        lastRequestRef.current = retry; setError(retry?.error ?? "");
      })
      .catch((loadError: unknown) => { console.error("读取对话失败", loadError); setNotice("读取对话失败，请重新打开本书。"); });
    return () => { disposed = true; };
  }, [threadId, conversationRevision]);

  useEffect(() => {
    if (!focusedMessageId || knowledgeOpen) return;
    const frame = requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>('[data-message-id="' + CSS.escape(focusedMessageId) + '"]');
      const scroller = node?.closest<HTMLElement>(".chat-messages");
      if (node && scroller) { scroller.dataset.followLatest = "false"; scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16; setFocusedMessageId(null); }
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedMessageId, messages, knowledgeOpen]);

  async function saveAnnotation(annotation: TextAnnotation): Promise<void> {
    setAnnotations((previous) => {
      const next = dedupeAnnotations([...previous, annotation]);
      localStorage.setItem(annotationStorageKey, JSON.stringify(next));
      return next;
    });
    const paragraphText = flatten(book).find((item) => item.id === annotation.paragraphId)?.text;
    if (!paragraphText) return;
    const response = await fetch("/api/annotations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(annotation) });
    if (!response.ok) throw new Error("句读标注保存失败（" + response.status + "）");
  }

  function openAnnotation(annotation: TextAnnotation): void {
    const text = annotationParagraphText(annotation); setSelected(text);
    setSelectionAnchor({paragraphId:annotation.paragraphId,startOffset:annotation.startOffset,endOffset:annotation.endOffset,text});
    setReadingAnchor({paragraphId:annotation.paragraphId,offset:annotation.startOffset}); setActiveSource(annotation.paragraphId);
    openConversation(annotation.threadId, annotation.messageId ?? null);
  }

  function annotationParagraphText(annotation: TextAnnotation): string {
    const paragraph = flatten(book).find((item) => item.id === annotation.paragraphId);
    return paragraph?.text.slice(annotation.startOffset, annotation.endOffset) ?? "";
  }

  function selectText(): void {
    const selection = readReadingSelection(window.getSelection(), readingRef.current!);
    if (!selection) return;
    const original = sourceParagraphs.find(p => p.id === selection.paragraphId);
    if (original?.text.slice(selection.startOffset, selection.endOffset) !== selection.text) { setNotice("选区位置校验失败，请重新选择原文。"); return; }
    setSelected(selection.text); setSelectionAnchor(selection); setReadingAnchor({ paragraphId: selection.paragraphId, offset: selection.startOffset });
  }

  function setReaderScale(change: number): void {
    setFontScale((value) => {
      const next = Math.min(1.3, Math.max(0.85, Number((value + change).toFixed(2))));
      localStorage.setItem("judu:fontScale", String(next));
      return next;
    });
  }

  async function loadBook(bookId: string): Promise<void> {
    if (activeRequestRef.current) { setNotice("请等待当前回答完成后再切换书籍。"); return; }
    const loadSequence = ++bookLoadSequence.current;
    setBookLoading(true);
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(bookId)}`);
      if (!response.ok) throw new Error("读取书籍失败");
      const loaded = await response.json() as Book;
      if (loadSequence !== bookLoadSequence.current) return;
      setReadingAnchor(null); lastRequestRef.current = null; setError("");
      setBook(loaded); setAnnotations([]); setBookConcepts([]); setSelectionAnchor(null); setKnowledgeOpen(false); setActiveSource(""); setSelected(""); setMessages([]); setAnalysis(null); setSearchResults([]);
      const savedThread = localStorage.getItem(`judu:thread:${loaded.id}`) ?? "";
      setThreadId(savedThread); setConversationRevision(value=>value+1);
    } catch (loadError: unknown) {
      console.error("读取书籍失败", loadError);
      setNotice(loadError instanceof Error ? loadError.message : "读取书籍失败");
    } finally { if(loadSequence===bookLoadSequence.current) setBookLoading(false); }
  }

  async function searchBook(): Promise<void> {
    if (!searchQuery.trim()) return;
    try {
      const response = await fetch(`/api/search?editionId=${encodeURIComponent(book.editionId ?? "demo")}&q=${encodeURIComponent(searchQuery)}&context=1`);
      if (!response.ok) throw new Error("搜索失败");
      const data = await response.json() as { results?: SearchResult[] };
      setSearchResults(data.results ?? []); setNotice(`找到 ${data.results?.length ?? 0} 个结果`);
    } catch (searchError: unknown) {
      console.error("搜索失败", searchError);
      setNotice(searchError instanceof Error ? searchError.message : "搜索失败");
    }
  }

  function jumpToResult(result: SearchResult): void {
    setReadingAnchor({ paragraphId: result.paragraphId, offset: result.startOffset ?? 0 });
    setActiveSource(result.paragraphId);
    const paragraph = flatten(book).find((item) => item.id === result.paragraphId);
    const match = result.matchedText ?? result.excerpt;
    if (paragraph && match) setSelected(match);
    window.requestAnimationFrame(() => {
      const node = readingRef.current?.querySelector(`[data-paragraph-id="${CSS.escape(result.paragraphId)}"]`);
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  async function importBook(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setNotice("正在解析书籍…");
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/api/import", { method: "POST", body: form });
      const data = await response.json() as Book & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "导入失败");
      setBooks((previous) => [data, ...previous.filter((item) => item.id !== data.id)]);
      await loadBook(data.id);
      setNotice("书籍已导入");
    } catch (importError: unknown) {
      console.error("导入书籍失败", importError);
      setNotice(importError instanceof Error ? importError.message : "导入失败");
    } finally { event.target.value = ""; }
  }

  async function runRequest(request: ReadingRequestState): Promise<void> {
    if (activeRequestRef.current) return;
    const started = beginReadingRequest(request, messages);
    lastRequestRef.current = started.state; activeRequestRef.current = true;
    setMessages(started.messages); setLoading(true); setError(""); setKnowledgeOpen(false); setMobileAnalysisOpen(true);
    setThreadId(request.payload.threadId); localStorage.setItem("judu:thread:" + book.id, request.payload.threadId);
    try {
      const finished = await executeReadingRequest(started.state, { onState: (state) => {
        if(lastRequestRef.current?.payload.clientAssistantMessageId !== state.payload.clientAssistantMessageId)return;
        lastRequestRef.current = state; setMessages(previous => applyReadingRequest(previous, state));
      } });
      if (finished.status !== "completed") { setError(finished.error ?? "生成失败，请重试"); return; }
      const result = finished.analysis; if (!result) return;
      setAnalysis(result);
      const input = finished.payload;
      const paragraph = sourceParagraphs.find(p => p.id === input.paragraphId);
      if (input.mode === "analyze" && paragraph && input.selectionStart !== undefined && input.selectionEnd !== undefined) {
        const annotation = createAnnotation({ paragraphId:paragraph.id, startOffset:input.selectionStart, endOffset:input.selectionEnd, threadId:input.threadId, messageId:input.clientAssistantMessageId, summary:result.summary, concepts:result.concepts.map(c=>c.name), conceptDetails:result.concepts, createdAt:new Date().toISOString() }, paragraph.text);
        await saveAnnotation(annotation);
      }
      setKnowledgeRevision(value => value + 1);
    } catch (cause: unknown) { console.error("句读保存失败", cause); setNotice("回答已显示，但保存失败，请刷新知识卡片检查。"); }
    finally { activeRequestRef.current = false; setLoading(false); }
  }

  async function ask(question = "请句读这一段", requestedMode: "chat" | "analyze" = "analyze"): Promise<void> {
    if (!question.trim() || loading || bookLoading || !currentPage) return;
    if (requestedMode === "analyze" && !selectionAnchor) { setNotice("请重新选中要句读的原文。"); return; }
    const paragraph = sourceParagraphs.find(p=>p.id===selectionAnchor?.paragraphId) ?? currentPage.paragraphs[0];
    const strategy = localStorage.getItem("judu:compressionStrategy");
    const request = createReadingRequest({ mode:requestedMode, question, selectedText:selected, threadId, bookId:book.id, editionId:book.editionId ?? "demo", bookTitle:book.title, chapterTitle:paragraph.chapterTitle, chapterId:paragraph.chapterId, paragraphId:paragraph.id, selectionStart:selectionAnchor?.startOffset, selectionEnd:selectionAnchor?.endOffset, context:paragraph.text, chatHistory:messages.filter(m=>m.status!=="error"), bookSearch:searchResults.slice(0,8), contextSettings:{maxInputTokens:Number(localStorage.getItem("judu:maxInputTokens")??32768),maxOutputTokens:4096,compressionStrategy:strategy==="aggressive"||strategy==="conservative"?strategy:"balanced"} });
    await runRequest(request);
  }

  async function retryRequest(): Promise<void> {
    const request = lastRequestRef.current;
    if (request && (request.status === "error" || request.status === "cancelled")) await runRequest(request);
  }

  function openConversation(id: string, messageId: string | null): void {
    if(activeRequestRef.current && id!==threadId) { setNotice("请等待当前回答完成后再打开另一段对话。"); return; }
    setConversationRevision(value=>value+1);
    setKnowledgeOpen(false); setMobileAnalysisOpen(true); setFocusedMessageId(messageId); setThreadId(id);
  }

  function openKnowledgeSource(anchor: MessageAnchor): void {
    const original = sourceParagraphs.find(p=>p.id===anchor.paragraphId);
    if (original?.text.slice(anchor.startOffset,anchor.endOffset) !== anchor.selectedText) { setNotice("这条消息的原文位置无法在当前版本验证，请重新选择原文。"); return; }
    setReadingAnchor({paragraphId:anchor.paragraphId,offset:anchor.startOffset}); setActiveSource(anchor.paragraphId);
    setSelected(anchor.selectedText); setSelectionAnchor({paragraphId:anchor.paragraphId,startOffset:anchor.startOffset,endOffset:anchor.endOffset,text:anchor.selectedText});
  }

  function openCitation(paragraphId: string, quote: string, messageId?: string): void {
    const paragraph = sourceParagraphs.find(p=>p.id===paragraphId);
    const startOffset = paragraph?.text.indexOf(quote) ?? -1;
    if (startOffset < 0) { setNotice("引用位置无法在当前版本复核，请查看知识卡片来源。"); return; }
    openKnowledgeSource({paragraphId,startOffset,endOffset:startOffset+quote.length,selectedText:quote});
    if (messageId) setFocusedMessageId(messageId);
  }
  return <main className={`app-shell theme-${theme}`}>
    <header className="topbar"><div className="brand-mark"><span>句</span><div><strong>句读</strong><small>深度阅读器</small></div></div><div className="top-actions"><button className="mobile-toc-toggle" onClick={() => setMobileTocOpen((value) => !value)}>书籍</button><button className="mobile-analysis-toggle" onClick={() => setMobileAnalysisOpen((value) => !value)}>句读</button><label className="search-box"><span>⌕</span><input ref={searchRef} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchBook(); }} placeholder="搜索本书" /></label><button onClick={() => document.getElementById("book-file")?.click()}>导入书籍</button><a className="settings-link" href="/settings" aria-label="设置">⚙</a><input id="book-file" hidden type="file" accept=".epub,.pdf,.txt,.md" onChange={(event) => { void importBook(event); }} /></div></header>
    {notice && <div className="upload-toast">{notice}</div>}
    <section className="reader-layout">
      <aside className={mobileTocOpen ? "toc-panel mobile-open" : "toc-panel"}>
        <nav className="sidebar-nav" aria-label={"\u4e3b\u5bfc\u822a"}><button className="sidebar-nav-item active" disabled={loading || bookLoading} onClick={() => { setSelected(""); setAnalysis(null); setMessages([]); setError(""); setMobileTocOpen(false); }}><span aria-hidden="true">+</span><span>{"\u65b0\u9605\u8bfb"}</span></button><button className="sidebar-nav-item" onClick={() => { setBooksCollapsed(false); setMobileTocOpen(true); }}><span aria-hidden="true">#</span><span>{"\u4e66\u7c4d"}</span></button><button className="sidebar-nav-item" onClick={() => { setMobileTocOpen(true); window.requestAnimationFrame(() => searchRef.current?.focus()); }}><span aria-hidden="true">?</span><span>{"\u641c\u7d22"}</span></button></nav>
        <button className="sidebar-nav-item knowledge-entry" onClick={() => { setKnowledgeOpen(true); setMobileAnalysisOpen(true); }}>本书知识卡片</button><div className="shelf-heading"><span>书籍 <small>{shelfBooks.length}</small></span><button onClick={() => setBooksCollapsed((value) => !value)} aria-label={shelfCollapse.label}>{shelfCollapse.symbol}</button></div>{!booksCollapsed && <div className="book-shelf">{shelfBooks.map((item) => <button key={item.id} disabled={bookLoading || loading} className={item.id === book.id ? "shelf-book active" : "shelf-book"} onClick={() => void loadBook(item.id)}><span className="shelf-icon">书</span><span>{item.title}</span></button>)}</div>}<div className="toc-heading"><span>目录</span><button onClick={() => setTocCollapsed((value) => !value)} aria-label={tocCollapse.label}>{tocCollapse.symbol}</button></div>{!tocCollapsed && book.chapters.map((chapter, index) => <button className={chapter.id === currentPage?.chapterId ? "toc-item active" : "toc-item"} key={chapter.id} onClick={() => { const target = pages.findIndex((page) => page.paragraphs.some((paragraph) => paragraph.chapterId === chapter.id)); if (target >= 0) setPageIndex(target); }}><small>{String(index + 1).padStart(2, "0")}</small><span>{chapter.title}</span></button>)}{(searchStatus || searchResults.length > 0) && <div className="search-status" data-testid="search-status">{searchStatus && <><span className={searchStatus.vectorIndexed ? "index-ready" : "index-fallback"}>{searchStatus.vectorIndexed ? "向量检索可用" : "关键词检索"} · {searchStatus.indexedCount}/{searchStatus.paragraphCount} 段</span><small>{searchStatus.note}</small></>}</div>}{searchResults.length > 0 && <div className="search-results">{searchResults.map((result) => <button key={result.paragraphId} onClick={() => jumpToResult(result)}>{result.chapterTitle}<span>{result.excerpt}</span><small>{result.retrieval?.vectorUsed ? "关键词 + 向量 · " : "关键词 · "}{result.sourceId ? "点击跳回原文" : "本书全文"}</small></button>)}</div>}<div className="recent-heading">{"\u6700\u8fd1\u9605\u8bfb"}</div>
        <div className="recent-list">{shelfBooks.slice(0, 5).map((item) => <button key={`recent-${item.id}`} className="recent-item" onClick={() => void loadBook(item.id)}>{item.title}</button>)}</div>
        <div className="sidebar-footer-actions"><a href="/settings" className="sidebar-account"><span aria-hidden="true">@</span><span>{"\u8bbe\u7f6e"}</span></a><button className="help-button" aria-label={"\u5e2e\u52a9"}>?</button></div>
      </aside>
      <article className="reading-pane" aria-busy={bookLoading || paginating}>
        <div className="reading-toolbar"><span className="chapter-context">{currentPage?.chapterTitle ?? "当前章节"}</span><button className="concept-toggle" aria-pressed={showConcepts} onClick={() => setConceptPreference(!showConcepts)}>概念 {showConcepts ? "开" : "关"}</button></div>
        <div className="reading-content" ref={readingRef} onMouseUp={selectText}>
          <div className="reader-sheet" data-measuring={paginating} style={{ "--reading-scale": renderedScale } as CSSProperties}>
            {currentPage?.isChapterStart && <div className="page-heading"><small>{currentPage.chapterTitle}</small><h1>{currentPage.chapterTitle}</h1></div>}
            {currentPage?.paragraphs.map((paragraph) => <AnnotatedParagraph key={paragraph.id + ":" + (paragraph.sourceStartOffset ?? 0)} paragraphId={paragraph.id} text={paragraph.text} sourceText={sourceParagraphs.find(p=>p.id===paragraph.id)?.text} bookConcepts={visibleConcepts} sourceStartOffset={paragraph.sourceStartOffset ?? 0} sourceEndOffset={paragraph.sourceEndOffset} active={activeSource === paragraph.id} annotations={annotations} showConcepts={showConcepts} onOpenAnnotation={openAnnotation} />)}
          </div>
          {(paginating || paginationError) && <div className="reader-paginating" role="status">{paginationError || "正在按阅读区域重新排版…"}</div>}
        </div>
        <div className="selection-bar"><div className="reading-settings" aria-label="阅读设置"><span>Aa</span><button aria-label="缩小字号" onClick={() => setReaderScale(-0.05)}>−</button><button aria-label="放大字号" onClick={() => setReaderScale(0.05)}>+</button></div><div className="selection-actions">{selected ? <><span>已选择 {selected.length} 个字</span><button disabled={loading || bookLoading || paginating} onClick={() => void ask()}>句读一下</button></> : <span>选择一句或一段原文开始句读</span>}</div></div>
        <div className="page-nav"><button disabled={paginating || safePageIndex === 0} onClick={() => setPageIndex(safePageIndex - 1)}>上一页</button><span>{pages.length ? safePageIndex + 1 : 0} / {pages.length}</span><button disabled={paginating || safePageIndex >= pages.length - 1} onClick={() => setPageIndex(safePageIndex + 1)}>下一页</button></div>
      </article>
      {knowledgeOpen ? <KnowledgePanel editionId={book.editionId ?? null} bookTitle={book.title} refreshToken={knowledgeRevision} onRefreshRequested={() => setKnowledgeRevision(value=>value+1)} className={mobileAnalysisOpen ? "analysis-panel mobile-open" : "analysis-panel"} onClose={() => setKnowledgeOpen(false)} onOpenSource={openKnowledgeSource} onOpenConversation={openConversation} /> : <AnalysisPanel className={mobileAnalysisOpen ? "analysis-panel mobile-open" : "analysis-panel"} selected={selected} analysis={analysis} loading={loading} error={error} messages={messages} onClose={() => { if(activeRequestRef.current)return; setAnalysis(null); setMessages([]); setThreadId(""); lastRequestRef.current=null; setError(""); }} onBack={() => setSelected("")} onSend={(question) => void ask(question, "chat")} onRetry={() => void retryRequest()} onOpenSource={openKnowledgeSource} onOpenCitation={openCitation} />}
    </section>
  </main>;
}
