"use client";
import { useCallback, useEffect, useState } from "react";
import { isRecord } from "@/lib/chat-stream";
import { guideLocationsSchema, type GuideLocations } from "@/lib/guide-locations";
export function useGuideLocations(bookId: string | null, version: number | null) {
  const [data, setData] = useState<GuideLocations | null>(null);
  const [failure, setFailure] = useState<{ bookId: string; version: number; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!bookId || version === null) return;
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/books/" + encodeURIComponent(bookId) + "/guide/locations", { signal: abort.signal, cache: "no-store" });
        const value: unknown = await response.json();
        if (!response.ok) throw new Error(isRecord(value) && typeof value.error === "string" ? value.error : "读取全书位置失败，请重试");
        const checked = guideLocationsSchema.parse(value);
        if (checked.bookId !== bookId) throw new Error("全书位置返回了其他书籍的数据");
        if (checked.version !== version) throw new Error("导图刚有更新，请刷新全书位置");
        if (!abort.signal.aborted) { setData(checked); setFailure(null); }
      } catch (error: unknown) {
        if (!abort.signal.aborted) {
          console.error("读取全书位置失败", error);
          setFailure({ bookId, version, message: error instanceof Error ? error.message : "读取全书位置失败，请重试" });
        }
      }
    })();
    return () => abort.abort();
  }, [bookId, version, attempt]);
  const current = data?.bookId === bookId && data.version === version ? data : null;
  const error = failure?.bookId === bookId && failure.version === version ? failure.message : "";
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  return { locations: current, error, loading: Boolean(bookId && version !== null && !current && !error), retry };
}
