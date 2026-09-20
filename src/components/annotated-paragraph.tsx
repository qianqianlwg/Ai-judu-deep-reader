"use client";

import React, { Fragment, useId, useRef, useState } from "react";
import { segmentAnnotatedText, type AnnotationConcept, type ConceptDetail, type TextAnnotation } from "@/lib/annotations";
import { AnnotationPopover } from "./annotation-popover";
import { ConceptPopoverContent, HistoryPopoverContent } from "./reading-popover-content";
import "./annotation-popover.css";

type Props = {
  paragraphId: string;
  /** 必须是未经 trim / 改写的原段落 UTF-16 片段。 */
  text: string;
  sourceStartOffset?: number;
  sourceEndOffset?: number;
  sourceText?: string;
  bookConcepts?: readonly ConceptDetail[];
  annotations: TextAnnotation[];
  showConcepts: boolean;
  active?: boolean;
  onOpenAnnotation: (annotation: TextAnnotation) => void;
};
type ActivePopover = { anchor: HTMLElement; pinned: boolean; key: string; sliceKey: string } & (
  { kind: "history"; annotations: TextAnnotation[] } | { kind: "concept"; concept: AnnotationConcept }
);

export function AnnotatedParagraph({ paragraphId, text, sourceStartOffset = 0, sourceEndOffset = sourceStartOffset + text.length, sourceText, bookConcepts, annotations, showConcepts, active: activeSource = false, onOpenAnnotation }: Props) {
  const segments = segmentAnnotatedText({ paragraphId, text, sourceStartOffset, sourceEndOffset, sourceText, bookConcepts, annotations, showConcepts });
  const [active, setActive] = useState<ActivePopover | null>(null);
  const ignoreFocus = useRef<HTMLElement | null>(null);
  const id = useId();
  const sliceKey = paragraphId + ":" + sourceStartOffset + ":" + sourceEndOffset + ":" + text;
  // WHY：同一个 React 段落实例可能切换为另一分页片段，旧浮层不能继续展示上页的解释。
  let visible: ActivePopover | null = null;
  if (active?.sliceKey === sliceKey && active.anchor.isConnected) {
    const current = segments.find((segment) => active.key === (active.kind === "concept" ? "concept-" + segment.startOffset : "history-" + segment.endOffset));
    // WHY：字典/历史刷新后从当前片段取内容，不能让打开的浮层继续保存旧定义快照。
    if (active.kind === "concept" && showConcepts && current?.concept?.name === active.concept.name) visible = { ...active, concept: current.concept };
    if (active.kind === "history" && current?.endingAnnotations.length) visible = { ...active, annotations: current.endingAnnotations };
  }

  function open(next: ActivePopover, isFocus = false) {
    if (isFocus && ignoreFocus.current === next.anchor) { ignoreFocus.current = null; return; }
    setActive((previous) => previous?.key === next.key && previous.anchor === next.anchor ? { ...next, pinned: previous.pinned || next.pinned } : next);
  }
  function close(restoreFocus: boolean) {
    if (restoreFocus && active?.anchor.isConnected && active.anchor.ownerDocument.activeElement !== active.anchor) {
      ignoreFocus.current = active.anchor;
      active.anchor.focus({ preventScroll: true });
    }
    setActive(null);
  }

  return <p className="judu-annotated-paragraph" data-active-source={activeSource} data-paragraph-id={paragraphId} data-source-start={sourceStartOffset} data-source-end={sourceEndOffset}>
    {segments.map((segment) => {
      const concept = segment.concept;
      const termKey = "concept-" + segment.startOffset;
      const historyKey = "history-" + segment.endOffset;
      const termOpen = (anchor: HTMLElement, pinned: boolean, isFocus = false) => {
        if (concept) open({ kind: "concept", concept, anchor, pinned, key: termKey, sliceKey }, isFocus);
      };
      const historyOpen = (anchor: HTMLElement, pinned: boolean, isFocus = false) => open({ kind: "history", annotations: segment.endingAnnotations, anchor, pinned, key: historyKey, sliceKey }, isFocus);
      return <Fragment key={segment.startOffset}>
        <span data-reader-text="" data-source-start={segment.startOffset} data-source-end={segment.endOffset}
          style={segment.annotations.some(annotation => annotation.kind === "highlight") ? ({ "--mark-color": segment.annotations.find(annotation => annotation.kind === "highlight")?.markColor ?? "yellow" } as React.CSSProperties) : undefined}
          className={[segment.annotations.some(annotation => annotation.kind !== "highlight") ? "judu-annotation-text" : "", segment.annotations.some(annotation => annotation.kind === "highlight") ? "judu-highlight-text" : ""].filter(Boolean).join(" ") || undefined}>
          {concept ? <span className="judu-concept-term" role="button" tabIndex={0} data-concept-word={concept.name}
            aria-label={"查看概念：" + concept.name} aria-haspopup="dialog" aria-expanded={visible?.key === termKey}
            aria-controls={visible?.key === termKey ? id : undefined}
            onMouseEnter={(event) => { if(event.buttons===0) termOpen(event.currentTarget, false); }}
            onFocus={(event) => termOpen(event.currentTarget, false, true)}
            onClick={(event) => { event.stopPropagation(); termOpen(event.currentTarget, true); }}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); termOpen(event.currentTarget, true); } }}>
            {segment.text}
          </span> : segment.text}
        </span>
        {segment.endingAnnotations.length > 0 && <span className="judu-history-anchor" data-reader-decoration="" contentEditable={false}>
          {/* WHY：零宽锚点和绝对定位 SVG 不增加字数、行宽或行高，分页测量只包含原文。 */}
          <button type="button" className="judu-history-marker" data-reader-decoration="" data-annotation-end={segment.endOffset}
            aria-label={"查看句读历史（" + segment.endingAnnotations.length + "条）"} aria-haspopup="dialog"
            aria-expanded={visible?.key === historyKey} aria-controls={visible?.key === historyKey ? id : undefined}
            onMouseEnter={(event) => { if(event.buttons===0) historyOpen(event.currentTarget, false); }}
            onFocus={(event) => historyOpen(event.currentTarget, false, true)}
            onClick={(event) => { event.stopPropagation(); historyOpen(event.currentTarget, true); }}
            onMouseUp={(event) => event.stopPropagation()}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false"><path d="M4 3.5h12v9H9l-4 3v-3H4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M7 7h6M7 9.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          </button>
        </span>}
      </Fragment>;
    })}
    {visible && <AnnotationPopover key={visible.key} id={id} anchor={visible.anchor} title={visible.kind === "concept" ? visible.concept.name : "句读历史"} pinned={visible.pinned} onClose={close}>
      {visible.kind === "concept" ? <ConceptPopoverContent concept={visible.concept}/> : <HistoryPopoverContent annotations={visible.annotations} onOpen={annotation=>{onOpenAnnotation(annotation);close(false);}}/>}
    </AnnotationPopover>}
  </p>;
}
