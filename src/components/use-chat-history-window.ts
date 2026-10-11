"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/chat-stream";

export const INITIAL_CHAT_MESSAGE_WINDOW = 30;
export const CHAT_MESSAGE_WINDOW_PAGE = 20;
export const MAX_CHAT_MESSAGE_WINDOW = 60;
const EDGE_THRESHOLD = 56;

type WindowState = {
  conversationKey: string | null;
  ready: boolean;
  start: number;
  end: number;
  mode: "latest" | "fixed";
  targetId: string | null;
};
type MessageEntry = { message: ChatMessage; index: number };
type PendingAnchor = { index: number; viewportOffset: number };
type Direction = "older" | "newer";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function messageIndexForTarget(messages: readonly ChatMessage[], targetId: string): number {
  return messages.findIndex(message => message.id === targetId || message.semantic?.units.some(unit => unit.id === targetId));
}

/**
 * WHY：长会话只渲染一个有上限的消息窗口；滚动到窗口边缘时按需移动窗口，避免整段历史一次性挂载造成卡顿。
 */
export function useChatHistoryWindow(
  messages: readonly ChatMessage[],
  conversationKey: string | null | undefined,
  historyLoading: boolean,
  historyTargetMessageId?: string | null,
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const key = conversationKey ?? null;
  const [windowState, setWindowState] = useState<WindowState>({ conversationKey: null, ready: false, start: 0, end: 0, mode: "latest", targetId: null });
  const pendingAnchor = useRef<PendingAnchor | null>(null);
  const directionIntent = useRef<Direction | null>(null);
  const pointerActive = useRef(false);
  const lastScrollTop = useRef(0);

  const ready = !historyLoading;
  const stateIsCurrent = windowState.conversationKey === key && windowState.ready === ready;
  const latestStart = Math.max(0, messages.length - INITIAL_CHAT_MESSAGE_WINDOW);
  const stateRange = stateIsCurrent && windowState.mode === "fixed"
    ? { start: clamp(windowState.start, 0, messages.length), end: clamp(windowState.end, clamp(windowState.start, 0, messages.length), messages.length), mode: "fixed" as const }
    : { start: historyLoading ? 0 : latestStart, end: historyLoading ? 0 : messages.length, mode: windowState.mode === "fixed" && stateIsCurrent ? "fixed" as const : "latest" as const };
  const targetIndex = !historyLoading && historyTargetMessageId ? messageIndexForTarget(messages, historyTargetMessageId) : -1;

  // WHY：会话身份/加载状态是窗口状态的版本键；在 render 阶段丢弃旧窗口，避免切会话时短暂渲染上一会话的历史范围。
  if (!stateIsCurrent) {
    setWindowState({ conversationKey: key, ready, start: historyLoading ? 0 : latestStart, end: historyLoading ? 0 : messages.length, mode: historyLoading ? "fixed" : "latest", targetId: null });
  } else {
    const desiredTargetId = historyLoading ? null : historyTargetMessageId ?? null;
    if (windowState.targetId !== desiredTargetId) {
      if (desiredTargetId) {
        const targetStart = targetIndex >= 0 && (targetIndex < stateRange.start || targetIndex >= stateRange.end)
          ? Math.max(0, targetIndex - Math.floor(MAX_CHAT_MESSAGE_WINDOW / 3))
          : stateRange.start;
        const targetEnd = targetIndex >= 0 && (targetIndex < stateRange.start || targetIndex >= stateRange.end)
          ? Math.min(messages.length, targetStart + MAX_CHAT_MESSAGE_WINDOW)
          : stateRange.end;
        setWindowState({ conversationKey: key, ready: true, start: targetStart, end: targetEnd, mode: "fixed", targetId: desiredTargetId });
      } else {
        setWindowState({ ...windowState, targetId: null });
      }
    }
  }

  // WHY：目标定位窗口直接由目标消息索引计算；无论目标多旧，DOM 数量都不会超过固定上限。
  const range = stateRange;
  const visibleMessages = useMemo<MessageEntry[]>(
    () => messages.slice(range.start, range.end).map((message, offset) => ({ message, index: range.start + offset })),
    [messages, range.start, range.end],
  );
  const hasOlder = range.start > 0;
  const hasNewer = range.end < messages.length;
  const targetFound = targetIndex >= 0;
  const targetVisible = targetFound && targetIndex >= range.start && targetIndex < range.end;

  const freezeLatestWindow = useCallback(() => {
    if (historyLoading || range.mode !== "latest") return;
    setWindowState({ conversationKey: key, ready: true, start: range.start, end: range.end, mode: "fixed", targetId: windowState.targetId });
  }, [historyLoading, key, range.end, range.mode, range.start, windowState.targetId]);
  const captureAnchor = useCallback((which: "first" | "last") => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const elements = [...content.querySelectorAll<HTMLElement>("[data-message-index]")];
    const element = which === "first" ? elements[0] : elements.at(-1);
    const index = Number(element?.dataset.messageIndex);
    if (!element || !Number.isSafeInteger(index)) return;
    const viewportTop = viewport.getBoundingClientRect().top + viewport.clientTop;
    pendingAnchor.current = { index, viewportOffset: element.getBoundingClientRect().top - viewportTop };
  }, []);
  const loadEarlier = useCallback(() => {
    if (historyLoading || range.start <= 0) return;
    captureAnchor("first");
    const currentCount = range.end - range.start;
    const room = Math.max(0, MAX_CHAT_MESSAGE_WINDOW - currentCount);
    const count = Math.min(CHAT_MESSAGE_WINDOW_PAGE, range.start, room || CHAT_MESSAGE_WINDOW_PAGE);
    const start = Math.max(0, range.start - count);
    const end = room > 0 ? range.end : Math.max(start, range.end - count);
    setWindowState({ conversationKey: key, ready: true, start, end, mode: "fixed", targetId: windowState.targetId });
  }, [captureAnchor, historyLoading, key, range.end, range.start, windowState.targetId]);
  const loadNewer = useCallback(() => {
    if (historyLoading || range.end >= messages.length) return;
    captureAnchor("last");
    const currentCount = range.end - range.start;
    const room = Math.max(0, MAX_CHAT_MESSAGE_WINDOW - currentCount);
    const count = Math.min(CHAT_MESSAGE_WINDOW_PAGE, messages.length - range.end, room || CHAT_MESSAGE_WINDOW_PAGE);
    const end = Math.min(messages.length, range.end + count);
    const start = room > 0 ? range.start : Math.min(range.start + count, end);
    setWindowState({ conversationKey: key, ready: true, start, end, mode: "fixed", targetId: windowState.targetId });
  }, [captureAnchor, historyLoading, key, messages.length, range.end, range.start, windowState.targetId]);
  const showLatestMessages = useCallback(() => {
    pendingAnchor.current = null;
    setWindowState({ conversationKey: key, ready: !historyLoading, start: latestStart, end: messages.length, mode: "latest", targetId: windowState.targetId });
  }, [historyLoading, key, latestStart, messages.length, windowState.targetId]);

  // WHY：prepend/append 后用稳定消息索引补偿滚动差值，避免用户触边加载时视口突然跳走。
  useLayoutEffect(() => {
    const anchor = pendingAnchor.current;
    if (!anchor) return;
    pendingAnchor.current = null;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    const element = [...(content?.querySelectorAll<HTMLElement>("[data-message-index]") ?? [])]
      .find(item => Number(item.dataset.messageIndex) === anchor.index);
    if (!viewport || !element) return;
    const viewportTop = viewport.getBoundingClientRect().top + viewport.clientTop;
    const nextOffset = element.getBoundingClientRect().top - viewportTop;
    const delta = nextOffset - anchor.viewportOffset;
    if (Math.abs(delta) > 0.5) viewport.scrollTop += delta;
    lastScrollTop.current = viewport.scrollTop;
  }, [range.end, range.start]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    lastScrollTop.current = viewport.scrollTop;
    const isNearTop = () => viewport.scrollTop <= EDGE_THRESHOLD;
    const isNearBottom = () => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= EDGE_THRESHOLD;
    const handleDirection = (direction: Direction) => {
      directionIntent.current = null;
      if (direction === "older") {
        freezeLatestWindow();
        if (isNearTop() && hasOlder) loadEarlier();
      } else {
        freezeLatestWindow();
        if (isNearBottom() && hasNewer) loadNewer();
      }
    };
    const onScroll = () => {
      const current = viewport.scrollTop;
      let direction = directionIntent.current;
      if (!direction && pointerActive.current) {
        if (current < lastScrollTop.current - 0.5) direction = "older";
        else if (current > lastScrollTop.current + 0.5) direction = "newer";
      }
      lastScrollTop.current = current;
      if (direction) handleDirection(direction);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      const direction = event.deltaY < 0 ? "older" : "newer";
      directionIntent.current = direction;
      if ((direction === "older" && isNearTop()) || (direction === "newer" && isNearBottom())) handleDirection(direction);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const older = ["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey);
      const newer = ["ArrowDown", "PageDown", "End"].includes(event.key) || (event.key === " " && !event.shiftKey);
      if (!older && !newer) return;
      const direction = older ? "older" : "newer";
      directionIntent.current = direction;
      if ((older && isNearTop()) || (newer && isNearBottom())) handleDirection(direction);
    };
    const onPointerDown = () => { pointerActive.current = true; };
    const onPointerEnd = () => { pointerActive.current = false; };
    let touchY: number | undefined;
    const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY; };
    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY;
      if (nextY === undefined || touchY === undefined || nextY === touchY) return;
      const direction = nextY > touchY ? "older" : "newer";
      touchY = nextY;
      directionIntent.current = direction;
      if ((direction === "older" && isNearTop()) || (direction === "newer" && isNearBottom())) handleDirection(direction);
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("wheel", onWheel, { passive: true });
    viewport.addEventListener("keydown", onKeyDown);
    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("touchstart", onTouchStart, { passive: true });
    viewport.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    return () => {
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("touchstart", onTouchStart);
      viewport.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      directionIntent.current = null;
      pointerActive.current = false;
    };
  }, [freezeLatestWindow, hasOlder, hasNewer, historyLoading, loadEarlier, loadNewer, range.end, range.start]);

  return { viewportRef, contentRef, visibleMessages, startIndex: range.start, endIndex: range.end, hasOlder, hasNewer, targetFound, targetVisible, loadEarlier, loadNewer, showLatestMessages };
}
