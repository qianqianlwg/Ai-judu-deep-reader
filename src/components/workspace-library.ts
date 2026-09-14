"use client";
import { useEffect, useRef, useState } from "react";
import { readLibraryResponse, rememberedEdition, type LibraryBook } from "@/lib/library";

export function useWorkspaceLibrary(onInitialBook: (bookId: string, editionId?: string) => Promise<void>, onEmpty: () => void, fetcher: typeof fetch = fetch) {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const initialized = useRef(false);
  const restore = useRef(onInitialBook); const empty = useRef(onEmpty);
  useEffect(() => { restore.current = onInitialBook; empty.current = onEmpty; });
  useEffect(() => {
    const controller = new AbortController();
    void fetcher("/api/library", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("加载书架失败（HTTP " + response.status + "）");
      const books = readLibraryResponse(await response.json());
      if (controller.signal.aborted) return;
      setBooks(books);
      if (!initialized.current) {
        initialized.current = true;
        const savedBook = localStorage.getItem("judu:active-book");
        const selected = books.find(book => book.id === savedBook) ?? books[0];
        // WHY：恢复的是BookID+EditionID，不是标题或默认最新版；无效缓存只回退到仍存在的版本。
        if (selected) await restore.current(selected.id, rememberedEdition(selected, localStorage.getItem("judu:edition:" + selected.id)));
        else empty.current();
      }
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      console.error("加载书架失败", cause); setError(cause instanceof Error ? cause.message : "书架读取失败，请重试"); empty.current();
    }).finally(() => { if (!controller.signal.aborted) { setLoading(false); setRestoring(false); } });
    return () => controller.abort();
  }, [revision, fetcher]);
  const refresh = () => { setLoading(true); setError(""); setRevision(value => value + 1); };
  return { books, setBooks, loading, restoring, error, refresh };
}
