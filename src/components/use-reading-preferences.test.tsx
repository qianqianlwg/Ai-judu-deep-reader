// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useReadingPreferences } from "./use-reading-preferences";

it("切书恢复偏好，中途调整并重新挂载仍记住", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear();
  const host = document.createElement("div"), root = createRoot(host), error = vi.fn();
  function View({ bookId }: { bookId: string }) {
    const { preferences, changePreferences } = useReadingPreferences(bookId, error);
    return <button onClick={() => changePreferences({ difficulty: "accessible", detail: "gist" })}>{preferences.difficulty}:{preferences.detail}</button>;
  }
  try {
    await act(async () => root.render(<View bookId="a" />)); expect(host.textContent).toBe("normal:standard");
    await act(async () => host.querySelector("button")!.click()); expect(host.textContent).toBe("accessible:gist");
    await act(async () => root.render(<View bookId="b" />)); expect(host.textContent).toBe("normal:standard");
    await act(async () => root.render(<View key="reload" bookId="a" />)); expect(host.textContent).toBe("accessible:gist");
    expect(error).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});
it("存储失败有反馈且不伪装保存成功", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear();
  const host = document.createElement("div"), root = createRoot(host), error = vi.fn();
  function View() {
    const { preferences, changePreferences } = useReadingPreferences("a", error);
    return <button onClick={() => changePreferences({ difficulty: "advanced", detail: "expanded" })}>{preferences.detail}</button>;
  }
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await act(async () => root.render(<View />));
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("不可写"); });
    await act(async () => host.querySelector("button")!.click());
    expect(error).toHaveBeenCalledWith(expect.stringContaining("未能保存")); expect(host.textContent).toBe("standard");
    storage.mockRestore();
  } finally { log.mockRestore(); await act(async () => root.unmount()); }
});
