// @vitest-environment jsdom
import React, { act, useRef, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useReaderPages } from "./use-reader-pages";
vi.mock("@/lib/reader-measurement", () => ({
  readerContentBox: () => ({ width: 300, height: 150 }),
  createReaderMeasurement: (_width: number, scale: number) => ({ dispose: () => {}, measure: (parts: {text: string}[]) => parts.reduce((s,p) => s + Math.ceil(p.text.length / Math.floor(30 / scale)) * 30, 0) }),
}));
const paragraphs = [{ id:"p", chapterId:"c", chapterTitle:"章", text:"原文abcdefghijklmnopqrstuvwxyz".repeat(100) }];
let reader: ReturnType<typeof useReaderPages>;
function Harness({scale}:{scale:number}) { const ref = useRef<HTMLDivElement>(null); const state = useReaderPages(paragraphs, ref, scale); useLayoutEffect(() => { reader = state; }, [state]); return <div ref={ref} />; }
afterEach(() => vi.unstubAllGlobals());
it("反复缩小放大保留同一个用户导航锚点", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const el = document.createElement("div"); document.body.append(el); const root = createRoot(el);
  const render = async (scale:number) => { await act(async () => { root.render(<Harness scale={scale}/>); }); await act(async () => { await new Promise(r=>setTimeout(r,250)); }); };
  try {
    await render(1); await act(async () => reader.setPageIndex(1));
    const anchor = reader.anchor; const text = reader.currentPage.paragraphs[0].text;
    await render(.8); expect(reader.anchor).toEqual(anchor);
    await render(1); expect(reader.pageIndex).toBe(1); expect(reader.currentPage.paragraphs[0].text).toBe(text); expect(reader.anchor).toEqual(anchor);
  } finally { await act(async () => root.unmount()); el.remove(); }
});
