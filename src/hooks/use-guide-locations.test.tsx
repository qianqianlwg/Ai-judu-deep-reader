// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useGuideLocations } from "./use-guide-locations";
let host: HTMLDivElement, root: Root, current: ReturnType<typeof useGuideLocations>;
let bookId: string | null = "b", version: number | null = 1;
function Harness() { const value = useGuideLocations(bookId, version); useEffect(() => { current = value; }); return null; }
const payload = { bookId: "b", version: 1, sources: [], issues: [] };
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); bookId = "b"; version = 1; host = document.createElement("div"); root = createRoot(host); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)))); });
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const render = async () => { await act(async () => root.render(<Harness />)); };
it("按书籍与导图版本读取位置，不因无关重渲染重复请求", async () => {
  await render(); expect(current.locations).toEqual(payload); await render(); expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith("/api/books/b/guide/locations", expect.objectContaining({ cache: "no-store" }));
});
it("切换版本立即隐藏旧位置，无书籍或版本时不读取", async () => {
  await render(); version = null; await render(); expect(current.locations).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
  bookId = null; await render(); expect(current.loading).toBe(false);
});
it("来源格式错误或跨书响应给出错误，重试成功后恢复", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ...payload, bookId: "other" }))).mockResolvedValueOnce(new Response(JSON.stringify(payload)));
  await render(); expect(current.error).toContain("其他书籍"); expect(current.locations).toBeNull();
  await act(async () => current.retry()); expect(current.error).toBe(""); expect(current.locations).toEqual(payload);
});
it("延迟返回旧书籍不能覆盖新的书籍位置", async () => {
  let resolveOld: ((response: Response) => void) | undefined;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(new Response(JSON.stringify({ ...payload, bookId: "new" })));
  await render(); bookId = "new"; await render();
  await act(async () => resolveOld?.(new Response(JSON.stringify(payload))));
  expect(current.locations?.bookId).toBe("new");
});
