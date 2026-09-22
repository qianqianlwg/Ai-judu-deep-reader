"use client";
import { useEffect, useRef, useState } from "react";
import { readLibraryResponse, rememberedEdition, type LibraryBook } from "@/lib/library";

export function useWorkspaceLibrary(onInitialBook: (bookId: string, editionId?: string, fromBookLink?: boolean) => Promise<void>, onEmpty: () => void, fetcher: typeof fetch = fetch) {
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
        const query=new URLSearchParams(window.location.search);
        const requested=books.find(book=>book.id===query.get("bookId"));
        const selected = requested ?? books.find(book => book.id === savedBook) ?? books[0];
        // WHY：恢复的是BookID+EditionID，不是标题或默认最新版；无效缓存只回退到仍存在的版本。
        if (selected) {
          const edition=rememberedEdition(selected,requested?query.get("editionId"):null)??rememberedEdition(selected,localStorage.getItem("judu:edition:"+selected.id));
          if(requested) { await restore.current(selected.id,edition,true); } else await restore.current(selected.id,edition);
          // WHY：书架链接是一次性打开意图，消费后清除，避免用户随后切书再刷新又被旧 URL 拉回。
          if(requested&&!controller.signal.aborted){query.delete("bookId");query.delete("editionId");window.history.replaceState(window.history.state,"",window.location.pathname+(query.size?"?"+query.toString():"")+window.location.hash);}
        }
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
