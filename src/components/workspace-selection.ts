"use client";

import { useEffect, useRef, type RefObject } from "react";
import { readReadingSelection, type ReadingSelection } from "@/lib/reader-selection";

export function useWorkspaceSelection(viewport: RefObject<HTMLElement | null>, onSelection: (selection: ReadingSelection) => void, enabled = true): void {
  const callback = useRef(onSelection);
  useEffect(() => { callback.current = onSelection; });
  useEffect(() => {
    const element = viewport.current;
    if (!enabled || !element) return;
    const document = element.ownerDocument;
    let frame: number | undefined;
    let lastKey = "";
    const changed = () => {
      if (!element.isConnected || element.closest("[inert]")) return;
      const snapshot = readReadingSelection(document.getSelection(), element);
      // WHY：按钮、聊天框或折叠选区带来的空 selection 不能清空已经确认的原文快照。
      if (!snapshot) return;
      const key = JSON.stringify(snapshot);
      if (key === lastKey) return;
      lastKey = key;
      if (frame !== undefined) cancelAnimationFrame(frame);
      // WHY：先捕获 UTF-16 选文，再合并帧更新；不能到下一帧才读已被按钮点击折叠的 Range。
      frame = requestAnimationFrame(() => { frame = undefined; callback.current(snapshot); });
    };
    document.addEventListener("selectionchange", changed);
    element.addEventListener("keyup", changed);
    return () => {
      document.removeEventListener("selectionchange", changed); element.removeEventListener("keyup", changed);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [enabled, viewport]);
}
