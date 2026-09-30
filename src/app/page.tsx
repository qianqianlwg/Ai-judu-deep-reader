"use client";
import { GuideWorkspace } from "@/components/guide-workspace";
import type { GuideSource } from "@/lib/guide-sources";
import { useSourceEmphasis } from "@/hooks/use-source-emphasis";
import { ReadingOptions } from "@/components/reading-options";
import {useReadingStyle} from '@/components/reading-style-control';
import {SectionReadingAction} from '@/components/section-reading-action';
import {type ReadingStyle} from '@/lib/semantic-reading';
import { analysisHistoryMarkerIds } from "@/lib/analysis-history-markers";
import { pageConceptHighlights } from "@/lib/page-concept-highlights";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import {useShelfHistoryRecorder} from "@/hooks/use-shelf-history-recorder";
import { useBookshelfAssistant } from "@/hooks/use-bookshelf-assistant";
import { ReaderModeSwitch, useReaderMode } from "@/components/reader-mode";
import "@/components/epub-reader.css";
import { ChatPanelResizer } from "@/components/chat-panel-resizer";
import { maxChatWidth } from "@/lib/chat-layout";
import { ReaderOptions } from "@/components/reader-options";
import { useReadingPreferences } from "@/components/use-reading-preferences";
import { readReadingPreferences } from "@/lib/reading-preferences";
import { AnalysisPanel } from "@/components/analysis-panel";
import { emptyExternalPermissions, readExternalPermissions, type ExternalPermissions } from "@/lib/agent/external-permissions";
import { defaultExternalPreferences, permittedExternalSources, readExternalPreferences, writeExternalPreferences } from "@/lib/agent/external-preferences";
import { type Analysis, type ChatMessage, type MessageAnchor, type TokenUsage } from "@/lib/chat-stream";
import { createReadingRequest, restoreReadingRequest, withRetryContextSettings, beginReadingRequest, applyReadingRequest, executeReadingRequest, prepareReadingEdit, type ReadingRequestState } from "@/lib/reading-request";
import { WorkspaceNav, type WorkspaceView } from "@/components/workspace-nav";
import {BOOK_RESUME_CHANGED} from "@/lib/book-resume";
import {importFileSizeError,IMPORT_TOO_LARGE} from "@/lib/import-limits";
import { Bookshelf } from "@/components/bookshelf";
import { ImportBookDialog } from "@/components/import-book-dialog";
import { ImportIndexTask } from "@/components/import-index-task";
import { useWorkspaceLibrary } from "@/components/workspace-library";
import { bookEditionUrl, readBookResponse, rememberedEdition, type LibraryBookContent as Book } from "@/lib/library";
import {useNavCollapse} from "@/hooks/use-nav-collapse";
import { useWorkspaceModel } from "@/components/workspace-model";
import { useWorkspaceSelection } from "@/components/workspace-selection";
import { useBookSemanticSearch } from "@/components/use-book-semantic-search";
import { selectionFromSearchResult,restoreWorkspaceReadingAnchor } from "@/components/workspace-reading-location";
import { KnowledgeWorkspace } from "@/components/knowledge-workspace";
import type { KnowledgeMaterial } from "@/lib/knowledge-materials";
import { fetchBookKnowledge } from "@/lib/knowledge";
import { hydrateChatHistory } from "@/lib/chat-history";
import { createConversationClient, isConversationId, type ConversationSummary } from "@/lib/conversations";
import { type PaginatedParagraph } from "@/lib/pagination";
import { mergeContinuousSelections, selectionParts, selectionAnchors, selectionFromParts, selectionMatchesParagraphs, readReadingSelection, type ReadingSelection } from "@/lib/reader-selection";
import { useConceptPreference, setConceptPreference } from "@/hooks/use-concept-preference";
import { DEFAULT_CONTEXT_SETTINGS, normalizeContextInputTokens } from "@/lib/context-compaction";
import { useReaderPages } from "@/hooks/use-reader-pages";
import { useTextEnhancement } from "@/hooks/use-text-enhancement";
import { useTextSourceHighlights } from "@/hooks/use-text-source-highlights";
import "@/components/reader-workspace.css";
import { AnnotatedParagraph } from "@/components/annotated-paragraph";
import { useReadingAnnotations } from "@/hooks/use-reading-annotations";
import { anchorParts } from "@/lib/reading-anchors";
import { createAnnotation, sourceSelectionHighlights } from "@/lib/annotations";
import { countReadingCharacters, readingSelectionError } from "@/lib/reading-detail";
import { SelectionActions } from "@/components/selection-actions";
import { SpeechPlaybackBar } from "@/components/speech-controls";
import { DEFAULT_READING_APPEARANCE, applyReadingAppearanceToRoot, getReadingAppearanceVariables, getReadingTextStyle, readReadingAppearance, writeReadingAppearance, type ReadingAppearancePreferences } from "@/lib/reading-appearance";

type RestoredMessage = { id: string; role: "user" | "assistant"; content: string; structuredOutput?: string | null; status?: "streaming" | "completed" | "error" };

import {useImageChapters} from "@/hooks/use-image-chapters";
const EpubReader = dynamic(() => import("@/components/original-reader").then(module => module.OriginalReader), { ssr: false });
const emptyBook: Book = { id: "unselected", title: "尚未选择书籍", author: "", chapters: [] };

function flatten(book: Book): PaginatedParagraph[] {
  return book.chapters.flatMap((chapter) => chapter.paragraphs.map((paragraph) => ({ ...paragraph, chapterId: chapter.id, chapterTitle: chapter.title })));
}


export default function Home() {
  const layoutRef=useRef<HTMLElement>(null);
  const [chatWidth,setChatWidth]=useState(390);
  const model = useWorkspaceModel();
  const navigation=useNavCollapse();
  // WHY：宽度变化会重渲染本页；保持回调身份稳定，避免拖动 effect 被重建后中断。
  const getMaxChatWidth = useCallback((width: number) => maxChatWidth(width, navigation.collapsed), [navigation.collapsed]);
  const bookshelfAssistant = useBookshelfAssistant();
  const [book, setBook] = useState<Book>(emptyBook);
  const readerMode = useReaderMode(book);
  const imageChapters=useImageChapters(book);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("reader");
  const { books, setBooks, loading: libraryLoading, restoring: restoringBook, error: libraryError, refresh: refreshLibrary } = useWorkspaceLibrary((bookId, editionId, fromBookLink) => loadBook(bookId, editionId, !fromBookLink), () => setWorkspaceView("bookshelf"));
  const [importing, setImporting] = useState(false);
  const [mobileTocOpen, setMobileTocOpen] = useState(false);
  const [mobileAnalysisOpen, setMobileAnalysisOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [externalPreferences, setExternalPreferences] = useState<ExternalPermissions>(defaultExternalPreferences);
  const [bookContextPrefetch, setBookContextPrefetch] = useState(false);
  useEffect(() => {
    let active = true;
    // WHY：按书籍版本记住明确授权；异步同步浏览器偏好，避免切书时意外沿用上一本的请求权限。
    void Promise.resolve().then(() => { if (active) setBookContextPrefetch(Boolean(book.editionId && localStorage.getItem("judu:book-context-prefetch:" + book.editionId) === "1")); });
    return () => { active = false; };
  }, [book.editionId]);
  function changeBookContextPrefetch(enabled: boolean) {
    if (!book.editionId) return;
    try { localStorage.setItem("judu:book-context-prefetch:" + book.editionId, enabled ? "1" : "0"); setBookContextPrefetch(enabled); }
    catch (cause: unknown) { console.error("保存本书关联检索设置失败", cause); setNotice("本书关联检索设置未能保存，请检查浏览器存储。"); }
  }
  const [externalAvailability, setExternalAvailability] = useState<ExternalPermissions>(emptyExternalPermissions);
  const [externalReady, setExternalReady] = useState(false);
  function changeExternalPreferences(value: ExternalPermissions) {
    setExternalPreferences(value);
    try { writeExternalPreferences(localStorage, value); }
    catch (cause: unknown) { console.error("保存外部资料偏好失败", cause); setNotice("外部资料选择已应用，但无法保存到浏览器，下次刷新可能恢复默认。"); }
  }
  const pendingSourceMessageRef = useRef<string|null>(null);
  const selectionExtensionRef = useRef<{base:ReadingSelection;pending:boolean} | null>(null);
  const selectedDocumentRef = useRef<Document | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<ReadingSelection | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<{ left: number; top: number } | null>(null);
  const [knowledgeRevision, setKnowledgeRevision] = useState(0);
  const [activeSource, setActiveSource] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [bookLoading, setBookLoading] = useState(false);
  const [readingAppearance, setReadingAppearance] = useState<ReadingAppearancePreferences>(DEFAULT_READING_APPEARANCE);
  const [appearanceReady, setAppearanceReady] = useState(false);
  function saveReadingAppearance(value: ReadingAppearancePreferences) {
    setReadingAppearance(value);
    try { writeReadingAppearance(localStorage, value); window.dispatchEvent(new Event("judu:settings-updated")); }
    catch (cause: unknown) { console.error("阅读选项保存失败", cause); setNotice("阅读选项已应用，但保存失败，请检查浏览器存储。"); }
  }
  const theme = readingAppearance.theme;
  const [threadId, setThreadId] = useState("");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState("");
  const [listRevision, setListRevision] = useState(0);
  const [usage, setUsage] = useState<TokenUsage>();
  const conversationClient = useMemo(() => createConversationClient(fetch), []);
  const conversationPendingRef = useRef(false);
  const requestAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestAbortRef.current?.abort(); bookLoadSequence.current += 1; }, []);
  const [notice, setNotice] = useState("");
  const { preferences: readingPreferences, changePreferences: changeReadingPreferences } = useReadingPreferences(book.id, setNotice);
  const showConcepts = useConceptPreference();
  const [bookConcepts, setBookConcepts] = useState<{name:string;text:string}[]>([]);
  const [error, setError] = useState("");
  const readingMode=useReadingStyle(setNotice);
  const [annotationRevision,setAnnotationRevision]=useState(0);
  const readingRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const importAutoIndex = useRef(false);
  const [importOpen,setImportOpen]=useState(false),[indexTask,setIndexTask]=useState<{editionId:string;title:string}|null>(null);
  const activeRequestRef = useRef(false);
  const lastRequestRef = useRef<ReadingRequestState | null>(null);
  const [conversationRevision, setConversationRevision] = useState(0);
  const bookLoadSequence = useRef(0);
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
  const sourceParagraphs = useMemo(() => flatten(book), [book]);
  const semanticSearch=useBookSemanticSearch(book.editionId,setNotice);
  const readingTextStyle = useMemo(() => getReadingTextStyle(readingAppearance), [readingAppearance]);
  const { pages, pageIndex: safePageIndex, currentPage, setPageIndex, setAnchor: setReadingAnchor, anchor: readingAnchor, busy: paginating, error: paginationError, renderedScale } = useReaderPages(sourceParagraphs, readingRef, 1, readingTextStyle as Readonly<Record<string, string | number>>);
  // WHY：服务端书架列表是可见性的唯一来源，不能把已下架的当前书作为空列表兜底复活。
  const shelfBooks = books;
  const { visibleConcepts, renderedAnnotations, saveAnnotation, openAnnotation, saveManualMark, resetAnnotations } = useReadingAnnotations({
    revision:annotationRevision, bookId: book.id, editionId: book.editionId, sourceParagraphs, bookConcepts, selectionAnchor, setNotice,
    setWorkspaceView, setSelected, setSelectionAnchor, setReadingAnchor, setActiveSource, setSelectionMenu, openConversation, openSourceConversation:(id,messageId)=>openConversation(id,messageId,true),
  });
  const readerAnnotations = useMemo(()=>activeSource && selectionAnchor ? [...renderedAnnotations,...sourceSelectionHighlights(selectionAnchors(selectionAnchor))] : renderedAnnotations,[activeSource,selectionAnchor,renderedAnnotations]);
  const historyMarkerIds = useMemo(() => analysisHistoryMarkerIds(renderedAnnotations, sourceParagraphs.map(paragraph => paragraph.id)), [renderedAnnotations, sourceParagraphs]);
  const conceptHighlights = useMemo(() => pageConceptHighlights((currentPage?.paragraphs ?? []).map(paragraph => ({ paragraphId: paragraph.id, text: paragraph.text, sourceText: sourceParagraphs.find(p => p.id === paragraph.id)?.text, sourceStartOffset: paragraph.sourceStartOffset ?? 0, sourceEndOffset: paragraph.sourceEndOffset, annotations: renderedAnnotations, bookConcepts: visibleConcepts, showConcepts }))), [currentPage, sourceParagraphs, renderedAnnotations, visibleConcepts, showConcepts]);
  useTextSourceHighlights(readingRef,selectionAnchor,!readerMode.original && workspaceView==="reader",currentPage);
  const sourceEmphasis=useSourceEmphasis({bookId:book.id,editionId:book.editionId,chapterId:currentPage?.chapterId,model:model.selectedModel,readingStyle:readingMode.style,revision:annotationRevision,onError:setNotice});
  useTextEnhancement(readingRef,sourceParagraphs,readingAppearance,!readerMode.original && workspaceView==="reader",currentPage,sourceEmphasis.marks);
  useWorkspaceSelection(readingRef, retainSelection, workspaceView === "reader" && !readerMode.original && !bookLoading && !restoringBook && !paginating,()=>setNotice("最多选择 3000 字符，选区已限制到上限。"), clearSelection, startSelection);

  useEffect(() => {
    const restoreAppearance = (): void => {
      try { setReadingAppearance(readReadingAppearance(localStorage).preferences); } catch (cause: unknown) { console.error("\u8bfb\u53d6\u9605\u8bfb\u5916\u89c2\u5931\u8d25", cause); } finally { setAppearanceReady(true); }
    };
    restoreAppearance();
    const onSettings = (): void => restoreAppearance();
    window.addEventListener("storage", onSettings);
    window.addEventListener("judu:settings-updated", onSettings);
    return () => { window.removeEventListener("storage", onSettings); window.removeEventListener("judu:settings-updated", onSettings); };
  }, []);

  // WHY：门户弹层与 body 不在 app-shell 内；等偏好读取完成后同步根主题，避免只给局部面板换色。
  useEffect(() => { if (appearanceReady) applyReadingAppearanceToRoot(document.documentElement, readingAppearance); }, [appearanceReady, readingAppearance]);

  useShelfHistoryRecorder({bookId:book.id,editionId:book.editionId,active:!bookLoading&&!restoringBook&&workspaceView==="reader",anchor:readingAnchor,location:sourceParagraphs.find(item=>item.id===readingAnchor?.paragraphId)?.chapterTitle || "",onError:setNotice});

  useEffect(() => {
    const controller = new AbortController();
    // WHY：异步确认持久偏好和服务端可用性，在两者就绪前不提交外部检索授权。
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      try { setExternalPreferences(readExternalPreferences(localStorage)); }
      catch (cause: unknown) { console.error("读取外部资料偏好失败", cause); setExternalPreferences(emptyExternalPermissions()); setNotice("外部资料偏好已损坏，已暂停外部检索；请在 + 菜单中重新选择。"); }
      return fetch("/api/external-sources", { signal: controller.signal, cache: "no-store" });
    })
      .then(async response => { if (!response || !response.ok) throw new Error("来源状态请求失败"); const body: unknown = await response.json(); if (!body || typeof body !== "object" || !("available" in body)) throw new Error("来源状态格式错误"); return readExternalPermissions(body.available); })
      .then(value => { if (!controller.signal.aborted) setExternalAvailability(value); })
      .catch(cause => { if (!controller.signal.aborted) { console.error("读取外部来源状态失败", cause); setNotice("外部来源状态暂不可用，本轮不会向外部发起检索。请刷新重试。"); } })
      .finally(() => { if (!controller.signal.aborted) setExternalReady(true); });
    return () => controller.abort();
  }, []);


  useEffect(() => {
    if (!restoringBook) localStorage.setItem("judu:workspace-view", workspaceView);
  }, [workspaceView, restoringBook]);
  useEffect(() => {
    const controller = new AbortController();
    if (book.editionId) void fetchBookKnowledge(book.editionId, controller.signal)
      .then(data => { if(!controller.signal.aborted) setBookConcepts(data.concepts.flatMap(c=>c.definitions.length ? c.definitions.map(d=>({name:c.name,text:d.text})) : [{name:c.name,text:""}])); })
      .catch((cause:unknown)=>{ if(controller.signal.aborted)return; console.error("读取本书概念失败",cause); setNotice("本书概念读取失败，请刷新知识卡片。"); });
    return ()=>controller.abort();
  }, [book.editionId, knowledgeRevision]);
  useEffect(() => {
    if (!book.editionId) return;
    const controller = new AbortController();
    void conversationClient.list(book.editionId, controller.signal).then(items => { if (!controller.signal.aborted) setConversations(items); })
      .catch((cause: unknown) => { if (controller.signal.aborted) return; console.error("读取会话列表失败", cause); setConversationError("会话列表读取失败，请刷新后重试。"); });
    return () => controller.abort();
  }, [book.editionId, listRevision, conversationClient]);

  useEffect(() => {
    if (!threadId || !book.editionId || activeRequestRef.current) return;
    const controller = new AbortController();
    conversationPendingRef.current = true;
    void conversationClient.load(threadId, book.editionId, controller.signal).then(data => {
      if (controller.signal.aborted || activeRequestRef.current) return;
      const saved: RestoredMessage[] = data.messages.map(message => ({ ...message, status: message.status === "streaming" || message.status === "error" ? message.status : "completed" }));
      const restored = hydrateChatHistory(saved);
      // WHY：段落标注可能仅部分保存；完整消息来源是权威，恢复后覆盖临时的局部标注来源。
      const sourceMessage=pendingSourceMessageRef.current; pendingSourceMessageRef.current=null;
      const sourceRecord=sourceMessage ? restored.find(message=>message.id===sourceMessage) ?? restored.flatMap(message=>message.semantic?.units.map(unit=>({id:unit.id,anchor:unit.anchor,sourceInvalid:false}))??[]).find(unit=>unit.id===sourceMessage) : undefined, source=sourceRecord?.anchor;
      if(sourceRecord?.sourceInvalid){setSelected("");setSelectionAnchor(null);setSelectionMenu(null);selectionExtensionRef.current=null;setNotice("消息的完整来源已损坏，未保留局部选文。");}
      if(source){const selection=selectionFromParts(anchorParts(source).map(({selectedText,...part})=>({...part,text:selectedText})));if(selectionMatchesParagraphs(selection,sourceParagraphs)){setSelected(selection.text);setSelectionAnchor(selection);selectionExtensionRef.current=null;setActiveSource(source.paragraphId);setReadingAnchor({paragraphId:source.paragraphId,offset:source.startOffset});}else{setSelected("");setSelectionAnchor(null);setSelectionMenu(null);selectionExtensionRef.current=null;setNotice("消息的完整来源无法在当前版本验证，未保留局部选文。");}}
      setMessages(restored); setAnalysis(restored.at(-1)?.analysis ?? null); setUsage(restored.at(-1)?.usage);
      const last = saved.find(message=>message.id===restored.at(-1)?.id); const retry = last ? restoreReadingRequest(threadId, { ...last, status: last.status ?? "completed" }, restored) : null;
      lastRequestRef.current = retry; setError(retry?.error ?? "");
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      console.error("读取对话失败", cause); setConversationError(cause instanceof Error ? cause.message : "读取对话失败，请重试。");
      setMessages([]); setAnalysis(null); lastRequestRef.current = null;
    }).finally(() => { if (!controller.signal.aborted) { conversationPendingRef.current = false; setConversationLoading(false); } });
    return () => { controller.abort(); conversationPendingRef.current = false; };
  }, [threadId, book.editionId, conversationRevision, conversationClient, sourceParagraphs, setReadingAnchor]);

  useEffect(() => {
    if (!focusedMessageId || conversationLoading) return;
    const frame = requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>('.reader-layout > .analysis-panel');
      const node = panel?.querySelector<HTMLElement>('[data-message-id="' + CSS.escape(focusedMessageId) + '"]');
      const scroller = node?.closest<HTMLElement>(".chat-messages");
      if (node && scroller) {
        scroller.querySelectorAll('[data-history-target]').forEach(item => item.removeAttribute('data-history-target'));
        node.dataset.historyTarget = "true"; node.tabIndex = -1;
        scroller.scrollTop = Math.max(0, scroller.scrollTop + node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16);
        // WHY：通知聊天滚动控制器进入历史阅读状态，不只修改 dataset 而让自动跟随继续抢位置。
        scroller.dispatchEvent(new Event("scroll")); node.focus({ preventScroll: true });
      } else setNotice("这条知识记录的消息未在当前会话中找到，请检查来源。");
      setFocusedMessageId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedMessageId, messages, conversationLoading]);
  function startSelection(): void { const extension=selectionExtensionRef.current; selectionExtensionRef.current=extension?.pending ? {...extension,pending:false} : null; setSelected(""); setSelectionAnchor(null); setSelectionMenu(null); }
  function clearSelection(): void { setSelected(""); setSelectionAnchor(null); selectionExtensionRef.current=null; setSelectionMenu(null); }
  function selectText(): void { retainSelection(readReadingSelection(window.getSelection(), readingRef.current!,()=>setNotice("最多选择 3000 字，选区已限制到上限。"))); }
  function retainSelection(selection: ReadingSelection | null): void {
    if (!selection) return;
    if (!readerMode.original) selectedDocumentRef.current = document;
    if (!selectionMatchesParagraphs(selection,sourceParagraphs) || countReadingCharacters(selection.text)>3000) { clearSelection(); setNotice("选区位置无效或超过 3000 字，请重新选择原文。"); return; }
    let effective = selection;
    const extension=selectionExtensionRef.current, previous=extension?.base; if(extension)extension.pending=false;
    if(previous) {
      const merged=mergeContinuousSelections(previous,selection,sourceParagraphs);
      if(!merged){clearSelection();setNotice("继续选取须与原选区连续，合计最多 3000 字；此次未提交，请重新选择。");return;}
      effective=merged;
    }
    const candidateRange = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
    const range = candidateRange && typeof candidateRange.getBoundingClientRect === "function" ? candidateRange.getBoundingClientRect() : null;
    setSelected(effective.text); setSelectionAnchor(effective); if (!readerMode.original) setReadingAnchor({ paragraphId: effective.paragraphId, offset: effective.startOffset }); setActiveSource(effective.paragraphId);
    const box = range ?? readingRef.current?.getBoundingClientRect();
    if (box) setSelectionMenu({ left: box.left + box.width / 2, top: Math.max(58, box.top - 8) });
  }

  function setReaderScale(change: number): void {
    setReadingAppearance((value) => {
      const next = Math.min(32, Math.max(14, Number((value.fontSize + change * 16).toFixed(0))));
      const updated = { ...value, fontSize: next };
      try { writeReadingAppearance(localStorage, updated); window.dispatchEvent(new Event("judu:settings-updated")); } catch (cause: unknown) { console.error("\u4fdd\u5b58\u5b57\u53f7\u5931\u8d25", cause); setNotice("\u5b57\u53f7\u4fdd\u5b58\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5"); }
      return updated;
    });
  }
  async function loadBook(bookId: string, editionId?: string, restoreView = false, importedBook?: unknown, target?: {anchor?: KnowledgeMaterial["anchor"]; conversation?: NonNullable<KnowledgeMaterial["conversation"]>}): Promise<void> {
    if (activeRequestRef.current || conversationPendingRef.current || importing) { setNotice("请等待当前回答或会话操作完成后再切换书籍。"); return; }
    const loadSequence = ++bookLoadSequence.current;
    const targetEdition = editionId ?? rememberedEdition(books.find(item => item.id === bookId), localStorage.getItem("judu:edition:" + bookId));
    if (bookId === book.id && (!targetEdition || targetEdition === book.editionId)) { setBookLoading(false); setWorkspaceView("reader"); return; }
    setBookLoading(true);
    try {
      // WHY：导入响应已在提交事务后携带完整正文；复用同一校验与装配路径，避免再次下载整本书。
      let payload = importedBook;
      if (payload === undefined) {
        const response = await fetch(bookEditionUrl(bookId, targetEdition));
        if (!response.ok) throw new Error("读取书籍失败");
        payload = await response.json();
      }
      const loaded = readBookResponse(payload, bookId, targetEdition);
      if (loadSequence !== bookLoadSequence.current) return;
      const savedAnchor = restoreWorkspaceReadingAnchor(localStorage.getItem("judu:position:" + loaded.id + ":" + loaded.editionId), flatten(loaded));
      const targetAnchor=target?.anchor;
      const targetSelection=targetAnchor&&targetAnchor.editionId===loaded.editionId?selectionFromParts(anchorParts(targetAnchor).map(({selectedText,...part})=>({...part,text:selectedText}))):null;
      const verifiedSelection=targetSelection&&selectionMatchesParagraphs(targetSelection,flatten(loaded))?targetSelection:null;
      if(targetAnchor&&!verifiedSelection)setNotice("来源无法在这本书的当前版本核对，未保留选文。");
      setReadingAnchor(verifiedSelection?{paragraphId:verifiedSelection.paragraphId,offset:verifiedSelection.startOffset}:savedAnchor); lastRequestRef.current = null; setError("");
      setMobileTocOpen(false); setMobileAnalysisOpen(false);
      setBooks(previous => previous.some(item => item.id === loaded.id) ? previous.map(item => item.id === loaded.id ? { ...item, ...loaded, editions: loaded.editions ?? item.editions } : item) : [...previous, loaded]);
      setBook(loaded); setConversations([]); setConversationError(""); setUsage(undefined); resetAnnotations(); setBookConcepts([]); setSelectionAnchor(verifiedSelection); selectionExtensionRef.current=null; setWorkspaceView("reader"); setActiveSource(verifiedSelection?.paragraphId??""); setSelected(verifiedSelection?.text??""); setMessages([]); setAnalysis(null);
      // WHY：多版本书籍不能使用未绑定版本的旧缓存会话；历史仍可通过该版本的会话列表选择。
      const cachedThread = localStorage.getItem(`judu:thread:${loaded.id}:${loaded.editionId}`) ?? ((loaded.editions?.length ?? 1) <= 1 ? localStorage.getItem(`judu:thread:${loaded.id}`) : null) ?? "";
      const savedThread = target?.conversation&&isConversationId(target.conversation.threadId)?target.conversation.threadId:isConversationId(cachedThread)?cachedThread:"";
      if (cachedThread && !savedThread) setNotice("旧会话定位无效，请从会话列表重新选择；历史记录未删除。");
      setConversationLoading(Boolean(savedThread));
      setThreadId(savedThread); setConversationRevision(value=>value+1);
      if(target?.conversation){setFocusedMessageId(target.conversation.messageId);setMobileAnalysisOpen(true);}
      localStorage.setItem("judu:active-book", loaded.id);
      if (loaded.editionId) { localStorage.setItem("judu:edition:" + loaded.id, loaded.editionId); window.dispatchEvent(new Event(BOOK_RESUME_CHANGED)); }
      if (restoreView) {
        const savedView = localStorage.getItem("judu:workspace-view");
        if (savedView === "bookshelf" || savedView === "knowledge" || savedView === "guide") setWorkspaceView(savedView);
      }
    } catch (loadError: unknown) {
      console.error("读取书籍失败", loadError);
      setNotice(loadError instanceof Error ? loadError.message : "读取书籍失败");
    } finally { if(loadSequence===bookLoadSequence.current) setBookLoading(false); }
  }

  async function importBook(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const sizeError=importFileSizeError(file.size);if(sizeError){setNotice(sizeError);input.value="";return;}
    if (importing) { setNotice("上一本书仍在导入，请稍后再选择文件。"); input.value = ""; return; }
    setImporting(true); setNotice("正在解析书籍…");
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/api/import", { method: "POST", headers: { "X-Judu-Import-Response": "compact" }, body: form });
      const contentType = response.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json")
        ? await response.json() as Book & { error?: string }
        : undefined;
      if (!response.ok) throw new Error(data?.error ?? (response.status===413?IMPORT_TOO_LARGE:"导入失败（HTTP " + response.status + "）"));
      if (!data || !Array.isArray(data.chapters)) throw new Error("导入结果无效，请重试");
      const imported = readBookResponse(data, data.id, data.editionId);
      setBooks((previous) => [imported, ...previous.filter((item) => item.id !== imported.id)]);
      // WHY：导入只写书库；生成期间不自动切书或清理正在使用的请求、会话和选文。
      if (!activeRequestRef.current && !conversationPendingRef.current) {
        await loadBook(imported.id, imported.editionId, false, imported);
        setNotice("书籍已导入，关键词检索已可用");
      } else setNotice("书籍已导入书架；当前回答继续生成，未切换阅读书籍。");
      // WHY：本地正文已随导入入库；云端向量索引仅在本次选择明确授权后异步启动，不阻塞阅读。
      if(importAutoIndex.current){setIndexTask({editionId:imported.editionId!,title:imported.title});}
    } catch (importError: unknown) {
      console.error("导入书籍失败", importError);
      setNotice(importError instanceof Error ? importError.message : "导入失败");
    } finally { input.value = ""; setImporting(false); }
  }

  async function runRequest(request: ReadingRequestState): Promise<void> {
    if (activeRequestRef.current || conversationPendingRef.current) return;
    const started = beginReadingRequest(request, messages);
    lastRequestRef.current = started.state; activeRequestRef.current = true;
    const controller = new AbortController(); requestAbortRef.current = controller; setUsage(undefined);
    setMessages(started.messages); setLoading(true); setError(""); setMobileAnalysisOpen(true);
    setThreadId(request.payload.threadId); localStorage.setItem("judu:thread:" + book.id + ":" + book.editionId, request.payload.threadId);
    let completedSemanticUnits = request.semantic?.units.filter(unit=>unit.status==="completed").length ?? 0;
    try {
      const finished = await executeReadingRequest(started.state, { signal: controller.signal, onEvent: event => {
        if (lastRequestRef.current?.payload.clientAssistantMessageId !== started.state.payload.clientAssistantMessageId) return;
        if (event.type === "usage") setUsage(event.usage);
        if(event.type==="semantic") {const n=event.result.units.filter(u=>u.status==="completed").length;if(n!==completedSemanticUnits){completedSemanticUnits=n;setAnnotationRevision(value=>value+1);}}
        if (event.type === "warning") setNotice(event.message);
      }, onState: (state) => {
        if(lastRequestRef.current?.payload.clientAssistantMessageId !== state.payload.clientAssistantMessageId)return;
        lastRequestRef.current = state; setMessages(previous => applyReadingRequest(previous, state));
      } });
      if (finished.status !== "completed") { setError(finished.error ?? "生成失败，请重试"); return; }
      const result = finished.analysis; if (!result) return;
      setAnalysis(result);
      const input = finished.payload;
      const parts=input.selectionAnchors ?? (input.paragraphId && input.selectionStart!==undefined && input.selectionEnd!==undefined ? [{paragraphId:input.paragraphId,startOffset:input.selectionStart,endOffset:input.selectionEnd,selectedText:input.selectedText}] : []);
      if(input.mode==="analyze")for(const part of parts){
        const paragraph=sourceParagraphs.find(p=>p.id===part.paragraphId);if(!paragraph)throw new Error("句读来源段落已不存在");
        const annotation=createAnnotation({paragraphId:part.paragraphId,startOffset:part.startOffset,endOffset:part.endOffset,threadId:input.threadId,messageId:input.clientAssistantMessageId,summary:result.summary.trim()||result.readingText?.trim()||"已完成句读",concepts:result.concepts.map(c=>c.name),conceptDetails:result.concepts,createdAt:new Date().toISOString()},paragraph.text);
        await saveAnnotation(annotation);
      }
      setKnowledgeRevision(value => value + 1);
    } catch (cause: unknown) { console.error("句读保存失败", cause); setNotice("回答已显示，但保存失败，请刷新知识卡片检查。"); }
    finally { activeRequestRef.current = false; requestAbortRef.current = null; setLoading(false); setListRevision(value => value + 1); if(lastRequestRef.current?.semantic){setAnnotationRevision(value=>value+1);setKnowledgeRevision(value=>value+1);} }
  }

  async function ask(question = "请句读这一段", requestedMode: "chat" | "analyze" = "analyze", options: {selection?:ReadingSelection;style?:ReadingStyle;sectionId?:string;forceRead?:boolean} = {}): Promise<void> {
    const target=options.selection??selectionAnchor,targetText=target?.text??selected,style=options.style??readingMode.style;
    if (!question.trim() || loading || bookLoading || importing || conversationPendingRef.current || !currentPage) return;
    if (!externalReady) { setNotice("正在确认外部资料状态，请稍后发送。"); return; }
    if (requestedMode === "analyze" && !target) { setNotice("请重新选中要句读的原文。"); return; }
    if (requestedMode === "analyze") { const selectionError = style === 'semantic' ? (!targetText.trim() ? '请先选择原文。' : null) : readingSelectionError(targetText); if (selectionError) { setNotice(selectionError); return; } }
    const paragraph = sourceParagraphs.find(p=>p.id===target?.paragraphId) ?? currentPage.paragraphs[0];
    const strategy = localStorage.getItem("judu:compressionStrategy");
    let preferences;
    try { preferences = readReadingPreferences(localStorage, book.id); }
    catch (cause: unknown) { console.error("读取本书解读设置失败", cause); setNotice("请在加号菜单重新保存本书解读设置后发送。"); return; }
    const savedOutput = Number(localStorage.getItem("judu:maxOutputTokens") ?? 4096);
    const maxOutputTokens = Number.isSafeInteger(savedOutput) && savedOutput >= 1024 && savedOutput <= 16384 ? savedOutput : 4096;
    const request = createReadingRequest({ readingStyle:requestedMode==='analyze'?style:undefined,sectionId:options.sectionId,forceRead:options.forceRead, model:model.selectedModel, externalPermissions: permittedExternalSources(externalPreferences, externalAvailability), bookContextPrefetch: requestedMode === "analyze" && Boolean(book.editionId && localStorage.getItem("judu:book-context-prefetch:" + book.editionId) === "1"), mode:requestedMode, question, selectedText:targetText, threadId, bookId:book.id, editionId:book.editionId ?? "demo", bookTitle:book.title, chapterTitle:paragraph.chapterTitle, chapterId:paragraph.chapterId, paragraphId:paragraph.id, selectionStart:target?.startOffset, selectionEnd:target?.endOffset, selectionAnchors:target ? selectionAnchors(target) : undefined, context:target ? selectionParts(target).map(part=>sourceParagraphs.find(p=>p.id===part.paragraphId)?.text??"").join("\n\n") : paragraph.text, chatHistory:messages.filter(m=>m.status!=="error"), bookSearch:semanticSearch.results.slice(0,8), detail: preferences.detail, difficulty: preferences.difficulty, contextSettings:{maxInputTokens:normalizeContextInputTokens(localStorage.getItem("judu:maxInputTokens")),maxOutputTokens,compressionStrategy:strategy==="aggressive"||strategy==="conservative"?strategy:"balanced"} });
    if (requestedMode === "analyze") {
      // WHY：请求已快照原文，释放原生蓝色选区和旧操作栏，才能从同一段文字重新拖选朗读。
      selectedDocumentRef.current?.getSelection()?.removeAllRanges();
      window.getSelection()?.removeAllRanges();
      clearSelection();
    }
    await runRequest(request);
  }

  function openSectionHistory(chapterId:string):undefined|(()=>void) {
    const chapter=book.chapters.find(c=>c.id===chapterId);if(!chapter)return;
    const ids=chapter.paragraphs.map(p=>p.id);
    const message=[...messages].reverse().find(m=>m.semantic&&m.anchor&&anchorParts(m.anchor).length===ids.length&&anchorParts(m.anchor).every((p,i)=>p.paragraphId===ids[i]&&p.startOffset===0&&p.endOffset===chapter.paragraphs[i].text.length));
    if(message)return()=>{setMobileAnalysisOpen(true);setFocusedMessageId(message.id??null);};
  }

  async function editMessage(userMessageId: string, newPrompt: string): Promise<void> {
    const request = lastRequestRef.current;
    if (!request) { setNotice("\u5f53\u524d\u6d88\u606f\u6ca1\u6709\u53ef\u56de\u6eaf\u7684\u8bf7\u6c42\u5feb\u7167"); return; }
    try {
      const plan = prepareReadingEdit(request, messages, userMessageId, newPrompt);
      const next = createReadingRequest({ ...plan.input, threadId: request.payload.threadId });
      await runRequest(next);
    } catch (cause: unknown) {
      console.error("\u7f16\u8f91\u539f\u59cb\u95ee\u9898\u5931\u8d25", cause);
      setNotice(cause instanceof Error ? cause.message : "\u65e0\u6cd5\u7f16\u8f91\u8fd9\u6761\u6d88\u606f\uff0c\u8bf7\u91cd\u8bd5");
    }
  }

  async function retryRequest(): Promise<void> {
    const request = lastRequestRef.current;
    if (!request || (request.status !== "error" && request.status !== "cancelled")) return;
    try {
      const retry = withRetryContextSettings(request, { maxInputTokens: Number(localStorage.getItem("judu:maxInputTokens") ?? DEFAULT_CONTEXT_SETTINGS.maxInputTokens), maxOutputTokens: Number(localStorage.getItem("judu:maxOutputTokens") ?? 4096) });
      await runRequest(retry);
    } catch (cause: unknown) {
      console.error("重试预算无效", cause); setError(cause instanceof Error ? cause.message : "无法应用重试预算，请检查设置。");
    }
  }

  function openConversation(id: string, messageId: string | null, restoreSource=false): void {
    // WHY：任何来源的非法ID都必须在清历史、置加载锁之前拒绝，避免空ID导致effect永远不执行。
    if (!isConversationId(id) || !isConversationId(book.editionId)) { setNotice("会话定位无效，请刷新列表后重新选择；历史记录未删除。"); return; }
    if (activeRequestRef.current || conversationPendingRef.current || bookLoading || importing) { setNotice("请等待当前回答或会话操作完成后再切换对话。"); return; }
    pendingSourceMessageRef.current=restoreSource ? messageId : null;
    // WHY：切换身份时先清理旧历史与重试身份，再加载严格绑定本版的新历史，防止串线。
    setMessages([]); setAnalysis(null); setUsage(undefined); setError(""); setConversationError(""); lastRequestRef.current = null;
    setConversationRevision(value => value + 1); setConversationLoading(true); conversationPendingRef.current = true;
    setMobileAnalysisOpen(true); setFocusedMessageId(messageId); setThreadId(id);
    localStorage.setItem("judu:thread:" + book.id + ":" + book.editionId, id);
  }
  async function newConversation(): Promise<void> {
    if (activeRequestRef.current || conversationPendingRef.current || bookLoading || importing) return;
    if (!book.editionId) { setNotice("请先从书架打开一本已导入的书。"); return; }
    conversationPendingRef.current = true; setConversationLoading(true); setConversationError("");
    let loadingCreatedHistory = false;
    try {
      const created = await conversationClient.create({ editionId: book.editionId });
      setConversations(previous => [created, ...previous.filter(item => item.id !== created.id)]);
      setMessages([]); setAnalysis(null); setUsage(undefined); setSelected(""); setSelectionAnchor(null); selectionExtensionRef.current=null; setError(""); lastRequestRef.current = null;
      loadingCreatedHistory = true;
      setThreadId(created.id); setConversationRevision(value => value + 1); setFocusedMessageId(null);
      localStorage.setItem("judu:thread:" + book.id + ":" + book.editionId, created.id);
    } catch (cause: unknown) { console.error("新建会话失败", cause); setConversationError(cause instanceof Error ? cause.message : "新建会话失败"); throw cause; }
    finally { if (!loadingCreatedHistory) { conversationPendingRef.current = false; setConversationLoading(false); } }
  }
  async function renameConversation(id: string, title: string): Promise<void> {
    if (conversationPendingRef.current || bookLoading || !book.editionId) return;
    const renamed = await conversationClient.rename(id, book.editionId, title);
    setConversations(previous => previous.map(item => item.id === renamed.id ? renamed : item));
  }

  function jumpToSemanticResult(result: import("@/components/book-search-panel").SearchResult): void {
    setWorkspaceView("reader");setMobileAnalysisOpen(false);
    const paragraph=sourceParagraphs.find(item=>item.id===result.paragraphId);
    const selection=selectionFromSearchResult(result,paragraph);
    setSelected(selection?.text??"");setSelectionAnchor(selection);setActiveSource(paragraph?.id??"");
    if(paragraph)setReadingAnchor({paragraphId:paragraph.id,offset:selection?.startOffset??0});
    if(!selection)setNotice("搜索摘录无法精确核对，请在正文重新选择需要句读的文字。");
  }
  function openGuideSource(source: GuideSource, conversation: boolean): void {
    if (source.bookId !== book.id) { setNotice("导读来源不属于当前书籍，请重新打开导读。"); return; }
    if (source.editionId === book.editionId) {
      if (conversation) { setWorkspaceView("reader"); openConversation(source.threadId, source.messageId); }
      else openKnowledgeSource(source.anchor);
    } else void loadBook(source.bookId, source.editionId, false, undefined, conversation ? { conversation: { threadId: source.threadId, messageId: source.messageId } } : { anchor: { ...source.anchor, editionId: source.editionId, chapterId: source.chapterId } });
  }
  function openKnowledgeMaterial(item: KnowledgeMaterial): void {
    if(item.anchor&&item.anchor.editionId!==item.source.editionId){clearSelection();setNotice("来源版本不一致，无法跳转原文。");return;}
    if(item.source.editionId===book.editionId){if(item.anchor)openKnowledgeSource(item.anchor);else {clearSelection();navigateWorkspace("reader");}return;}
    // WHY：跨书来源先切换并复核目标版本的完整选区，不能沿用当前书的段落 ID 或选文。
    void loadBook(item.source.bookId,item.source.editionId,false,undefined,{anchor:item.anchor});
  }
  function openKnowledgeConversation(item: KnowledgeMaterial): void {
    if(!item.conversation)return;
    if(!isConversationId(item.conversation.threadId)){setNotice("会话定位无效，请刷新知识库后重试。");return;}
    if(item.source.editionId===book.editionId){openConversation(item.conversation.threadId,item.conversation.messageId);return;}
    void loadBook(item.source.bookId,item.source.editionId,false,undefined,{conversation:item.conversation});
  }
  function openKnowledgeSource(anchor: MessageAnchor): void {
    const selection=selectionFromParts(anchorParts(anchor).map(({selectedText,...part})=>({...part,text:selectedText})));
    if(!selectionMatchesParagraphs(selection,sourceParagraphs)){clearSelection();setNotice("这条消息的原文位置无法在当前版本验证，请重新选择原文。");return;}
    setWorkspaceView("reader"); setMobileAnalysisOpen(false); selectionExtensionRef.current=null;
    setReadingAnchor({paragraphId:anchor.paragraphId,offset:anchor.startOffset}); setActiveSource(anchor.paragraphId);
    setSelected(selection.text); setSelectionAnchor(selection);
  }

  function openCitation(paragraphId: string, quote: string, messageId?: string): void {
    const paragraph = sourceParagraphs.find(p=>p.id===paragraphId);
    const startOffset = paragraph?.text.indexOf(quote) ?? -1;
    if (startOffset < 0) { setNotice("引用位置无法在当前版本复核，请查看知识卡片来源。"); return; }
    openKnowledgeSource({paragraphId,startOffset,endOffset:startOffset+quote.length,selectedText:quote});
    if (messageId) setFocusedMessageId(messageId);
  }
  function navigateWorkspace(view: WorkspaceView): void { setWorkspaceView(view); setMobileTocOpen(false); setMobileAnalysisOpen(false); }
  function requestImport(): void { navigateWorkspace("bookshelf"); setImportOpen(true); }
  function switchReaderMode(mode: "original" | "text"): void { readerMode.selectMode(mode); setSelectionMenu(null); window.getSelection()?.removeAllRanges(); }
  function openChapter(chapterId: string): void {
    if(imageChapters.open(chapterId)){setWorkspaceView("reader");return;}
    setWorkspaceView("reader");
    const paragraph = book.chapters.find(chapter => chapter.id === chapterId)?.paragraphs[0];
    if (readerMode.original && paragraph) { setReadingAnchor({paragraphId: paragraph.id, offset: 0}); return; }
    const target = pages.findIndex(page => page.paragraphs.some(paragraph => paragraph.chapterId === chapterId));
    if (target >= 0) setPageIndex(target);
  }
  const assistantMobileOpen=workspaceView==="bookshelf" ? bookshelfAssistant.open : mobileAnalysisOpen;
  const toggleMobileAssistant=()=>workspaceView==="guide" ? (setWorkspaceView("reader"),setMobileAnalysisOpen(true)) : workspaceView==="bookshelf" ? bookshelfAssistant.toggle() : setMobileAnalysisOpen(value=>!value);
  return <main className={`app-shell workspace-shell theme-${theme}`} style={getReadingAppearanceVariables(readingAppearance) as CSSProperties}>
    <header className="workspace-mobilebar"><button type="button" aria-label="打开导航" aria-expanded={mobileTocOpen} onClick={() => setMobileTocOpen(value => !value)}>☰</button><strong>句读</strong><button type="button" aria-label={assistantMobileOpen ? "收起对话" : "打开对话"} aria-expanded={assistantMobileOpen} onClick={toggleMobileAssistant}>对话</button></header>
    {notice && <div className="upload-toast" role="status"><span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice("")}>×</button></div>}
    {importOpen&&<ImportBookDialog onClose={()=>setImportOpen(false)} onChoose={autoIndex=>{importAutoIndex.current=autoIndex;setImportOpen(false);importRef.current?.click();}}/>}
    {indexTask&&<ImportIndexTask key={indexTask.editionId} {...indexTask} onClose={()=>setIndexTask(null)} onReady={()=>setKnowledgeRevision(value=>value+1)} onError={setNotice}/>}
    <input ref={importRef} id="book-file" hidden type="file" accept=".mobi,.epub,.pdf,.fb2,.fbz,.fb2.zip,.cbz,.txt,.md" onChange={event => { void importBook(event); }} />
    {navigation.error && <p role="status">{navigation.error}</p>}
    <section data-guide-active={workspaceView === "guide"} data-bookshelf-assistant-hidden={workspaceView === "guide" || (workspaceView === "bookshelf" && !bookshelfAssistant.open)} data-nav-collapsed={navigation.collapsed} className="reader-layout" ref={layoutRef} style={{"--chat-panel-width":`${chatWidth}px`} as CSSProperties}>
      <WorkspaceNav collapsed={navigation.collapsed} onToggleCollapse={navigation.toggle} view={workspaceView} onNavigate={navigateWorkspace} books={shelfBooks} currentBookId={book.id} currentEditionId={book.editionId} chapters={book.chapters} currentChapterId={imageChapters.chapter?.id??currentPage?.chapterId}
        busy={loading || conversationLoading || importing} importDisabled={bookLoading || restoringBook || conversationLoading} importing={importing} onOpenBook={(id, editionId) => void loadBook(id, editionId)} onOpenChapter={openChapter} onImport={requestImport} mobileOpen={mobileTocOpen} onDismiss={() => setMobileTocOpen(false)}>

      </WorkspaceNav>
      <div className="workspace-main" data-workspace-view={workspaceView}>
      <article data-original-active={readerMode.original} className="reading-pane" data-workspace-hidden={workspaceView !== "reader"} aria-hidden={workspaceView !== "reader"} inert={workspaceView !== "reader"} aria-busy={bookLoading || restoringBook || paginating}>
        <div className="reading-toolbar"><button type="button" className="guide-reading-entry" disabled={!book.editionId} onClick={() => navigateWorkspace("guide")}>导读</button><ReaderModeSwitch book={book} original={readerMode.original} onChange={switchReaderMode} disabled={bookLoading || importing} /><span className="chapter-context">{imageChapters.chapter?.title??currentPage?.chapterTitle ?? "当前章节"}</span><button className="analysis-toggle" disabled={imageChapters.imageOnly} aria-pressed={readingAppearance.showAnalysisHints} onClick={() => saveReadingAppearance({ ...readingAppearance, showAnalysisHints: !readingAppearance.showAnalysisHints })}>句读线 {readingAppearance.showAnalysisHints ? "开" : "关"}</button><button className="concept-toggle" disabled={imageChapters.imageOnly} aria-pressed={showConcepts} onClick={() => setConceptPreference(!showConcepts)}>概念 {showConcepts ? "开" : "关"}</button><SectionReadingAction readingStyle={readingMode.style} onOpenExisting={currentPage?openSectionHistory(currentPage.chapterId):undefined} chapter={book.edition?.fileType===".pdf"||imageChapters.imageOnly?undefined:book.chapters.find(c=>c.id===currentPage?.chapterId)} disabled={loading||bookLoading||conversationLoading} onStart={(selection,sectionId)=>void ask(readingMode.style==="whole"?"请按段落句读本节，直白内容可略过并说明原因":"请按句意细读本节，直白内容可略过并说明原因","analyze",{selection,sectionId,style:readingMode.style})}/><ReaderOptions value={readingAppearance} onChange={saveReadingAppearance}/><ReadingOptions key={book.id} enhancementStatus={sourceEmphasis.status} enhancementBusy={sourceEmphasis.busy} canEnhance={!!currentPage&&!loading&&!sourceEmphasis.busy&&!imageChapters.imageOnly&&book.edition?.fileType!==".pdf"} onGenerateEmphasis={()=>void sourceEmphasis.generate()} style={readingMode.style} onStyleChange={readingMode.change} preferences={readingPreferences} onPreferencesChange={changeReadingPreferences} appearance={readingAppearance} onAppearanceChange={saveReadingAppearance} disabled={bookLoading||importing}/></div>
        <div className="reading-surface" data-original={readerMode.original}>
        <div className="reading-content" aria-hidden={readerMode.original || undefined} ref={readingRef} onMouseUp={selectText}>
          <div className="reader-sheet" data-measuring={paginating} style={{ ...readingTextStyle, "--reading-scale": renderedScale } as CSSProperties}>
            {currentPage?.isChapterStart && <div className="page-heading"><small>{currentPage.chapterTitle}</small><h1>{currentPage.chapterTitle}</h1><SectionReadingAction readingStyle={readingMode.style} onOpenExisting={currentPage?openSectionHistory(currentPage.chapterId):undefined} chapter={book.edition?.fileType===".pdf"?undefined:book.chapters.find(c=>c.id===currentPage.chapterId)} disabled={loading||bookLoading||conversationLoading} onStart={(selection,sectionId)=>void ask(readingMode.style==="whole"?"请按段落句读本节，直白内容可略过并说明原因":"请按句意细读本节，直白内容可略过并说明原因","analyze",{selection,sectionId,style:readingMode.style})}/></div>}
            {currentPage?.paragraphs.map((paragraph) => <AnnotatedParagraph key={paragraph.id + ":" + (paragraph.sourceStartOffset ?? 0) + ":" + workspaceView} paragraphId={paragraph.id} text={paragraph.text} sourceText={sourceParagraphs.find(p=>p.id===paragraph.id)?.text} bookConcepts={visibleConcepts} highlightedConceptStarts={conceptHighlights.get(paragraph.id)} historyMarkerIds={historyMarkerIds} sourceStartOffset={paragraph.sourceStartOffset ?? 0} sourceEndOffset={paragraph.sourceEndOffset} active={activeSource === paragraph.id} annotations={renderedAnnotations} showConcepts={showConcepts} showAnalysisHints={readingAppearance.showAnalysisHints} analysisHintOpacity={readingAppearance.analysisHintOpacity} onOpenAnnotation={openAnnotation} />)}
          </div>
          {(paginating || paginationError) && <div className="reader-paginating" role="status">{paginationError || "正在按阅读区域重新排版…"}</div>}
        </div>
        {readerMode.original && <EpubReader sourceEmphasis={sourceEmphasis.marks} readingStyle={readingMode.style} sectionReadingDisabled={loading||importing} onOpenSection={openSectionHistory} onStartSection={(selection,sectionId)=>void ask(readingMode.style==="whole"?"请按段落句读本节，直白内容可略过并说明原因":"请按句意细读本节，直白内容可略过并说明原因","analyze",{selection,sectionId,style:readingMode.style})} key={book.editionId} imageChapterRequest={imageChapters.request} onImagePage={imageChapters.onPage} book={book} anchor={readingAnchor} appearance={readingAppearance} annotations={readerAnnotations} concepts={showConcepts ? visibleConcepts : []} showAnalysisHints={readingAppearance.showAnalysisHints} analysisHintOpacity={readingAppearance.analysisHintOpacity} disabled={bookLoading || restoringBook || conversationLoading} selectionDisabled={bookLoading || restoringBook || conversationLoading} navigationDisabled={bookLoading || restoringBook || conversationLoading} onSelect={(selection, box) => { retainSelection(selection); setSelectionMenu(box); }} onSelectionDocument={doc => { selectedDocumentRef.current = doc; }} onStartSelection={startSelection} onClearSelection={clearSelection} onOpenAnnotation={openAnnotation} onPosition={setReadingAnchor} onNotice={setNotice} onFallback={() => switchReaderMode("text")} />}
          {selectionMenu && selectionAnchor && <SelectionActions readingStyle={readingMode.style} selectedText={selected} paragraphCount={selectionParts(selectionAnchor).length} onExtend={()=>{selectionExtensionRef.current={base:selectionAnchor,pending:true};
            // WHY：下一页拖选前释放浏览器原生选区，避免从已选文字启动 HTML 拖放；快照仍保留用于连续合并。
            selectedDocumentRef.current?.getSelection()?.removeAllRanges();
            window.getSelection()?.removeAllRanges();setSelectionMenu(null);setNotice("请翻到相邻页继续选择连续正文，合计最多 3000 字符。");}} left={selectionMenu.left} top={selectionMenu.top} disabled={bookLoading || restoringBook || conversationLoading || (!readerMode.original && paginating)} speechDisabled={bookLoading || restoringBook || conversationLoading || (!readerMode.original && paginating)} analyzeDisabled={loading || importing || Boolean(readingMode.style==="whole"?readingSelectionError(selected):!selected.trim())} reason={loading ? "正在生成，可继续选文、标注和朗读；下一轮句读需等待完成。" : readingMode.style==="whole"?readingSelectionError(selected) ?? undefined:undefined} onClose={() => setSelectionMenu(null)} onAnalyze={() => { setSelectionMenu(null); void ask(); }} onHighlight={color => void saveManualMark("highlight", "", color)} onFavorite={() => void saveManualMark("favorite")} onNote={(note) => void saveManualMark("note", note)} />}
        </div>
        <div className="selection-bar"><div className="reading-settings" aria-label="阅读设置"><span>Aa</span><button aria-label="缩小字号" onClick={() => setReaderScale(-0.05)}>−</button><button aria-label="放大字号" onClick={() => setReaderScale(0.05)}>+</button></div><div className="selection-actions">{selected ? <span>已选 {countReadingCharacters(selected)} / 3000 字符</span> : <span>{imageChapters.imageOnly?"图片页无文字来源，OCR尚未启用":"选择一句或一段原文开始句读"}</span>}</div></div>
        <div className="page-nav" style={readerMode.original ? {display:"none"} : undefined}><button disabled={paginating || safePageIndex === 0} onClick={() => setPageIndex(safePageIndex - 1)}>上一页</button><span>{pages.length ? safePageIndex + 1 : 0} / {pages.length}</span><button disabled={paginating || safePageIndex >= pages.length - 1} onClick={() => setPageIndex(safePageIndex + 1)}>下一页</button></div>
      </article>
      <SpeechPlaybackBar/>
        {workspaceView === "bookshelf" && <Bookshelf assistantOpen={bookshelfAssistant.open} onToggleAssistant={bookshelfAssistant.toggle} preferenceError={bookshelfAssistant.error} books={books} currentBookId={book.id} currentEditionId={book.editionId} loading={libraryLoading} importing={importing} busy={conversationLoading || restoringBook} navigationDisabled={loading} error={libraryError} onBookArchived={id=>{setBooks(items=>items.filter(item=>item.id!==id));setNotice("书籍已下架，文件和阅读记录已保留，可在已下架书籍中恢复。");}} onOpenBook={(id, editionId) => void loadBook(id, editionId)} onImport={requestImport} onRefresh={refreshLibrary} />}
        {workspaceView === "guide" && <GuideWorkspace key={book.id} bookId={book.editionId ? book.id : null} bookTitle={book.title} onReturnReading={() => navigateWorkspace("reader")} onOpenSource={openGuideSource} />}
        {workspaceView === "knowledge" && <KnowledgeWorkspace editionId={book.editionId ?? null} bookTitle={book.title + (book.edition ? " · " + book.edition.fileName : "")} refreshToken={knowledgeRevision} onRefreshRequested={()=>setKnowledgeRevision(value=>value+1)} onReturnReading={() => navigateWorkspace("reader")} onOpenSource={openKnowledgeSource} onOpenMaterial={openKnowledgeMaterial} onOpenConversation={openConversation} onOpenConversationMaterial={openKnowledgeConversation} advancedSearch={{...semanticSearch,editionId:book.editionId,onResult:jumpToSemanticResult}} />}
      </div>
      <ChatPanelResizer containerRef={layoutRef} getMaxWidth={getMaxChatWidth} onWidthChange={setChatWidth} className="workspace-chat-resizer" controlsId="chat-panel"/>
      <AnalysisPanel onReadUnit={anchor=>void ask("请解释这段原文，不要略过","analyze",{selection:selectionFromParts(anchorParts(anchor).map(({selectedText,...p})=>({...p,text:selectedText}))),style:readingMode.style,forceRead:true})} readingPreferences={readingPreferences} onReadingPreferencesChange={book.editionId ? changeReadingPreferences : undefined} id="chat-panel" className={assistantMobileOpen ? "analysis-panel mobile-open" : "analysis-panel"} selected={selected} analysis={analysis} loading={loading} error={error} messages={messages}
        conversations={conversations} activeThreadId={threadId || null} editionId={book.editionId} conversationsLoading={conversationLoading || bookLoading || restoringBook} conversationError={conversationError} usage={usage} modelName={model.error ? "模型信息暂不可用" : model.selectedModel} modelOptions={model.modelOptions} selectedModel={model.selectedModel} onModelChange={model.selectModel} externalPermissions={externalPreferences} onExternalPermissionsChange={changeExternalPreferences} bookContextPrefetch={bookContextPrefetch} onBookContextPrefetchChange={book.editionId ? changeBookContextPrefetch : undefined}
        onNewConversation={book.editionId ? newConversation : undefined} onRenameConversation={renameConversation}
        onSelectConversation={id => { if (activeRequestRef.current || conversationPendingRef.current) return; if (!conversations.some(item => item.id === id && item.editionId === book.editionId)) throw new Error("这条会话不属于当前书籍版本"); setSelected(""); setSelectionAnchor(null); selectionExtensionRef.current=null; openConversation(id, null); }}
        onClose={()=>{if(workspaceView==="bookshelf"&&bookshelfAssistant.open)bookshelfAssistant.toggle();else setMobileAnalysisOpen(false);}} onBack={() => navigateWorkspace("reader")} onSend={question => void ask(question, "chat")} onEditMessage={(id, prompt) => void editMessage(id, prompt)} onRetry={() => void retryRequest()} onStop={() => requestAbortRef.current?.abort()} onOpenSource={openKnowledgeSource} onOpenCitation={openCitation} />
    </section>
  </main>;
}
