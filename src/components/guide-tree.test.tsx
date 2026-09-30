// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { GuideTree } from "./guide-tree";
let root: Root, host: HTMLDivElement;
const nodes = [
  {
    id: "a",
    parentId: null,
    title: "实践",
    summary: "理解的起点",
    sourceIds: ["m"],
  },
  { id: "b", parentId: "a", title: "检验", summary: "回到经验", sourceIds: [] },
];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("树可展开、选择，键盘按层级导航", async () => {
  const onSelect = vi.fn(),
    onToggle = vi.fn();
  await act(async () =>
    root.render(
      <GuideTree
        nodes={nodes}
        selected="a"
        expanded={new Set(["a"])}
        query=""
        onSelect={onSelect}
        onToggle={onToggle}
      />,
    ),
  );
  const rows = host.querySelectorAll<HTMLElement>('[role="treeitem"]');
  expect(rows).toHaveLength(2);
  expect(rows[1].getAttribute("aria-level")).toBe("2");
  act(() =>
    rows[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  expect(onSelect).toHaveBeenCalledWith("b");
  expect(document.activeElement).toBe(rows[1]);
  act(() =>
    host
      .querySelector<HTMLButtonElement>('button[aria-label="收起实践"]')!
      .click(),
  );
  expect(onToggle).toHaveBeenCalledWith("a");
});
it("搜索子主题保留父主题并显示无匹配反馈", async () => {
  await act(async () =>
    root.render(
      <GuideTree
        nodes={nodes}
        selected={null}
        expanded={new Set()}
        query="检验"
        onSelect={() => {}}
        onToggle={() => {}}
      />,
    ),
  );
  expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(2);
  await act(async () =>
    root.render(
      <GuideTree
        nodes={nodes}
        selected={null}
        expanded={new Set()}
        query="无匹配"
        onSelect={() => {}}
        onToggle={() => {}}
      />,
    ),
  );
  expect(host.textContent).toContain("没有找到");
});
