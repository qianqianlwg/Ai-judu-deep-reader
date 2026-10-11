// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { GuidePositionBar } from "./guide-position-bar";
import type { GuideLocationView } from "./guide-position-bar";
let host: HTMLDivElement, root: Root;
const nodes = [{ id: "a", parentId: null, title: "主题", summary: "", sourceIds: ["s"] }];
const state: GuideLocationView = { loading: false, error: "", retry: vi.fn(), locations: { bookId: "b", version: 1, issues: [], sources: [{ sourceId: "s", editionId: "e", editionLabel: "原书", spans: [{ paragraphId: "p", chapterId: "c", chapterTitle: "第一章", start: .1, end: .2 }, { paragraphId: "p2", chapterId: "c2", chapterTitle: "第三章", start: .8, end: .9 }] }] } };
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });
it("明确标注全书位置及连线颜色，选中节点的独立来源不会填满间隔", async () => {
  await act(async () => root.render(<GuidePositionBar nodes={nodes} selected="a" state={state} onSelect={vi.fn()} />));
  expect(host.textContent).toContain("连线颜色对照"); expect(host.textContent).toContain("书末 100%");
  const marks = [...host.querySelectorAll<HTMLElement>('span[title]')];
  expect(marks).toHaveLength(2); expect(marks[0].style.left).toBe("10%"); expect(marks[0].style.width).toBe("10%");
  expect(marks[1].title).toContain("80%–90%");
});
it("键盘和点击色条可定位对应主题，读取失败能重试", async () => {
  const select = vi.fn(), retry = vi.fn();
  await act(async () => root.render(<GuidePositionBar nodes={nodes} selected={null} state={state} onSelect={select} />));
  act(() => host.querySelector<HTMLButtonElement>('[aria-label^="全书位置色条"]')!.click()); expect(select).toHaveBeenCalledWith("a");
  await act(async () => root.render(<GuidePositionBar nodes={nodes} selected={null} state={{ ...state, locations: null, error: "暂时失败", retry }} onSelect={select} />));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("暂时失败");
  act(() => [...host.querySelectorAll("button")].find(button => button.textContent === "重试")!.click()); expect(retry).toHaveBeenCalledOnce();
});

it("工具栏紧凑色条标明局部真实范围，切换全书模式不改原文位置", async () => {
  const change = vi.fn();
  const mapped = { ...state, colorScale: { mode: "mapped" as const, start: .1, end: .9 }, onColorMode: change };
  await act(async () => root.render(<GuidePositionBar compact nodes={nodes} selected="a" state={mapped} onSelect={vi.fn()} />));
  expect(host.textContent).toContain("10%"); expect(host.textContent).toContain("90%");
  const marks = [...host.querySelectorAll<HTMLElement>('span[title]')];
  expect(marks[0].style.left).toBe("0%"); expect(parseFloat(marks[0].style.width)).toBeCloseTo(12.5);
  act(() => [...host.querySelectorAll("button")].find(button => button.textContent === "全书")!.click());
  expect(change).toHaveBeenCalledWith("book"); expect(state.locations!.sources[0].spans[0].start).toBe(.1);
});
