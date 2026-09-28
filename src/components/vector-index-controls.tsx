"use client";
import { useEffect, useRef, useState } from "react";

type Job = { state: "idle" | "running" | "pausing" | "paused" | "completed" | "failed" | "interrupted"; error: string };
type Status = { paragraphCount: number; indexedCount: number; chunkCount: number; indexedChunkCount: number; vectorIndexed: boolean; configured?: boolean; note: string; job?: Job };

export function VectorIndexControls({ editionId, onReady }: { editionId?: string; onReady: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [consent, setConsent] = useState(false);
  const current = useRef<Status | null>(null), ready = useRef(""), callback = useRef(onReady), generation = useRef(0);
  useEffect(() => { callback.current = onReady; });
  useEffect(() => {
    const controller = new AbortController();
    const version = ++generation.current;
    current.current = null; ready.current = "";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(null); setConsent(false); setNotice("");
    // WHY：切换书籍只取消状态轮询，不取消已经获得用户授权的服务端索引任务。
    const refresh = async () => {
      if (!editionId) return;
      try {
        const response = await fetch("/api/search/status?engine=local-vector&editionId=" + encodeURIComponent(editionId), { signal: controller.signal });
        if (!response.ok) throw new Error("读取向量索引状态失败");
        const next = await response.json() as Status;
        if (controller.signal.aborted || version !== generation.current) return;
        current.current = next;
        setStatus(next);
        if (next.vectorIndexed && ready.current !== editionId) { ready.current = editionId; callback.current(); }
      } catch (cause: unknown) {
        if (!controller.signal.aborted) { console.error("读取索引状态失败", cause); setNotice("读取索引状态失败，请重新打开本书"); }
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (current.current?.job?.state === "running" || current.current?.job?.state === "pausing") void refresh();
    }, 2000);
    return () => { generation.current = version + 1; controller.abort(); window.clearInterval(timer); };
  }, [editionId]);
  const running = status?.job?.state === "running" || status?.job?.state === "pausing";
  async function build() {
    if (!editionId || !consent || busy || running) return;
    const version = generation.current;
    setBusy(true); setNotice("正在启动后台索引…");
    try {
      const response = await fetch("/api/search/index", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editionId, consent: true }) });
      const data = await response.json() as Status & { error?: string };
      if (!response.ok) throw new Error(data.error || "索引任务启动失败");
      if (version !== generation.current) return;
      current.current = data; setStatus(data); setNotice("已在后台准备；切换页面不会中断，保持本机服务运行即可。");
    } catch (cause: unknown) { console.error("启动索引失败", cause); if (version === generation.current) setNotice(cause instanceof Error ? cause.message : "索引任务启动失败"); }
    finally { if (version === generation.current) setBusy(false); }
  }
  async function pause() {
    if (!editionId || !running || status?.job?.state === "pausing") return;
    const version = generation.current;
    setBusy(true);
    try {
      const response = await fetch("/api/search/index", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editionId }) });
      const data = await response.json() as Status & { error?: string };
      if (!response.ok) throw new Error(data.error || "暂停失败");
      if (version !== generation.current) return;
      current.current = data; setStatus(data); setNotice("将在当前批次完成后暂停；已完成的内容会保留。");
    } catch (cause: unknown) { console.error("暂停索引失败", cause); if (version === generation.current) setNotice(cause instanceof Error ? cause.message : "暂停失败，请重试"); }
    finally { if (version === generation.current) setBusy(false); }
  }
  return <section className="vector-index-controls" aria-label="语义搜索准备">
    <h4>语义搜索</h4>
    <p>{status?.vectorIndexed ? "已准备好，可按含义查找原文。" : running ? "正在后台准备本书内容…" : "按含义查找相关内容，需要先准备本书。"}</p>
    {status && (running || status.indexedChunkCount > 0) && !status.vectorIndexed && <><progress aria-label="向量索引进度" max={Math.max(1, status.chunkCount)} value={status.indexedChunkCount}/><p>{status.indexedChunkCount} / {status.chunkCount} 组内容已完成</p></>}
    {!status?.vectorIndexed && <><label><input type="checkbox" checked={consent} disabled={running || busy} onChange={event => setConsent(event.target.checked)}/>同意将本书文字发送至 SiliconFlow，准备语义搜索（可能产生费用）</label>
      <button type="button" disabled={running || busy || !editionId || !consent || !status?.configured || status.chunkCount === 0} onClick={() => void build()}>{running ? "正在准备…" : status?.indexedChunkCount ? "继续准备" : "启用语义搜索"}</button></>}
    {running && <button type="button" disabled={busy || status?.job?.state === "pausing"} onClick={() => void pause()}>{status?.job?.state === "pausing" ? "当前批次完成后暂停" : "暂停准备"}</button>}
    {status && !status.configured && <a href="/settings">配置语义搜索服务 ↗</a>}
    {(notice || status?.job?.error) && <p role="status">{status?.job?.error || notice}</p>}
  </section>;
}
