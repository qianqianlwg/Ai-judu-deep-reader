"use client";

import React, { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./annotation-popover.css";

type Bounds = { left: number; right: number; top: number; bottom: number };
type Size = { width: number; height: number };
export type PopoverGeometry = { anchor: Bounds; body: Bounds; reader: Bounds; viewport: Bounds; popover: Size };
const GAP = 12;
const CLOSE_DELAY_MS = 140;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

export function getPopoverBounds(viewport: Bounds, reader: Bounds): Bounds {
  const outer = { left: viewport.left + GAP, right: viewport.right - GAP, top: viewport.top + GAP, bottom: viewport.bottom - GAP };
  const intersect = { left: Math.max(outer.left, reader.left + GAP), right: Math.min(outer.right, reader.right - GAP), top: Math.max(outer.top, reader.top + GAP), bottom: Math.min(outer.bottom, reader.bottom - GAP) };
  // WHY：正文区域太窄时才退回整个可见窗口；正常情况下聊天栏不属于可用留白。
  return intersect.right - intersect.left >= 180 && intersect.bottom - intersect.top >= 80 ? intersect : outer;
}

export function positionAnnotationPopover({ anchor, body, reader, viewport, popover }: PopoverGeometry): { left: number; top: number; placement: string } {
  const bounds = getPopoverBounds(viewport, reader);
  const width = Math.min(popover.width, Math.max(0, bounds.right - bounds.left));
  const height = Math.min(popover.height, Math.max(0, bounds.bottom - bounds.top));
  const gutterRight = Math.min(reader.right - GAP, bounds.right);
  let left: number;
  let top = anchor.top;
  let placement: string;
  if (gutterRight - body.right - GAP >= width) {
    left = body.right + GAP; placement = "right-gutter";
  } else if (body.left - GAP - Math.max(reader.left + GAP, bounds.left) >= width) {
    left = body.left - GAP - width; placement = "left-gutter";
  } else {
    left = anchor.left;
    const below = anchor.bottom + GAP;
    top = below + height <= bounds.bottom ? below : anchor.top - GAP - height;
    placement = "bounded";
  }
  return { left: clamp(left, bounds.left, bounds.right - width), top: clamp(top, bounds.top, bounds.bottom - height), placement };
}

/** 鼠标穿过触发点与卡片间的三角通道时不关闭，慢速移动也能进入远处留白。 */
export function isInPopoverBridge(point: { x: number; y: number }, anchor: Bounds, card: Bounds): boolean {
  type Point = [number, number];
  let polygon: Point[];
  const pad = 8;
  if (card.left >= anchor.right) polygon = [[anchor.right - pad, anchor.top - pad], [card.left + pad, card.top - pad], [card.left + pad, card.bottom + pad], [anchor.right - pad, anchor.bottom + pad]];
  else if (card.right <= anchor.left) polygon = [[card.right - pad, card.top - pad], [anchor.left + pad, anchor.top - pad], [anchor.left + pad, anchor.bottom + pad], [card.right - pad, card.bottom + pad]];
  else if (card.top >= anchor.bottom) polygon = [[anchor.left - pad, anchor.bottom - pad], [anchor.right + pad, anchor.bottom - pad], [card.right + pad, card.top + pad], [card.left - pad, card.top + pad]];
  else if (card.bottom <= anchor.top) polygon = [[card.left - pad, card.bottom - pad], [card.right + pad, card.bottom - pad], [anchor.right + pad, anchor.top + pad], [anchor.left - pad, anchor.top + pad]];
  else return false;
  let inside = false;
  for (let i = 0, previous = polygon.length - 1; i < polygon.length; previous = i++) {
    const [x, y] = polygon[i]; const [px, py] = polygon[previous];
    if ((y > point.y) !== (py > point.y) && point.x < (px - x) * (point.y - y) / (py - y) + x) inside = !inside;
  }
  return inside;
}

export type PopoverSource = { document:Document; toHostPoint(x:number,y:number):{x:number;y:number}; containsPoint(x:number,y:number):boolean };
type Props = {
  source?:PopoverSource;
  returnFocus?:()=>void;
  id: string;
  anchor: HTMLElement;
  title: string;
  pinned?: boolean;
  onClose: (restoreFocus: boolean) => void;
  children: ReactNode;
};
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

export function AnnotationPopover({ id, anchor, title, pinned = false, onClose, children, source, returnFocus }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  const pinnedRef = useRef(pinned);
  const pointerInside = useRef(false);
  useLayoutEffect(() => { onCloseRef.current = onClose; pinnedRef.current = pinned; });

  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    // WHY：关闭计时器只允许启动一次，避免 document mousemove 持续续期导致浮层悬停数秒不消失。
    if (closeTimer.current !== null) return;
    closeTimer.current = setTimeout(() => {
      const focused = anchor.ownerDocument.activeElement;
      if (!pinnedRef.current && !pointerInside.current && !anchor.contains(focused) && !cardRef.current?.contains(focused)) onCloseRef.current(false);
    }, CLOSE_DELAY_MS);
  };

  useLayoutEffect(() => {
    const card = cardRef.current;
    const doc = anchor.ownerDocument;
    const win = doc.defaultView;
    if (!card || !win) return;
    const paragraph = anchor.closest<HTMLElement>("[data-paragraph-id]") ?? anchor;
    const reader = anchor.closest<HTMLElement>("[data-reading-pane], .reading-pane");
    const content = anchor.closest<HTMLElement>("[data-reading-viewport], .reading-content");
    const update = () => {
      const visual = win.visualViewport;
      const viewport = { left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0, right: (visual?.offsetLeft ?? 0) + (visual?.width ?? win.innerWidth), bottom: (visual?.offsetTop ?? 0) + (visual?.height ?? win.innerHeight) };
      const triggerRect = anchor.getBoundingClientRect();
      const readerRect = reader?.getBoundingClientRect() ?? viewport;
      const visible = content?.getBoundingClientRect() ?? readerRect;
      if (!anchor.isConnected || triggerRect.bottom < Math.max(viewport.top, visible.top) || triggerRect.top > Math.min(viewport.bottom, visible.bottom) || triggerRect.right < viewport.left || triggerRect.left > viewport.right) {
        onCloseRef.current(false); return;
      }
      const bounds = getPopoverBounds(viewport, readerRect);
      card.style.maxWidth = Math.max(0, bounds.right - bounds.left) + "px";
      card.style.maxHeight = Math.max(0, bounds.bottom - bounds.top) + "px";
      // WHY：先应用尺寸约束再测量实际卡片，不能用估算高度定位长定义或句读历史。
      const size = card.getBoundingClientRect();
      const position = positionAnnotationPopover({ anchor: triggerRect, body: paragraph.getBoundingClientRect(), reader: readerRect, viewport, popover: size });
      card.style.left = position.left + "px"; card.style.top = position.top + "px";
      card.style.visibility = "visible";
      card.dataset.placement = position.placement;
      const shell = anchor.closest(".app-shell");
      card.dataset.theme = shell?.classList.contains("theme-dark") ? "dark" : shell?.classList.contains("theme-paper") ? "paper" : "light";
    };
    const schedule = () => {
      if (frameRef.current !== null) win.cancelAnimationFrame(frameRef.current);
      frameRef.current = win.requestAnimationFrame(() => { frameRef.current = null; update(); });
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    for (const node of [anchor, paragraph, reader, content, card]) if (node) observer?.observe(node);
    win.addEventListener("resize", schedule);
    win.addEventListener("scroll", schedule, true);
    win.visualViewport?.addEventListener("resize", schedule);
    win.visualViewport?.addEventListener("scroll", schedule);
    doc.fonts?.addEventListener("loadingdone", schedule);
    return () => {
      observer?.disconnect();
      if (frameRef.current !== null) win.cancelAnimationFrame(frameRef.current);
      win.removeEventListener("resize", schedule); win.removeEventListener("scroll", schedule, true);
      win.visualViewport?.removeEventListener("resize", schedule); win.visualViewport?.removeEventListener("scroll", schedule);
      doc.fonts?.removeEventListener("loadingdone", schedule);
    };
  }, [anchor, children]);

  useEffect(() => {
    const doc = anchor.ownerDocument;
    const card = cardRef.current;
    const enter = () => { pointerInside.current = true; cancelClose(); };
    const leave = () => { pointerInside.current = false; scheduleClose(); };
    const move = (event: MouseEvent) => {
      if (!card || pinnedRef.current) return;
      if ((event.target instanceof Node && (anchor.contains(event.target) || card.contains(event.target))) || (source?.document===doc&&source.containsPoint(event.clientX,event.clientY))) { enter(); return; }
      pointerInside.current = false;
      // WHY：几何通道只用于短暂过渡，真正进入卡片后再取消关闭，避免留白移动无限续期。
      if (!isInPopoverBridge({ x: event.clientX, y: event.clientY }, anchor.getBoundingClientRect(), card.getBoundingClientRect())) scheduleClose();
    };
    const blur = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && (anchor.contains(event.relatedTarget) || card?.contains(event.relatedTarget))) return;
      scheduleClose();
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.contains(event.target) && !card?.contains(event.target) && !(source?.document===doc&&source.containsPoint(event.clientX,event.clientY))) onCloseRef.current(false);
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCloseRef.current(!!card?.contains(doc.activeElement)); }
    };
    const triggerKeys = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
        const target = card?.querySelector<HTMLElement>(FOCUSABLE);
        if (target) { event.preventDefault(); target.focus(); }
      }
    };
    anchor.addEventListener("mouseenter", enter); anchor.addEventListener("mouseleave", leave);
    anchor.addEventListener("focusout", blur); anchor.addEventListener("keydown", triggerKeys);
    doc.addEventListener("mousemove", move); doc.addEventListener("pointerdown", outside); doc.addEventListener("keydown", keys, true);
    const sourceMove=(event:MouseEvent)=>{
      if(!card||pinnedRef.current)return;
      if(source?.containsPoint(event.clientX,event.clientY)){enter();return;}
      const point=source?.toHostPoint(event.clientX,event.clientY);pointerInside.current=false;
      if(point&&!isInPopoverBridge(point,anchor.getBoundingClientRect(),card.getBoundingClientRect()))scheduleClose();
    };
    const sourceOutside=(event:PointerEvent)=>{if(!source?.containsPoint(event.clientX,event.clientY))onCloseRef.current(false);};
    // WHY：PDF文字与浮窗同属一个document，不能把卡片内部事件再当iframe外部点击处理。
    const foreignSource=source?.document!==doc?source?.document:undefined;
    foreignSource?.addEventListener("mousemove",sourceMove);
    foreignSource?.addEventListener("pointerdown",sourceOutside);
    foreignSource?.addEventListener("keydown",keys,true);
    return () => {
      foreignSource?.removeEventListener("mousemove",sourceMove);foreignSource?.removeEventListener("pointerdown",sourceOutside);foreignSource?.removeEventListener("keydown",keys,true);
      cancelClose();
      anchor.removeEventListener("mouseenter", enter); anchor.removeEventListener("mouseleave", leave);
      anchor.removeEventListener("focusout", blur); anchor.removeEventListener("keydown", triggerKeys);
      doc.removeEventListener("mousemove", move); doc.removeEventListener("pointerdown", outside); doc.removeEventListener("keydown", keys, true);
    };
  // WHY：事件通过 ref 读取最新回调和固定状态，避免流式更新时反复拆装鼠标监听。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, source]);

  if (!anchor.ownerDocument.body) return null;
  return createPortal(
    <div ref={cardRef} id={id} data-reader-decoration="" role="dialog" aria-modal="false" aria-labelledby={id + "-title"} className="judu-annotation-popover"
      onMouseEnter={() => { pointerInside.current = true; cancelClose(); }}
      onMouseLeave={() => { pointerInside.current = false; scheduleClose(); }}
      onFocus={cancelClose} onBlur={scheduleClose}
      // WHY：portal 事件仍沿 React 树冒泡；卡片内选择文字不能触发正文选段处理。
      onMouseUp={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "Tab") return;
        const items = Array.from(cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
        if (event.shiftKey && event.target === items[0]) { event.preventDefault(); if(returnFocus)returnFocus();else anchor.focus(); }
        if (!event.shiftKey && event.target === items[items.length - 1]) {
          const outside = Array.from(anchor.ownerDocument.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => !cardRef.current?.contains(item));
          const next = outside[outside.indexOf(anchor) + 1];
          if (next) { event.preventDefault(); next.focus(); }
          onCloseRef.current(false);
        }
      }}>
      <header className="judu-annotation-popover__header"><strong id={id + "-title"}>{title}</strong><button type="button" aria-label="关闭浮层" onClick={() => onCloseRef.current(true)}>×</button></header>
      <div className="judu-annotation-popover__body">{children}</div>
    </div>, anchor.ownerDocument.body,
  );
}
