"use client";
import { useEffect, useRef, useState } from "react";
import { readLibraryResponse, rememberedEdition, type LibraryBook } from "@/lib/library";

export function useWorkspaceLibrary(onInitialBook: (bookId: string, editionId?: string, fromBookLink?: boolean) => Promise<void>, onEmpty: () => void, fetcher: typeof fetch = fetch, mode: "reader" | "shelf" = "reader") {
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
        if (mode === "shelf") return;
        const savedBook = localStorage.getItem("judu:active-book");
        const query=new URLSearchParams(window.location.search);
        const requested=books.find(book=>book.id===query.get("bookId"));
        if (query.has("bookId") && !requested) throw new Error("这本书不在书架中，请返回书架重新选择。");
        const selected = requested ?? books.find(book => book.id === savedBook) ?? books[0];
        // WHY：恢复的是BookID+EditionID，不是标题或默认最新版；无效缓存只回退到仍存在的版本。
        if (selected) {
          const edition=rememberedEdition(selected,requested?query.get("editionId"):null)??rememberedEdition(selected,localStorage.getItem("judu:edition:"+selected.id));
          if(requested) { await restore.current(selected.id,edition,true); } else await restore.current(selected.id,edition);
          // WHY：书籍参数是当前工作台身份，不消费它；刷新与分享必须仍打开用户明确选择的书。
        }
        else empty.current();
      }
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      console.error("加载书架失败", cause); setError(cause instanceof Error ? cause.message : "书架读取失败，请重试"); empty.current();
    }).finally(() => { if (!controller.signal.aborted) { setLoading(false); setRestoring(false); } });
    return () => controller.abort();
  }, [revision, fetcher, mode]);
  const refresh = () => { setLoading(true); setError(""); setRevision(value => value + 1); };
  return { books, setBooks, loading, restoring, error, refresh };
}
