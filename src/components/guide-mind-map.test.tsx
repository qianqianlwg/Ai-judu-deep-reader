// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ action: vi.fn(), retry: vi.fn() }));
vi.mock("@/hooks/use-guide-map-engine", () => ({ useGuideMapEngine: () => ({ ...mocks, ready: true, error: "", zoom: 1, revision: 1, element: { current: null }, engine: { current: null } }) }));
import { GuideMindMap } from "./guide-mind-map";
it("默认呈现真实画板与视角工具，节点详情不抢双击编辑", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); const host = document.createElement("div"), root = createRoot(host), inspect = vi.fn();
  await act(async () => root.render(<GuideMindMap bookId="b" title="书" version={1} busy={false} nodes={[{ id: "a", parentId: null, title: "理解", summary: "已读原文", sourceIds: [] }]} collapsed={new Set()} selected="a" query="理解" onToggle={vi.fn()} onSelect={vi.fn()} onCommand={vi.fn()} onEdit={vi.fn()} onCreate={vi.fn()} onInspect={inspect} />));
  expect(host.querySelector('[aria-label="思维导图交互画板"]')).not.toBeNull();
  expect(host.textContent).toContain("1 / 1 个匹配");
  act(() => [...host.querySelectorAll("button")].find(button => button.textContent === "节点详情")!.click()); expect(inspect).toHaveBeenCalledTimes(1);
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="放大画板"]')!.click()); expect(mocks.action).toHaveBeenCalled();
  act(() => root.unmount()); vi.unstubAllGlobals();
});
