// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { GUIDE_POSITION_GRADIENT, guideColorScale } from "@/lib/guide-locations";
import { GuideNodePosition } from "./guide-node-position";
import type { GuideLocationView } from "./guide-position-bar";
let host: HTMLDivElement, root: Root;
function normalizedGradient() {
  const reference = document.createElement("div");
  reference.style.background = GUIDE_POSITION_GRADIENT;
  return reference.style.backgroundImage;
}
const node = { id: "a", parentId: null, title: "主题", summary: "", sourceIds: ["s"] };
const state: GuideLocationView = { loading: false, error: "", retry: vi.fn(), locations: { bookId: "b", version: 1, issues: [], sources: [{ sourceId: "s", editionId: "e", editionLabel: "原书", spans: [{ paragraphId: "p", chapterId: "c", chapterTitle: "第一章", start: .1, end: .2 }, { paragraphId: "p2", chapterId: "c2", chapterTitle: "第三章", start: .8, end: .9 }] }] } };
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });
it("主题详情列出章节和全书位置，跨章节来源不折算成平均值", async () => {
  await act(async () => root.render(<GuideNodePosition node={node} nodes={[node]} state={state} />));
  expect(host.querySelector('h3')?.textContent).toBe("全书位置"); expect(host.textContent).toContain("第一章"); expect(host.textContent).toContain("10%–20%");
  expect(host.querySelectorAll('li')).toHaveLength(2); expect(host.textContent).toContain("80%–90%");
});
it("无来源、来源失配和读取错误有不同反馈，不猜测位置", async () => {
  const personal = { ...node, sourceIds: [] };
  await act(async () => root.render(<GuideNodePosition node={personal} nodes={[personal]} state={state} />)); expect(host.textContent).toContain("无原文来源");
  await act(async () => root.render(<GuideNodePosition node={node} nodes={[node]} state={{ ...state, locations: { ...state.locations!, sources: [] } }} />)); expect(host.textContent).toContain("暂无可核对");
  await act(async () => root.render(<GuideNodePosition node={node} nodes={[node]} state={{ ...state, locations: null, error: "加载失败" }} />)); expect(host.querySelector('[role="alert"]')?.textContent).toContain("加载失败");
});

it("近似位置只显示一行章节和范围，不显示原文文字位置、来源计数或已合并提示", async () => {
  const nearState: GuideLocationView = { ...state, locations: { ...state.locations!, sources: [{ ...state.locations!.sources[0], spans: [
    { paragraphId: "p457", paragraphIndex: 457, chapterId: "c", chapterTitle: "第一章 商品", start: .027137966, end: .027272918 },
    { paragraphId: "p459", paragraphIndex: 470, chapterId: "c", chapterTitle: "第一章 商品", start: .027334880, end: .027422048 }
  ] }] } };
  await act(async () => root.render(<GuideNodePosition node={node} nodes={[node]} state={nearState} />));
  expect(host.querySelectorAll("li")).toHaveLength(1); expect(host.textContent).toContain("2.71%–2.74%");
  expect(host.textContent).not.toContain("原文文字位置"); expect(host.textContent).not.toContain("已合并"); expect(host.textContent).not.toContain("则来源");
  expect(host.querySelectorAll('[aria-hidden="true"]>span[style]')).toHaveLength(2);
});

it("全书位置始终显示完整渐变底带，极短的前部来源只改变标记而不覆盖色带", async () => {
  const earlyState: GuideLocationView = { ...state, locations: { ...state.locations!, sources: [{ ...state.locations!.sources[0], spans: [
    { paragraphId: "early", chapterId: "c", chapterTitle: "第一章 商品", start: .0259, end: .0261 }
  ] }] } };
  await act(async () => root.render(<GuideNodePosition node={node} nodes={[node]} state={earlyState} />));
  const track = host.querySelector<HTMLDivElement>('div[aria-hidden="true"]');
  expect(track?.style.backgroundImage).toBe(normalizedGradient());
  expect(track?.style.backgroundImage).toContain("linear-gradient");
  expect(track?.querySelector("span")?.style.left).toBe("2.59%");
  expect(host.textContent).toContain("2.59%–2.61%");
});

it("切换主题和已关联范围色阶不会丢失全书底带或移动真实位置标记", async () => {
  const second = { ...node, id: "second", sourceIds: ["later"] };
  const locations = { ...state.locations!, sources: [...state.locations!.sources, { ...state.locations!.sources[0], sourceId: "later", spans: [
    { paragraphId: "later", chapterId: "c3", chapterTitle: "第四章", start: .7, end: .71 }
  ] }] };
  for (const current of [node, second, node]) {
    for (const mode of ["mapped", "book"] as const) {
      await act(async () => root.render(<GuideNodePosition node={current} nodes={[node, second]} state={{ ...state, locations, colorScale: guideColorScale(locations, mode) }} />));
      const track = host.querySelector<HTMLDivElement>('div[aria-hidden="true"]');
      expect(track?.style.backgroundImage).toBe(normalizedGradient());
      expect(track?.querySelector("span")?.style.left).toBe(current.id === second.id ? "70%" : "10%");
      expect(host.textContent).toContain("书首 0%");
      expect(host.textContent).toContain("书末 100%");
    }
  }
});

it("没有来源时保留全书颜色参照，但不生成位置标记", async () => {
  const personal = { ...node, sourceIds: [] };
  await act(async () => root.render(<GuideNodePosition node={personal} nodes={[personal]} state={state} />));
  const track = host.querySelector<HTMLDivElement>('div[aria-hidden="true"]');
  expect(track?.style.backgroundImage).toBe(normalizedGradient());
  expect(track?.querySelectorAll("span")).toHaveLength(0);
  expect(host.textContent).toContain("无原文来源");
});
