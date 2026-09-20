"use client";

import { useEffect, useRef, type RefObject } from "react";
import { readReadingSelection, type ReadingSelection } from "@/lib/reader-selection";

export function useWorkspaceSelection(viewport: RefObject<HTMLElement | null>, onSelection: (selection: ReadingSelection) => void, enabled = true, onLimit?: () => void, onInvalid?: () => void, onStart?: () => void): void {
  const callback = useRef(onSelection), limited=useRef(onLimit), invalid=useRef(onInvalid), start=useRef(onStart);
  useEffect(() => { callback.current = onSelection; limited.current=onLimit; invalid.current=onInvalid; start.current=onStart; });
  useEffect(() => {
    const element = viewport.current;
    if (!enabled || !element) return;
    const document = element.ownerDocument;
    let frame: number | undefined;
    let lastKey = "";
    const changed = () => {
      if (!element.isConnected || element.closest("[inert]")) return;
      const selection=document.getSelection();
      const snapshot = readReadingSelection(selection, element,()=>limited.current?.());
      // WHY：按钮、聊天框或折叠选区带来的空 selection 不能清空已经确认的原文快照。
      if (!snapshot) { if(selection && !selection.isCollapsed && selection.rangeCount && selection.getRangeAt(0).intersectsNode(element)) { lastKey=""; if(frame!==undefined)cancelAnimationFrame(frame); invalid.current?.(); } return; }
      const key = JSON.stringify(snapshot);
      if (key === lastKey) return;
      lastKey = key;
      if (frame !== undefined) cancelAnimationFrame(frame);
      // WHY：先捕获 UTF-16 选文，再合并帧更新；不能到下一帧才读已被按钮点击折叠的 Range。
      frame = requestAnimationFrame(() => { frame = undefined; callback.current(snapshot); });
    };
    const started = (event: Event) => {
      const target=event.target;
      if(target instanceof Element && target.closest("[data-reader-decoration],button,input,textarea,[role='dialog']"))return;
      lastKey=""; if(frame!==undefined){cancelAnimationFrame(frame);frame=undefined;} (start.current??invalid.current)?.();
    };
    const keyed = () => {
      const selection=document.getSelection();
      if(selection?.isCollapsed && selection.anchorNode && element.contains(selection.anchorNode)){lastKey="";invalid.current?.();return;}
      changed();
    };
    document.addEventListener("selectionchange", changed);
    element.addEventListener("pointerdown",started);
    element.addEventListener("keyup", keyed);
    return () => {
      document.removeEventListener("selectionchange", changed); element.removeEventListener("keyup", keyed); element.removeEventListener("pointerdown",started);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [enabled, viewport]);
}
