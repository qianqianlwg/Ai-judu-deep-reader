// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { buildImportedBookIndex, ImportIndexTask } from "./import-index-task";
const state = (indexedChunkCount: number, vectorIndexed = false, job = "idle") => ({ configured: true, chunkCount: 2, indexedChunkCount, vectorIndexed, job: { state: job, error: "" } });
it("明确授权的导入任务只发起一次后台索引，不在客户端逐批调用", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(state(0))).mockResolvedValueOnce(Response.json(state(0, false, "running")));
  const progress = vi.fn(); const result = await buildImportedBookIndex("edition 1", new AbortController().signal, progress, request);
  expect(result.job?.state).toBe("running"); expect(progress).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0][0]).toContain("edition%201");
  expect(JSON.parse(request.mock.calls[1][1]?.body as string)).toEqual({ editionId: "edition 1", consent: true });
  expect(request.mock.calls[1][1]?.signal).toBeUndefined();
});
it("已在后台运行时不再次 POST；未配置不启动", async () => {
  const active = vi.fn<typeof fetch>().mockResolvedValue(Response.json(state(1, false, "running")));
  await buildImportedBookIndex("e", new AbortController().signal, vi.fn(), active);
  expect(active).toHaveBeenCalledOnce();
  const noConfig = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...state(0), configured: false }));
  await expect(buildImportedBookIndex("e", new AbortController().signal, vi.fn(), noConfig)).rejects.toThrow("配置");
  expect(noConfig).toHaveBeenCalledOnce();
});
it("关闭导入提示仅取消进度轮询，不发暂停请求", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(state(0))).mockResolvedValueOnce(Response.json(state(0, false, "running")));
  vi.stubGlobal("fetch", request);
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  await act(async () => root.render(<ImportIndexTask editionId="e" title="测试书" onReady={vi.fn()} onClose={vi.fn()} onError={vi.fn()}/>));
  expect(host.childElementCount).toBe(0); expect(host.querySelector("aside,progress,button")).toBeNull();
  await act(async () => root.unmount());
  expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  expect(request.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  host.remove(); vi.unstubAllGlobals();
});

it("后台完成后通知刷新和清理状态，全程不渲染进度浮框", async()=>{
 vi.useFakeTimers();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 const request=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(state(0,false,"running"))).mockResolvedValueOnce(Response.json(state(2,true,"completed")));
 vi.stubGlobal("fetch",request);const host=document.createElement("div"),root=createRoot(host);document.body.append(host);
 const ready=vi.fn(),close=vi.fn(),error=vi.fn();
 try{
  await act(async()=>root.render(<ImportIndexTask editionId="e" title="测试书" onReady={ready} onClose={close} onError={error}/>));
  expect(host.childNodes).toHaveLength(0);expect(ready).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
  await act(async()=>vi.advanceTimersByTimeAsync(2000));
  expect(ready).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();expect(error).not.toHaveBeenCalled();
  await act(async()=>vi.advanceTimersByTimeAsync(4000));expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls.every(([,init])=>!init?.method)).toBe(true);
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.useRealTimers();}
});
it("无浮框时启动失败仍有明确反馈，不静默吞掉异常", async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.spyOn(console,"error").mockImplementation(()=>{});
 vi.stubGlobal("fetch",vi.fn<typeof fetch>().mockResolvedValue(Response.json({...state(0),configured:false})));
 const host=document.createElement("div"),root=createRoot(host);document.body.append(host);const error=vi.fn(),close=vi.fn();
 try{
  await act(async()=>root.render(<ImportIndexTask editionId="e" title="测试书" onReady={vi.fn()} onClose={close} onError={error}/>));
  expect(error).toHaveBeenCalledWith(expect.stringContaining("配置"));expect(close).toHaveBeenCalledOnce();expect(host.childNodes).toHaveLength(0);
 }finally{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});
