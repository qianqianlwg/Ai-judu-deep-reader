"use client";
import { useCallback, useLayoutEffect, useMemo, useState, type RefObject } from "react";
import { createReadingAnchor, findPageIndexForAnchor, type PaginatedParagraph, type ReadingAnchor, type ReadingPage } from "@/lib/pagination";
import { paginateMeasuredParagraphs } from "@/lib/measured-pagination";
import { createReaderMeasurement, readerContentBox } from "@/lib/reader-measurement";

type Layout = { source: readonly PaginatedParagraph[]; width: number; height: number; scale: number; pages: ReadingPage[] };
type ReaderLayoutStyle = Readonly<Record<string, string | number>>;
export function useReaderPages(source: readonly PaginatedParagraph[], viewport: RefObject<HTMLDivElement | null>, scale: number, textStyle: ReaderLayoutStyle = {}) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [anchor, setAnchor] = useState<ReadingAnchor | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let task: AbortController | undefined;
    let lastKey = "";
    const update = () => {
      const box = readerContentBox(element);
      const key = [box.width, box.height, scale, JSON.stringify(textStyle)].join(":");
      if (key === lastKey) return;
      lastKey = key;
      task?.abort(); clearTimeout(timer); setBusy(true);
      timer = setTimeout(() => {
        const controller = new AbortController(); task = controller;
        void (async () => {
          await document.fonts?.ready;
          if (cancelled || controller.signal.aborted) return;
          const measurement = createReaderMeasurement(box.width, scale, textStyle);
          try {
            const pages = await paginateMeasuredParagraphs(source, { height: box.height, measure: measurement.measure, signal: controller.signal, yieldControl: () => new Promise((resolve) => setTimeout(resolve, 0)) });
            if (!cancelled && !controller.signal.aborted) { setLayout({ source, ...box, scale, pages }); setError(""); setBusy(false); }
          } catch (cause: unknown) {
            if (controller.signal.aborted || cancelled) return;
            console.error("正文分页失败", cause); setError(cause instanceof Error ? cause.message : "分页失败"); setBusy(false);
          } finally { measurement.dispose(); }
        })();
      }, 100);
    };
    const observer = new ResizeObserver(update); observer.observe(element); update();
    const fontLoaded = () => { lastKey = ""; update(); };
    document.fonts?.addEventListener("loadingdone", fontLoaded);
    return () => { cancelled = true; clearTimeout(timer); task?.abort(); observer.disconnect(); document.fonts?.removeEventListener("loadingdone", fontLoaded); };
  }, [source, scale, textStyle, viewport]);
  const pages = useMemo(() => layout?.source === source ? layout.pages : [], [layout, source]);
  const pageIndex = anchor ? Math.max(0, findPageIndexForAnchor(pages, anchor)) : 0;
  const setPageIndex = useCallback((index: number) => {
    const next = createReadingAnchor(pages[Math.max(0, Math.min(index, pages.length - 1))]);
    if (next) setAnchor(next);
  }, [pages]);
  // WHY：只有翻页或主动定位才更新锚点。缩放不能把“新页首”写回锚点，否则来回缩放会逐次漂移。
  return { pages, pageIndex, currentPage: pages[pageIndex], setPageIndex, setAnchor, anchor, busy: busy || layout?.source !== source, error, renderedScale: layout?.scale ?? scale };
}
