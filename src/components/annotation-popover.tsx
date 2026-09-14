"use client";

import React, { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./annotation-popover.css";

type Bounds = { left: number; right: number; top: number; bottom: number };
type Size = { width: number; height: number };
export type PopoverGeometry = { anchor: Bounds; body: Bounds; reader: Bounds; viewport: Bounds; popover: Size };
const GAP = 12;
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

type Props = {
  id: string;
  anchor: HTMLElement;
  title: string;
  pinned?: boolean;
  onClose: (restoreFocus: boolean) => void;
  children: ReactNode;
};
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

export function AnnotationPopover({ id, anchor, title, pinned = false, onClose, children }: Props) {
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
    cancelClose();
    closeTimer.current = setTimeout(() => {
      const focused = anchor.ownerDocument.activeElement;
      if (!pinnedRef.current && !pointerInside.current && !anchor.contains(focused) && !cardRef.current?.contains(focused)) onCloseRef.current(false);
    }, 250);
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
      if (event.target instanceof Node && (anchor.contains(event.target) || card.contains(event.target))) { enter(); return; }
      pointerInside.current = false;
      // WHY：仅靠短延时会让鼠标在较宽留白中途失去卡片；真实几何通道允许慢速移入。
      if (isInPopoverBridge({ x: event.clientX, y: event.clientY }, anchor.getBoundingClientRect(), card.getBoundingClientRect())) cancelClose();
      else scheduleClose();
    };
    const blur = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && (anchor.contains(event.relatedTarget) || card?.contains(event.relatedTarget))) return;
      scheduleClose();
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.contains(event.target) && !card?.contains(event.target)) onCloseRef.current(false);
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
    return () => {
      cancelClose();
      anchor.removeEventListener("mouseenter", enter); anchor.removeEventListener("mouseleave", leave);
      anchor.removeEventListener("focusout", blur); anchor.removeEventListener("keydown", triggerKeys);
      doc.removeEventListener("mousemove", move); doc.removeEventListener("pointerdown", outside); doc.removeEventListener("keydown", keys, true);
    };
  // WHY：事件通过 ref 读取最新回调和固定状态，避免流式更新时反复拆装鼠标监听。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

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
        if (event.shiftKey && event.target === items[0]) { event.preventDefault(); anchor.focus(); }
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
