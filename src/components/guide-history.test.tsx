// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { GuideHistory } from "./guide-history";
it("恢复快照需要确认，成功后仍然留在历史中", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"), root = createRoot(host), command = vi.fn().mockResolvedValue(true), notice = vi.fn();
  await act(async () => root.render(<GuideHistory revisions={[{ id: 1, actor: "ai", reason: "整理已读选文", createdAt: "2026-09-30T00:00:00Z", current: false }]} busy={false} command={command} onClose={vi.fn()} setNotice={notice} />));
  act(() => [...host.querySelectorAll("button")].find(button => button.textContent === "恢复此版本")!.click());
  expect(command).not.toHaveBeenCalled();
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "确认恢复")!.click());
  expect(command).toHaveBeenCalledWith({ action: "restore", revisionId: 1 }); expect(notice).toHaveBeenCalledWith("已恢复历史版本");
  act(() => root.unmount()); vi.unstubAllGlobals();
});
