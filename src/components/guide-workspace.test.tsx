// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { GuideState } from "@/lib/guide";
const mocks = vi.hoisted(() => ({
  state: null as GuideState | null,
  command: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/hooks/use-book-guide", () => ({
  useBookGuide: () => ({ ...mocks, error: "", busy: false }),
}));
vi.mock("./guide-mind-map", () => ({ GuideMindMap: () => <div aria-label="思维导图交互画板" /> }));
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
