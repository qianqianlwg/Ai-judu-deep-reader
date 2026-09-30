// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { GuideNodeEditor, GuideStructureEditor } from "./guide-node-editor";
let root: Root, host: HTMLDivElement;
const node = {
  id: "a",
  parentId: null,
  title: "实践",
  summary: "理解的起点",
  sourceIds: ["m"],
};
const next = { ...node, id: "b", title: "经验" };
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
const props = () => ({
  node,
  nodes: [node, next],
  version: 1,
  busy: false,
  onCommand: vi.fn().mockResolvedValue(true),
  onClose: vi.fn(),
});
it("单节点编辑只提交标题内容，并允许以后被AI改写", async () => {
  const p = props();
  await act(async () => root.render(<GuideNodeEditor {...p} />));
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "实践与认识");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(p.onCommand).toHaveBeenCalledWith(
    {
      action: "change",
      change: {
        type: "edit",
        id: "a",
        title: "实践与认识",
        summary: "理解的起点",
      },
    },
    1,
  );
  expect(p.onClose).toHaveBeenCalled();
  expect(host.textContent).toContain("AI 会继续维护");
});
it("并发更新保留草稿，需要核对最新版本", async () => {
  const p = props();
  await act(async () => root.render(<GuideNodeEditor {...p} />));
  await act(async () => root.render(<GuideNodeEditor {...p} version={2} />));
  expect(host.textContent).toContain("草稿已保留");
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(p.onCommand).not.toHaveBeenCalled();
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(p.onCommand).toHaveBeenCalledWith(expect.anything(), 2);
});
it("结构调整提供明确父级和顺序，不依赖拖拽", async () => {
  const p = props();
  await act(async () => root.render(<GuideStructureEditor {...p} />));
  const select = host.querySelector("select")!;
  await act(async () => {
    select.value = "b";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const button = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "保存位置",
  )!;
  await act(async () => button.click());
  expect(p.onCommand).toHaveBeenCalledWith(
    {
      action: "change",
      change: { type: "move", id: "a", parentId: "b", beforeId: null },
    },
    1,
  );
});
