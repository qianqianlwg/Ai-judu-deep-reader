// @vitest-environment jsdom
import React, { act, useRef, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useReaderPages } from "./use-reader-pages";
vi.mock("@/lib/reader-measurement", () => ({
  readerContentBox: () => ({ width: 300, height: 150 }),
  createReaderMeasurement: (_width: number, scale: number, _style: unknown, markers?: ReadonlyMap<string, readonly number[]>) => { recordedMarkers.push(markers); return { dispose: () => {}, measure: (parts: {text: string}[]) => parts.reduce((s,p) => s + Math.ceil(p.text.length / Math.floor(30 / scale)) * 30, 0) }; },
}));
const recordedMarkers = vi.hoisted(() => [] as (ReadonlyMap<string, readonly number[]> | undefined)[]);
const paragraphs = [{ id:"p", chapterId:"c", chapterTitle:"章", text:"原文abcdefghijklmnopqrstuvwxyz".repeat(100) }];
let reader: ReturnType<typeof useReaderPages>;
function Harness({scale,markers}:{scale:number;markers?:ReadonlyMap<string,readonly number[]>}) { const ref = useRef<HTMLDivElement>(null); const state = useReaderPages(paragraphs, ref, scale, undefined, markers); useLayoutEffect(() => { reader = state; }, [state]); return <div ref={ref} />; }
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


it("句读入口改变后重新测量占位，保留同一个阅读锚点", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const el = document.createElement("div"); document.body.append(el); const root = createRoot(el);
  const empty = new Map<string, readonly number[]>(), added = new Map([["p", [50, 120]]]);
  const render = async (markers: ReadonlyMap<string, readonly number[]>) => { await act(async () => { root.render(<Harness scale={1} markers={markers}/>); }); await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); }); };
  try {
    await render(empty); await act(async () => reader.setPageIndex(1)); const anchor = reader.anchor;
    await render(added); expect(recordedMarkers.at(-1)).toBe(added); expect(reader.anchor).toEqual(anchor); expect(reader.busy).toBe(false);
    await render(empty); expect(recordedMarkers.at(-1)).toBe(empty); expect(reader.anchor).toEqual(anchor);
  } finally { await act(async () => root.unmount()); el.remove(); }
});
