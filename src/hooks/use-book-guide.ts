"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { guideStateSchema, type GuideCommand, type GuideState } from "@/lib/guide";
import { isRecord } from "@/lib/chat-stream";
export function useBookGuide(bookId: string | null) {
  const [state, setState] = useState<GuideState | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const scope = useRef(bookId), sequence = useRef(0), mutation = useRef(false), stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; scope.current = bookId; }, [state, bookId]);
  const readResponse = async (response: Response) => {
    const value: unknown = await response.json();
    if (!response.ok) throw new Error(isRecord(value) && typeof value.error === "string" ? value.error : "导读服务暂不可用");
    return guideStateSchema.parse(value);
  };
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!bookId || mutation.current) return;
    const request = ++sequence.current;
    try {
      const next = await readResponse(await fetch(`/api/books/${encodeURIComponent(bookId)}/guide`, { signal, cache: "no-store" }));
      if (scope.current === bookId && request === sequence.current && !signal?.aborted) { if (next.bookId !== bookId) throw new Error("导读返回了其他书籍的数据"); setState(next); setError(""); }
    } catch (cause: unknown) { if (!signal?.aborted && scope.current === bookId && request === sequence.current) { console.error("读取导读失败", cause); setError(cause instanceof Error ? cause.message : "导读读取失败，请重试"); } }
  }, [bookId]);
  useEffect(() => {
    const abort = new AbortController();
    const tick = () => { if (!document.hidden) void refresh(abort.signal); };
    tick(); const timer = setInterval(tick, 4000); document.addEventListener("visibilitychange", tick);
    return () => { abort.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [refresh]);
  const command = useCallback(async (value: GuideCommand, expectedVersion?: number): Promise<boolean> => {
    const current = stateRef.current;
    if (!bookId || !current || current.bookId !== bookId || mutation.current) return false;
    mutation.current = true; sequence.current++; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/guide`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...value, version: expectedVersion ?? current.version }) });
      const next = await readResponse(response);
      if (next.bookId !== bookId) throw new Error("导读返回了其他书籍的数据");
      if (scope.current === bookId) setState(next);
      return scope.current === bookId;
    } catch (cause: unknown) {
      if (scope.current === bookId) { console.error("保存导读失败", cause); setError(cause instanceof Error ? cause.message : "导读保存失败，请重试"); }
      // WHY：保留编辑草稿，但刷新版本供用户复核后再次保存；绝不静默覆盖并发的 AI 改动。
      try { const fresh = await readResponse(await fetch(`/api/books/${encodeURIComponent(bookId)}/guide`, { cache: "no-store" })); if (scope.current === bookId) setState(fresh); }
      catch (refreshError: unknown) { console.error("刷新导读冲突版本失败", refreshError); }
      return false;
    } finally { mutation.current = false; if (scope.current === bookId) setBusy(false); }
  }, [bookId]);
  return { state: state?.bookId === bookId ? state : null, error, busy, refresh, command };
}
