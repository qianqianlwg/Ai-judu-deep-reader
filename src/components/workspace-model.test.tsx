// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceModel } from "./workspace-model";
let root: Root; let host: HTMLDivElement;
const fetcher = vi.fn<typeof fetch>();
function View() { const state = useWorkspaceModel(fetcher); return <output>{state.error ?? state.modelName ?? "读取中"}</output>; }
async function mount() { await act(async () => root.render(<View />)); }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); fetcher.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("useWorkspaceModel", () => {
  it("只展示模型名，安全GET不暴露配置或密钥", async () => {
    fetcher.mockResolvedValue(Response.json({ model: "example-model", maskedApiKey: "masked-not-for-ui", hasApiKey: true }));
    await mount(); expect(host.textContent).toBe("example-model"); expect(host.textContent).not.toContain("masked-not-for-ui");
    expect(fetcher).toHaveBeenCalledWith("/api/settings/ai", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  });
  it("返回标签及配置更新后刷新模型名，不使用旧缓存", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ model: "first" })).mockResolvedValueOnce(Response.json({ model: "changed" })).mockResolvedValueOnce(Response.json({ model: "again" }));
    await mount();
    await act(async () => window.dispatchEvent(new Event("focus"))); expect(host.textContent).toBe("changed");
    await act(async () => window.dispatchEvent(new Event("judu:settings-updated"))); expect(host.textContent).toBe("again");
  });
  it("过时读取被取消，不能覆盖更新后的模型名称", async () => {
    let resolve: ((response: Response) => void) | undefined;
    fetcher.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValueOnce(Response.json({ model: "latest" }));
    await mount(); const firstSignal = fetcher.mock.calls[0][1]?.signal;
    await act(async () => window.dispatchEvent(new Event("focus"))); expect(firstSignal?.aborted).toBe(true);
    await act(async () => resolve?.(Response.json({ model: "stale" }))); expect(host.textContent).toBe("latest");
  });
  it("无效响应明确显示错误但不输出网关/配置内容", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fetcher.mockResolvedValue(Response.json({ error: "private-error-details" }, { status: 500 }));
    await mount(); expect(host.textContent).toContain("模型信息暂不可用"); expect(host.textContent).not.toContain("private-error-details");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-error-details");
  });
});
