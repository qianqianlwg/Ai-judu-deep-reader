// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useBookGuide } from "./use-book-guide";
let root: Root, host: HTMLDivElement, latest: ReturnType<typeof useBookGuide>;
const state = { bookId: "b", title: "实践", nodes: [], version: 0, revisions: [], canUndo: false, canRedo: false, pending: 0, failed: 0, processed: 0, lastError: null, updatedAt: null, historicalCount: 0 };
function Harness({ bookId = "b" }: { bookId?: string }) { const value = useBookGuide(bookId); useEffect(() => { latest = value; }); return null; }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); }); afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("读取并校验书籍身份，修改使用当前版本", async () => { const fetcher = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === "POST" ? { ...state, version: 1 } : state))); vi.stubGlobal("fetch", fetcher); await act(async () => root.render(<Harness />)); expect(latest.state?.bookId).toBe("b"); await act(async () => { expect(await latest.command({ action: "retry" })).toBe(true); }); expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ action: "retry", version: 0 }); expect(latest.state?.version).toBe(1); });
it("并发冲突显示错误并刷新，不假报保存成功", async () => { vi.spyOn(console, "error").mockImplementation(() => {}); const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(state))).mockResolvedValueOnce(new Response(JSON.stringify({ error: "导读已更新" }), { status: 409 })).mockResolvedValueOnce(new Response(JSON.stringify({ ...state, version: 2 }))); vi.stubGlobal("fetch", fetcher); await act(async () => root.render(<Harness />)); await act(async () => { expect(await latest.command({ action: "undo" })).toBe(false); }); expect(latest.error).toBe("导读已更新"); expect(latest.state?.version).toBe(2); });
