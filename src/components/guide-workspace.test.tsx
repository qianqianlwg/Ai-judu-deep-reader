// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { GuideState } from "@/lib/guide";
import type { GuideMindMapProps } from "./guide-mind-map";
const mocks = vi.hoisted(() => ({
  state: null as GuideState | null,
  command: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/hooks/use-book-guide", () => ({
  useBookGuide: () => ({ ...mocks, error: "", busy: false }),
}));
// WHY：工作区交互单测隔离新的只读位置请求；真实位置加载由 hook 与接口测试覆盖。
vi.mock("@/hooks/use-guide-locations", () => ({
  useGuideLocations: () => ({ locations: null, loading: false, error: "", retry: vi.fn() }),
}));
vi.mock("./guide-mind-map", () => ({
  GuideMindMap: ({ onSelect, onEdit }: GuideMindMapProps) => (
    <div aria-label="思维导图交互画板">
      <button onClick={() => onSelect("a")}>选择主题甲</button>
      <button onClick={() => onSelect("b")}>选择主题乙</button>
      <button onClick={() => onSelect(null)}>点击画板空白</button>
      <button onClick={() => onEdit("a")}>双击主题甲</button>
    </div>
  ),
}));
import { GuideWorkspace } from "./guide-workspace";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  mocks.command.mockReset().mockResolvedValue(true);
  mocks.state = {
    bookId: "b",
    title: "实践",
    nodes: [],
    version: 0,
    revisions: [],
    canUndo: false,
    canRedo: false,
    pending: 0,
    failed: 0,
    processed: 0,
    lastError: null,
    updatedAt: null,
    historicalCount: 0,
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = async () =>
  act(async () =>
    root.render(
      <GuideWorkspace
        bookId="b"
        bookTitle="实践"
        onReturnReading={vi.fn()}
        onOpenSource={vi.fn()}
      />,
    ),
  );
it("空导读引导句读，不提供补全整书", async () => {
  await render();
  expect(host.textContent).toContain("让理解，随着阅读生长");
  expect(host.textContent).not.toContain("生成全书");
  expect(
    host.querySelector('[aria-label="撤销导读改动"]')?.hasAttribute("disabled"),
  ).toBe(true);
});
it("AI和用户修改都可撤销重做，并显示历史", async () => {
  mocks.state = {
    ...mocks.state!,
    canUndo: true,
    canRedo: true,
    version: 2,
    revisions: [
      {
        id: 2,
        actor: "ai",
        reason: "重新整理",
        createdAt: "2026-09-30T01:00:00Z",
        current: true,
      },
    ],
  };
  await render();
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="撤销导读改动"]')!
      .click(),
  );
  expect(mocks.command).toHaveBeenCalledWith({ action: "undo" });
  act(() =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent?.endsWith("历史"))!
      .click(),
  );
  expect(host.textContent).toContain("重新整理");
  expect(host.textContent).toContain("AI 整理");
});
it("键盘撤销不接管文本输入，已有句读需确认后入队", async () => {
  mocks.state = { ...mocks.state!, canUndo: true, historicalCount: 2 };
  await render();
  await act(async () =>
    host
      .querySelector("input")!
      .dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          ctrlKey: true,
          bubbles: true,
        }),
      ),
  );
  expect(mocks.command).not.toHaveBeenCalled();
  act(() =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "纳入已有句读")!
      .click(),
  );
  expect(host.textContent).toContain("产生相应调用用量");
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "确认纳入")!
      .click(),
  );
  expect(mocks.command).toHaveBeenCalledWith({ action: "import-history" });
});
it("恢复已折叠的分支不会被初始空状态覆盖", async () => {
  mocks.state = { ...mocks.state!, nodes: [{ id: "a", parentId: null, title: "主题", summary: "", sourceIds: [] }, { id: "b", parentId: "a", title: "分支", summary: "", sourceIds: [] }] };
  localStorage.setItem("judu:guide-view:b", JSON.stringify({ collapsed: ["a"] }));
  await render();
  expect(host.textContent).toContain("展开全部");
  expect(JSON.parse(localStorage.getItem("judu:guide-view:b")!)).toEqual({ collapsed: ["a"] });
});

const seedTopics = () => {
  mocks.state = {
    ...mocks.state!,
    nodes: [
      { id: "a", parentId: null, title: "主题甲", summary: "甲的详细归纳", sourceIds: [] },
      { id: "b", parentId: null, title: "主题乙", summary: "乙的详细归纳", sourceIds: [] },
    ],
  };
};
const click = async (label: string) => act(async () => {
  [...host.querySelectorAll("button")].find(button => button.textContent === label)!.click();
});
it("单击节点默认打开右侧详情，切换节点更新内容，空白取消选中关闭详情", async () => {
  seedTopics();
  await render();
  expect(host.querySelector('[aria-label="主题详情"]')).toBeNull();
  await click("选择主题甲");
  expect(host.querySelector('[aria-label="主题详情"]')?.textContent).toContain("甲的详细归纳");
  expect(host.querySelector('[aria-label="主题详情"]')?.textContent).toContain("原文依据");
  await click("选择主题乙");
  expect(host.querySelector('[aria-label="主题详情"]')?.textContent).toContain("乙的详细归纳");
  expect(host.querySelector('[aria-label="主题详情"]')?.textContent).not.toContain("甲的详细归纳");
  await click("点击画板空白");
  expect(host.querySelector('[aria-label="主题详情"]')).toBeNull();
});
it("关闭详情后再次单击同一节点可重开，双击编辑和单击阅读不冲突", async () => {
  seedTopics();
  await render();
  await click("选择主题甲");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭主题详情"]')!.click());
  expect(host.querySelector('[aria-label="主题详情"]')).toBeNull();
  await click("选择主题甲");
  expect(host.querySelector('[aria-label="主题详情"]')?.textContent).toContain("甲的详细归纳");
  await click("双击主题甲");
  expect(host.querySelector('[aria-label="主题详情"]')?.textContent).toContain("编辑节点");
  expect(host.querySelector('[aria-label="主题详情"] textarea')).not.toBeNull();
  await click("选择主题甲");
  expect(host.querySelector('[aria-label="主题详情"] textarea')).toBeNull();
  expect(host.querySelector('[aria-label="主题详情"]')?.textContent).toContain("甲的详细归纳");
});

it("颜色对照嵌入顶部工具栏中间，提纲模式不显示独立颜色卡片", async () => {
  await act(async () => root.render(<GuideWorkspace bookId="b" bookTitle="实践" onReturnReading={vi.fn()} onOpenSource={vi.fn()} />));
  const toolbar = host.querySelector('[aria-label="思维导图工具栏"]')!;
  expect(toolbar.querySelector('[aria-label="全书位置与连线颜色对照"]')).not.toBeNull();
  const children = [...toolbar.children];
  expect(children.findIndex(child => child.tagName === "LABEL")).toBeLessThan(children.findIndex(child => child.tagName === "SECTION"));
  act(() => [...host.querySelectorAll("button")].find(button => button.textContent === "提纲")!.click());
  expect(toolbar.querySelector('[aria-label="全书位置与连线颜色对照"]')).toBeNull();
});
