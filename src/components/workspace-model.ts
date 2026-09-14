"use client";

import { useEffect, useState } from "react";

type ModelState = { modelName?: string; error?: string };
export function useWorkspaceModel(fetcher: typeof fetch = fetch): ModelState {
  const [state, setState] = useState<ModelState>({});
  useEffect(() => {
    let disposed = false;
    let current: AbortController | undefined;
    const refresh = () => {
      current?.abort();
      const controller = new AbortController(); current = controller;
      // WHY：只读取服务端脱敏设置中的模型名称，不缓存配置对象、密钥或网关响应体。
      void fetcher("/api/settings/ai", { cache: "no-store", signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error("模型配置读取失败（HTTP " + response.status + "）");
        const data: unknown = await response.json();
        if (!data || typeof data !== "object" || !("model" in data) || typeof data.model !== "string" || !data.model.trim()) throw new Error("模型配置缺少有效名称");
        if (!disposed && !controller.signal.aborted) setState({ modelName: data.model.trim() });
      }).catch((cause: unknown) => {
        if (disposed || controller.signal.aborted) return;
        console.error("读取模型名称失败", cause instanceof Error ? cause.name : "UnknownError");
        setState({ error: "模型信息暂不可用，请重新打开设置检查。" });
      });
    };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === "judu:ai-settings") refresh(); };
    refresh();
    // WHY：设置可在另一标签中修改，返回窗口或收到明确的配置更新事件时重新读取，不用定时轮询。
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", visible);
    window.addEventListener("storage", storage); window.addEventListener("judu:settings-updated", refresh);
    return () => {
      disposed = true; current?.abort();
      window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("storage", storage); window.removeEventListener("judu:settings-updated", refresh);
    };
  }, [fetcher]);
  return state;
}
