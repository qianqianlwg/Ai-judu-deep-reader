"use client";

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { BookshelfHome } from "./bookshelf-home";

export function WorkspaceEntry({ children }: { children: ReactNode }) {
  const search = useSearchParams();
  // WHY：书架属于整个书库，本书工作台只在 URL 有明确选书意图时挂载，避免混入上次阅读的上下文。
  return search.get("bookId") ? children : <BookshelfHome />;
}
