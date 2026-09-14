"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const BOTTOM_EPSILON = 1;

export function useChatFollow(generating: boolean, contentVersion: unknown, conversationKey?: string | null) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const interacting = useRef(false);
  const initialized = useRef(false);
  const generatingRef = useRef(generating);
  const previousGenerating = useRef(false);
  const previousConversation = useRef(conversationKey);
  const lastTop = useRef(0);
  const frame = useRef<number | null>(null);
  const [showLatest, setShowLatest] = useState(false);

  const atBottom = useCallback(() => {
    const element = viewportRef.current;
    return !element || element.scrollHeight - element.clientHeight - element.scrollTop <= BOTTOM_EPSILON;
  }, []);
  const refresh = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    element.dataset.followLatest = String(following.current);
    setShowLatest(!atBottom());
  }, [atBottom]);
  const cancelFrame = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  const pauseFollowing = useCallback(() => {
    following.current = false;
    cancelFrame();
    refresh();
  }, [cancelFrame, refresh]);
  const moveToBottom = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    // WHY：直接写最终位置，不用 smooth；平滑动画会与持续增量、滚动条拖拽争抢 scrollTop。
    element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    lastTop.current = element.scrollTop;
    refresh();
  }, [refresh]);
  const scheduleBottom = useCallback((oneShot = false) => {
    cancelFrame();
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (following.current && !interacting.current && (oneShot || generatingRef.current)) moveToBottom();
      else refresh();
    });
  }, [cancelFrame, moveToBottom, refresh]);
  const jumpToLatest = useCallback(() => {
    following.current = true;
    interacting.current = false;
    moveToBottom();
    // WHY：按钮只做一次下一帧复核，以覆盖本次布局变化；不持久锁定滚动位置，也不抢焦点。
    scheduleBottom(true);
  }, [moveToBottom, scheduleBottom]);

  useLayoutEffect(() => {
    if (previousConversation.current !== conversationKey) {
      // WHY：切会话取消旧会话的待执行滚动，不能把上一会话的跟随/结束状态带入新会话。
      cancelFrame(); initialized.current = false; previousGenerating.current = false; interacting.current = false;
      previousConversation.current = conversationKey;
    }
    if (!initialized.current) {
      following.current = atBottom();
      lastTop.current = viewportRef.current?.scrollTop ?? 0;
      initialized.current = true;
    }
    const finishing = previousGenerating.current && !generating;
    generatingRef.current = generating;
    if ((generating || finishing) && following.current && !interacting.current) moveToBottom();
    else {
      if (!generating && !finishing && !atBottom()) following.current = false;
      refresh();
    }
    previousGenerating.current = generating;
  }, [generating, contentVersion, conversationKey, atBottom, cancelFrame, moveToBottom, refresh]);

  useEffect(() => {
    const element = viewportRef.current;
    const content = contentRef.current;
    if (!element) return;
    let touchY: number | undefined;
    const onScroll = () => {
      const movingUp = element.scrollTop < lastTop.current - 0.1;
      lastTop.current = element.scrollTop;
      if (movingUp || !atBottom()) pauseFollowing();
      else { following.current = true; refresh(); }
    };
    const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) pauseFollowing(); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) pauseFollowing();
    };
    const onPointerDown = () => { interacting.current = true; pauseFollowing(); };
    const onPointerUp = () => {
      if (!interacting.current) return;
      interacting.current = false;
      following.current = atBottom();
      refresh();
    };
    const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY; };
    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY;
      if (nextY !== undefined && touchY !== undefined && nextY > touchY) pauseFollowing();
      touchY = nextY;
    };
    const onResize = () => {
      // WHY：尺寸变化只在生成且仍有跟随意图时触底；历史阅读位置不被 resize 或 focus 恢复逻辑锁死。
      if (generatingRef.current && following.current && !interacting.current) scheduleBottom();
      else refresh();
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("wheel", onWheel, { passive: true });
    element.addEventListener("keydown", onKeyDown);
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("touchstart", onTouchStart, { passive: true });
    element.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("resize", onResize);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(onResize);
    observer?.observe(element);
    if (content) observer?.observe(content);
    return () => {
      cancelFrame();
      observer?.disconnect();
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("resize", onResize);
    };
  }, [conversationKey, atBottom, cancelFrame, pauseFollowing, refresh, scheduleBottom]);

  return { viewportRef, contentRef, showLatest, jumpToLatest, pauseFollowing };
}
