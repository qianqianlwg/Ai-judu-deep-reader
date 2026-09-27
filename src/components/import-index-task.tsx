"use client";
import { useEffect, useRef } from "react";

type IndexStatus = { chunkCount: number; indexedChunkCount: number; vectorIndexed: boolean; configured?: boolean; error?: string; job?: { state: string; error: string } };
const statusUrl = (editionId: string) => "/api/search/status?engine=local-vector&editionId=" + encodeURIComponent(editionId);
async function readStatus(editionId: string, signal: AbortSignal, request: typeof fetch): Promise<IndexStatus> {
  const response = await request(statusUrl(editionId), { signal });
  const result = await response.json() as IndexStatus;
  if (!response.ok) throw new Error(result.error ?? "读取索引状态失败");
  return result;
}
export async function buildImportedBookIndex(editionId: string, signal: AbortSignal, onProgress: (status: IndexStatus) => void, request: typeof fetch = fetch): Promise<IndexStatus> {
  const initial = await readStatus(editionId, signal, request);
  if (!initial.configured) throw new Error("请先在设置中配置语义搜索服务，再到知识库建立索引。");
  onProgress(initial);
  if (initial.chunkCount === 0 || initial.vectorIndexed || initial.job?.state === "running" || initial.job?.state === "pausing") return initial;
  signal.throwIfAborted();
  // WHY：导入时的明确授权只发起一次服务端任务；离开页面不会取消已授权的索引，也不会逐批重复 POST。
  const response = await request("/api/search/index", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editionId, consent: true }) });
  const result = await response.json() as IndexStatus;
  if (!response.ok) throw new Error(result.error ?? "索引启动失败，可在知识库继续建立");
  onProgress(result);
  return result;
}
export function ImportIndexTask({ editionId, onClose, onReady, onError }: { editionId: string; title: string; onClose: () => void; onReady: () => void; onError: (message: string) => void }) {
  const callbacks = useRef({ onClose, onReady, onError });
  useEffect(() => { callbacks.current = { onClose, onReady, onError }; }, [onClose, onReady, onError]);
  useEffect(() => {
    const controller = new AbortController(); let disposed = false, polling = false, finished = false;
    const complete = (result: IndexStatus) => {
      if (disposed || finished) return;
      if (result.vectorIndexed || result.chunkCount === 0) {
        finished = true; callbacks.current.onReady(); callbacks.current.onClose();
      } else if (["failed", "interrupted"].includes(result.job?.state ?? "")) {
        finished = true; callbacks.current.onError(result.job?.error || "索引任务中断，可在书籍的语义搜索区域继续准备。"); callbacks.current.onClose();
      } else if (result.job?.state === "paused") {
        finished = true; callbacks.current.onClose();
      }
    };
    void buildImportedBookIndex(editionId, controller.signal, complete).catch((cause: unknown) => {
      if (disposed || controller.signal.aborted) return;
      console.error("导入后建立索引失败", cause);
      finished = true; callbacks.current.onError(cause instanceof Error ? cause.message : "索引启动失败，请在书籍的语义搜索区域重试。"); callbacks.current.onClose();
    });
    const timer = window.setInterval(() => {
      if (disposed || finished || polling) return; polling = true;
      void readStatus(editionId, controller.signal, fetch).then(complete).catch((cause: unknown) => {
        if (!disposed && !controller.signal.aborted) {
          console.error("读取导入索引进度失败", cause);
          callbacks.current.onError("读取进度失败；任务仍可能在后台运行，请在书籍的语义搜索区域查看。");
          finished = true; callbacks.current.onClose();
        }
      }).finally(() => { polling = false; });
    }, 2000);
    return () => { disposed = true; controller.abort(); window.clearInterval(timer); };
  }, [editionId]);
  // WHY：此组件只发起已授权的服务端任务并观察完成；进度/暂停统一留在书籍内，不再用浮框遮挡阅读和聊天。
  return null;
}
