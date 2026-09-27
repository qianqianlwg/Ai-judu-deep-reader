// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { VectorIndexControls } from "./vector-index-controls";
const base = { configured: true, chunkCount: 10, indexedChunkCount: 0, vectorIndexed: false, note: "" };
it("用户确认一次启动服务端任务，卸载与重进页面不取消或重复收费", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ ...base, job: { state: "idle", error: "" } }))
    .mockResolvedValueOnce(Response.json({ ...base, job: { state: "running", error: "" } }))
    .mockResolvedValueOnce(Response.json({ ...base, indexedChunkCount: 4, job: { state: "running", error: "" } }));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); document.body.append(host);
  let root = createRoot(host); const ready = vi.fn();
  try {
    await act(async () => root.render(<VectorIndexControls editionId="e" onReady={ready}/>));
    expect(host.querySelector("button")?.hasAttribute("disabled")).toBe(true);
    await act(async () => host.querySelector("input")!.click());
    await act(async () => host.querySelector("button")!.click());
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ editionId: "e", consent: true });
    expect(host.textContent).toContain("后台准备");
    await act(async () => root.unmount());
    expect(fetcher.mock.calls[1][1]?.signal).toBeUndefined();
    root = createRoot(host);
    await act(async () => root.render(<VectorIndexControls editionId="e" onReady={ready}/>));
    expect(host.textContent).toContain("4 / 10");
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
    expect(ready).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
it("再次打开已完成的书籍时立即报告就绪，无须重新同意", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...base, indexedChunkCount: 10, vectorIndexed: true, job: { state: "completed", error: "" } }));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host), ready = vi.fn();
  try { await act(async () => root.render(<VectorIndexControls editionId="e" onReady={ready}/>)); expect(ready).toHaveBeenCalledOnce(); expect(host.textContent).toContain("已准备好"); }
  finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
