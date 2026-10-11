// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { GuideInspector } from "./guide-inspector";
let root: Root, host: HTMLDivElement;
const node = {
  id: "a",
  parentId: null,
  title: "实践",
  summary: "认识的来源",
  sourceIds: ["m"],
};
const source = {
  id: "m",
  bookId: "b",
  editionId: "e",
  threadId: "t",
  messageId: "m",
  chapterId: "c",
  chapterTitle: "第一章",
  createdAt: "2026-09-30",
  anchor: {
    paragraphId: "p",
    startOffset: 0,
    endOffset: 6,
    selectedText: "认识来自实践",
  },
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ sources: [source] }))),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("原文依据带精确锚点，句读和原文入口分别导航", async () => {
  const open = vi.fn();
  await act(async () => {
    root.render(
      <GuideInspector
        bookId="b"
        node={node}
        nodes={[node]}
        version={1}
        busy={false}
        onCommand={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onOpenSource={open}
      />,
    );
  });
  expect(host.textContent).toContain("认识来自实践");
  expect(host.querySelector<HTMLDetailsElement>("details")?.open).toBe(false);
  expect(host.querySelector('[aria-label="主题全书位置"]')).not.toBeNull();
  const buttons = [...host.querySelectorAll("button")];
  act(() =>
    buttons.find((b) => b.textContent?.startsWith("打开原文"))!.click(),
  );
  expect(open).toHaveBeenLastCalledWith(source, false);
  act(() =>
    buttons.find((b) => b.textContent?.startsWith("打开句读"))!.click(),
  );
  expect(open).toHaveBeenLastCalledWith(source, true);
});
it("编辑入口直接进入节点表单", async () => {
  await act(async () =>
    root.render(
      <GuideInspector
        bookId="b"
        node={node}
        nodes={[node]}
        version={1}
        busy={false}
        onCommand={vi.fn()}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onOpenSource={vi.fn()}
      />,
    ),
  );
  act(() =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "编辑内容")!
      .click(),
  );
  expect(host.querySelector("textarea")?.value).toBe("认识的来源");
});

it("所有原文依据默认收起，主题详情展示真实全书位置", async () => {
  const second = { ...source, id: "m2" };
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ sources: [source, second] })));
  const selectedNode = { ...node, sourceIds: ["m", "m2"] };
  await act(async () => root.render(<GuideInspector bookId="b" node={selectedNode} nodes={[selectedNode]} version={1} busy={false} onCommand={vi.fn()} onClose={vi.fn()} onCreate={vi.fn()} onOpenSource={vi.fn()} locationState={{ loading: false, error: "", retry: vi.fn(), locations: { bookId: "b", version: 1, issues: [], sources: [{ sourceId: "m", editionId: "e", editionLabel: "书", spans: [{ paragraphId: "p", chapterId: "c", chapterTitle: "第一章", start: .25, end: .3 }] }] } }} />));
  expect([...host.querySelectorAll("details")].map(detail => detail.open)).toEqual([false, false]);
  expect(host.querySelector('[aria-label="主题全书位置"]')?.textContent).toContain("25%–30%");
  act(() => host.querySelector("summary")!.click());
  expect(host.querySelector<HTMLDetailsElement>("details")?.open).toBe(true);
});
