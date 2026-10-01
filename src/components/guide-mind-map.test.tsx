// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ action: vi.fn(), retry: vi.fn(), engine: { current: { miniMap: { calculationMiniMap: vi.fn(() => ({ svgHTML: "<svg></svg>", viewBoxStyle: {} })) } } } }));
vi.mock("@/hooks/use-guide-map-engine", () => ({ useGuideMapEngine: () => ({ ...mocks, ready: true, error: "", zoom: 1, revision: 1, element: { current: null }, engine: mocks.engine }) }));
import { GuideMindMap } from "./guide-mind-map";
it("默认呈现真实画板与视角工具，节点详情不抢双击编辑", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); const host = document.createElement("div"), root = createRoot(host), inspect = vi.fn(); document.body.append(host);
  await act(async () => root.render(<GuideMindMap bookId="b" title="书" version={1} busy={false} nodes={[{ id: "a", parentId: null, title: "理解", summary: "已读原文", sourceIds: [] }]} collapsed={new Set()} selected="a" query="理解" onToggle={vi.fn()} onSelect={vi.fn()} onCommand={vi.fn()} onEdit={vi.fn()} onCreate={vi.fn()} onInspect={inspect} />));
  expect(host.querySelector('[aria-label="思维导图交互画板"]')).not.toBeNull();
  const canvas = host.querySelector<HTMLElement>('[aria-label="主题节点画板，双击节点编辑，拖动调整结构"]')!; expect(canvas.tabIndex).toBe(0); act(() => canvas.focus()); expect(document.activeElement).toBe(canvas);
  expect(host.textContent).toContain("1 / 1 个匹配");
  act(() => [...host.querySelectorAll("button")].find(button => button.textContent === "节点详情")!.click()); expect(inspect).toHaveBeenCalledTimes(1);
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="放大画板"]')!.click()); expect(mocks.action).toHaveBeenCalled();
  act(() => [...host.querySelectorAll("button")].find(button => button.textContent === "导航图")!.click()); await vi.waitFor(() => expect(host.querySelector('[aria-label="思维导图导航缩略图"] img')?.getAttribute("width")).toBe("200")); expect(host.querySelector('[aria-label="思维导图导航缩略图"] img')?.getAttribute("height")).toBe("130");
  act(() => root.unmount()); host.remove(); vi.unstubAllGlobals();
});

it('定位最新按生成时间而不是数组最后一项，并交给引擎展开祖先定位', async () => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'), root = createRoot(host), select = vi.fn();document.body.append(host);
  const node = (id: string, updated: number) => ({ id, parentId: null, title: id, summary: '', sourceIds: [], timeline: { created: 1, updated, createdAt: 't', updatedAt: 't' } });
  await act(async () => root.render(<GuideMindMap bookId="b" title="书" version={1} busy={false} nodes={[node('newest', 9), node('old', 1)]} collapsed={new Set()} selected={null} query="" onToggle={vi.fn()} onSelect={select} onCommand={vi.fn()} onEdit={vi.fn()} onCreate={vi.fn()} onInspect={vi.fn()} />));
  const button = host.querySelector<HTMLButtonElement>('[aria-label="定位最新生成或更新的节点"]')!;
  expect(button.disabled).toBe(false);act(() => button.click());expect(select).toHaveBeenCalledWith('newest');
  const execute = vi.fn();mocks.action.mock.calls.at(-1)![0]({ execCommand: execute });expect(execute).toHaveBeenCalledWith('GO_TARGET_NODE', 'newest');
  expect(host.textContent).toContain('最新内容在下');act(() => root.unmount());host.remove();vi.unstubAllGlobals();
});
