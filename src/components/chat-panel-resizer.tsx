"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import styles from "./chat-panel-resizer.module.css";

const DEFAULT_WIDTH = 390;
const MIN_WIDTH = 300;
const NARROW_QUERY = "(max-width: 900px)";

export interface ChatPanelResizerProps {
  onWidthChange: (width: number) => void;
  /** 不传时查找最近的 .reader-layout，再回退到父元素。 */
  containerRef?: RefObject<HTMLElement | null>;
  /** 返回聊天面板最大宽度；仍不能超过容器宽度。 */
  getMaxWidth?: (containerWidth: number) => number;
  /** 默认给阅读区及导航合计保留 600px；getMaxWidth 优先。 */
  minRemainingWidth?: number;
  storageKey?: string;
  /** 被控制的聊天面板 DOM id，用于 aria-controls。 */
  controlsId?: string;
  className?: string;
}

type Bounds = { max: number; hidden: boolean };
type Drag = { pointerId: number; x: number; width: number };

export function ChatPanelResizer({
  onWidthChange,
  containerRef,
  getMaxWidth,
  minRemainingWidth = 600,
  storageKey = "reader-chat-panel-width",
  controlsId,
  className,
}: ChatPanelResizerProps) {
  const handleRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onWidthChange);
  const widthRef = useRef(DEFAULT_WIDTH);
  const actions = useRef<{
    begin: (event: React.PointerEvent<HTMLDivElement>) => void;
    change: (width: number) => void;
  } | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [bounds, setBounds] = useState<Bounds>({ max: DEFAULT_WIDTH, hidden: false });
  const [storageError, setStorageError] = useState(false);

  useEffect(() => { callbackRef.current = onWidthChange; }, [onWidthChange]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    const container = containerRef?.current ?? handle.closest<HTMLElement>(".reader-layout") ?? handle.parentElement;
    // WHY：部分嵌入环境与 jsdom 没有 matchMedia，仍用视口宽度响应 resize。
    const media = typeof window.matchMedia === "function" ? window.matchMedia(NARROW_QUERY) : null;
    let drag: Drag | null = null;
    let currentBounds: Bounds = { max: DEFAULT_WIDTH, hidden: false };
    let preferredWidth = DEFAULT_WIDTH;
    let notifiedWidth: number | undefined;
    const storageFailed = (error: unknown) => {
      console.warn("聊天面板宽度偏好无法读写，本次仍可调整。", error);
      setStorageError(true);
    };
    try {
      // WHY：localStorage 仅提供同步接口；在客户端 effect 中读取，避免 SSR 与 hydration 不一致。
      const stored = window.localStorage.getItem(storageKey);
      if (stored !== null && stored.trim() !== "") {
        const parsed = Number(stored);
        if (Number.isFinite(parsed) && parsed >= MIN_WIDTH) preferredWidth = parsed;
      }
    } catch (error: unknown) { storageFailed(error); }

    const publish = (requested: number) => {
      const next = Math.round(Math.min(currentBounds.max, Math.max(MIN_WIDTH, requested)));
      widthRef.current = next;
      setWidth(next);
      if (next !== notifiedWidth) {
        notifiedWidth = next;
        callbackRef.current(next);
      }
      return next;
    };
    const measure = () => {
      drag = null;
      const containerWidth = Math.max(0, Math.floor(container?.getBoundingClientRect().width ?? window.innerWidth));
      const reserved = Number.isFinite(minRemainingWidth) ? Math.max(0, minRemainingWidth) : 600;
      const proposed = getMaxWidth?.(containerWidth) ?? containerWidth - reserved;
      const available = Math.floor(Math.min(containerWidth, Number.isFinite(proposed) ? proposed : containerWidth - reserved));
      currentBounds = { max: Math.max(MIN_WIDTH, available), hidden: (media?.matches ?? window.innerWidth <= 900) || available < MIN_WIDTH };
      setBounds(currentBounds);
      // WHY：临时变窄仅限制实际宽度，不覆盖用户偏好；容器恢复后可以恢复原来的宽度。
      publish(preferredWidth);
    };
    const change = (requested: number) => {
      if (currentBounds.hidden || !Number.isFinite(requested)) return;
      preferredWidth = publish(requested);
      try {
        window.localStorage.setItem(storageKey, String(preferredWidth));
        setStorageError(false);
      } catch (error: unknown) { storageFailed(error); }
    };
    actions.current = {
      change,
      begin: (event) => {
        if (currentBounds.hidden || event.button !== 0 || !event.isPrimary || drag) return;
        event.preventDefault();
        handle.focus();
        drag = { pointerId: event.pointerId, x: event.clientX, width: widthRef.current };
      },
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      // WHY：聊天位于右侧，分隔线向左移动时，聊天宽度应增加而不是减少。
      change(drag.width + drag.x - event.clientX);
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId === drag?.pointerId) drag = null;
    };
    const cancel = () => { drag = null; };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (container) observer?.observe(container);
    media?.addEventListener("change", measure);
    window.addEventListener("resize", measure);
    // WHY：监听 window，拖出细小的把手仍然可调；卸载、取消或失焦后不遗留拖动状态。
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", cancel);
    return () => {
      actions.current = null;
      observer?.disconnect();
      media?.removeEventListener("change", measure);
      window.removeEventListener("resize", measure);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", cancel);
    };
  }, [containerRef, getMaxWidth, minRemainingWidth, storageKey]);

  return (
    <>
      <div
        ref={handleRef}
        className={[styles.resizer, className].filter(Boolean).join(" ")}
        role="separator"
        aria-label="调整聊天面板宽度"
        aria-orientation="vertical"
        aria-controls={controlsId}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={bounds.max}
        aria-valuenow={width}
        aria-valuetext={`${width} 像素`}
        tabIndex={bounds.hidden ? -1 : 0}
        hidden={bounds.hidden}
        title="向左拖动增宽；左右方向键调整，Home 最窄，End 最宽，双击复位"
        onPointerDown={(event) => actions.current?.begin(event)}
        onDoubleClick={() => actions.current?.change(DEFAULT_WIDTH)}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          const step = event.shiftKey ? 50 : 10;
          const target = event.key === "ArrowLeft" ? widthRef.current + step
            : event.key === "ArrowRight" ? widthRef.current - step
              : event.key === "Home" ? MIN_WIDTH
                : event.key === "End" ? bounds.max : undefined;
          if (target !== undefined) {
            event.preventDefault();
            actions.current?.change(target);
          }
        }}
      />
      {storageError && !bounds.hidden && (
        <span className={styles.status} role="status">无法保存聊天宽度，本次仍可调整；请允许浏览器本地存储后重试调整。</span>
      )}
    </>
  );
}

