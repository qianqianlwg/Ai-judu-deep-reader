"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { PaginatedParagraph, ReadingAnchor } from "@/lib/pagination";
import { dedupeAnnotations, type TextAnnotation } from "@/lib/annotations";
import { hashText } from "@/lib/hash";
import type { ReadingMark } from "@/lib/reading-marks";
import { selectionAnchors, selectionFromParts, selectionMatchesParagraphs, type ReadingSelection } from "@/lib/reader-selection";
import type { WorkspaceView } from "@/components/workspace-nav";

type ConceptDetail = { name: string; text: string };
type SelectionMarkColor = "yellow" | "green" | "blue" | "pink" | "orange";
export type ReadingAnnotationsOptions = {
  bookId: string; editionId?: string; sourceParagraphs: readonly PaginatedParagraph[]; bookConcepts: readonly ConceptDetail[]; selectionAnchor: ReadingSelection | null;
  setNotice: Dispatch<SetStateAction<string>>; setWorkspaceView: (view: WorkspaceView) => void; setSelected: (value: string) => void;
  setSelectionAnchor: (value: ReadingSelection | null) => void; setReadingAnchor: (value: ReadingAnchor) => void; setActiveSource: (value: string) => void;
  setSelectionMenu: (value: { left: number; top: number } | null) => void; openSourceConversation?: (threadId:string,messageId:string|null)=>void; openConversation: (threadId: string, messageId: string | null) => void;
};
export type ReadingAnnotationsResult = {
  annotations: TextAnnotation[]; readingMarks: ReadingMark[]; visibleConcepts: ConceptDetail[]; renderedAnnotations: TextAnnotation[];
  saveAnnotation: (annotation: TextAnnotation) => Promise<void>; openAnnotation: (annotation: TextAnnotation) => void;
  saveManualMark: (kind: ReadingMark["kind"], note?: string, color?: SelectionMarkColor) => Promise<void>;
  resetAnnotations: () => void;
};

export function useReadingAnnotations(options: ReadingAnnotationsOptions): ReadingAnnotationsResult {
  const { bookId, editionId, sourceParagraphs, bookConcepts, selectionAnchor, setNotice, setWorkspaceView, setSelected, setSelectionAnchor, setReadingAnchor, setActiveSource, setSelectionMenu, openConversation, openSourceConversation } = options;
  const [annotations, setAnnotations] = useState<TextAnnotation[]>([]); const [readingMarks, setReadingMarks] = useState<ReadingMark[]>([]);
  const annotationStorageKey = "judu:annotations:" + bookId + ":" + (editionId ?? "demo");

  useEffect(() => {
    let disposed = false;
    const fallback = (): void => { try { const parsed: unknown = JSON.parse(localStorage.getItem(annotationStorageKey) ?? "[]"); if (!disposed && Array.isArray(parsed)) setAnnotations(dedupeAnnotations(parsed as TextAnnotation[])); }
      catch (cause: unknown) { console.error("加载标注失败", cause); if (!disposed) setAnnotations([]); } };
    void fetch("/api/annotations?editionId=" + encodeURIComponent(editionId ?? "demo"))
      .then(async (response) => { if (!response.ok) throw new Error("加载标注请求失败"); return response.json() as Promise<{ annotations?: TextAnnotation[] }>; })
      .then((data) => { if (!disposed) setAnnotations(dedupeAnnotations(data.annotations ?? [])); })
      .catch((cause: unknown) => { console.error("加载标注请求失败", cause); fallback(); });
    return () => { disposed = true; };
  }, [annotationStorageKey, editionId]);

  useEffect(() => {
    if (!editionId) return;
    let disposed = false;
    void fetch("/api/reading-marks?editionId=" + encodeURIComponent(editionId), { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error("读取阅读标注失败（HTTP " + response.status + "）"); const body: unknown = await response.json(); if (!body || typeof body !== "object" || !("marks" in body) || !Array.isArray(body.marks)) throw new Error("阅读标注响应格式错误"); return body.marks as ReadingMark[]; })
      .then((marks) => { if (!disposed) setReadingMarks(marks); })
      .catch((cause: unknown) => { console.error("读取阅读标注失败", cause); if (!disposed) { setReadingMarks([]); setNotice("阅读标注读取失败，请稍后重试"); } });
    return () => { disposed = true; };
  }, [editionId, setNotice]);

  const visibleConcepts = useMemo(() => [...bookConcepts, ...annotations.flatMap(annotation => annotation.conceptDetails ?? [])], [bookConcepts, annotations]);
  const markAnnotations = useMemo<TextAnnotation[]>(() => readingMarks.flatMap(mark => mark.kind === "highlight" ? mark.anchors.map(anchor => ({
    id: "mark-" + mark.id + "-" + anchor.paragraphId + "-" + anchor.startOffset, paragraphId: anchor.paragraphId, startOffset: anchor.startOffset, endOffset: anchor.endOffset,
    textHash: anchor.textHash, threadId: "manual-mark", summary: "", concepts: [], kind: "highlight" as const, markColor: mark.color, createdAt: mark.createdAt,
  })) : []), [readingMarks]);
  const renderedAnnotations = useMemo(() => [...annotations, ...markAnnotations], [annotations, markAnnotations]);

  const saveAnnotation = useCallback(async (annotation: TextAnnotation): Promise<void> => {
    setAnnotations(previous => { const next = dedupeAnnotations([...previous, annotation]);
      // WHY：localStorage 仅作离线回退；服务端保存仍是权威来源，写入失败必须让调用方看到异常。
      localStorage.setItem(annotationStorageKey, JSON.stringify(next)); return next; });
    const paragraphText = sourceParagraphs.find(item => item.id === annotation.paragraphId)?.text; if (!paragraphText) return;
    const response = await fetch("/api/annotations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(annotation) });
    if (!response.ok) throw new Error("句读标注保存失败（" + response.status + "）");
  }, [annotationStorageKey, sourceParagraphs]);

  const openAnnotation = useCallback((annotation: TextAnnotation): void => {
    // WHY：同一消息的各段标注共同构成来源，点击第二段也应恢复整个连续选区而不是只恢复这一个片段。
    const linked=annotation.messageId ? annotations.filter(item=>item.messageId===annotation.messageId && item.threadId===annotation.threadId) : [];
    const group=linked.some(item=>item.id===annotation.id) ? linked : [...linked,annotation];
    group.sort((a,b)=>sourceParagraphs.findIndex(p=>p.id===a.paragraphId)-sourceParagraphs.findIndex(p=>p.id===b.paragraphId)||a.startOffset-b.startOffset);
    const selection=selectionFromParts(group.map(item=>({paragraphId:item.paragraphId,startOffset:item.startOffset,endOffset:item.endOffset,text:sourceParagraphs.find(p=>p.id===item.paragraphId)?.text.slice(item.startOffset,item.endOffset)??""})));
    if(!selectionMatchesParagraphs(selection,sourceParagraphs)){setSelected("");setSelectionAnchor(null);setSelectionMenu(null);setNotice("段落标注不完整，正在从对应会话核验完整来源；未保留局部选文。");if(annotation.messageId)(openSourceConversation??openConversation)(annotation.threadId,annotation.messageId);return;}
    setWorkspaceView("reader"); setSelected(selection.text); setSelectionAnchor(selection);
    setReadingAnchor({paragraphId:selection.paragraphId,offset:selection.startOffset});setActiveSource(selection.paragraphId);(openSourceConversation??openConversation)(annotation.threadId,annotation.messageId??null);
  }, [annotations, openConversation, openSourceConversation, setActiveSource, setNotice, setReadingAnchor, setSelected, setSelectionAnchor, setSelectionMenu, setWorkspaceView, sourceParagraphs]);

  const resetAnnotations = useCallback((): void => { setAnnotations([]); setReadingMarks([]); }, []);

  const saveManualMark = useCallback(async (kind: ReadingMark["kind"], note = "", color: SelectionMarkColor = "yellow"): Promise<void> => {
    if (!selectionAnchor || !editionId) return;
    try {
      const response = await fetch("/api/reading-marks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editionId, kind, color, note, anchors: selectionAnchors(selectionAnchor).map(anchor=>({...anchor,textHash:hashText(anchor.selectedText)})) }) });
      if (!response.ok) { let message = "保存标注失败"; try { const body: unknown = await response.json(); if (body && typeof body === "object" && "error" in body && typeof body.error === "string") message = body.error; } catch (cause: unknown) { console.warn("保存标注失败响应无法解析", { name: cause instanceof Error ? cause.name : "UnknownError" }); } throw new Error(message); }
      const saved = await response.json() as { mark?: ReadingMark }; if (saved.mark) setReadingMarks(previous => [saved.mark!, ...previous.filter(item => item.id !== saved.mark!.id)]);
      setNotice(kind === "highlight" ? "已标亮选文" : kind === "favorite" ? "已收藏选文" : "笔记已保存"); setSelectionMenu(null);
    } catch (cause: unknown) { console.error("保存阅读标注失败", cause); setNotice(cause instanceof Error ? cause.message : "保存标注失败，请重试"); }
  }, [editionId, selectionAnchor, setNotice, setSelectionMenu]);

  return { annotations, readingMarks, visibleConcepts, renderedAnnotations, saveAnnotation, openAnnotation, saveManualMark, resetAnnotations };
}
