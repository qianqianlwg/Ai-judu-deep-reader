"use client";
import { useEffect, useState } from "react";
import { emptyExternalPermissions, externalSources, type ExternalPermissions, type ExternalSource } from "@/lib/agent/external-permissions";
import styles from "./external-permissions.module.css";
const labels: Record<ExternalSource, { title: string; detail: string }> = {
  openalex: { title: "OpenAlex", detail: "发现学术文献 · 免 Key 基础查询" },
  crossref: { title: "Crossref", detail: "核验 DOI · 出版信息" },
  web: { title: "网页搜索", detail: "Tavily · 网页片段" },
};
export function ExternalPermissionsMenu({ permissions, onChange, disabled }: { permissions: ExternalPermissions; onChange: (value: ExternalPermissions) => void; disabled: boolean }) {
  const [available, setAvailable] = useState<ExternalPermissions>(emptyExternalPermissions);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/external-sources", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("status_failed");
      const value: unknown = await response.json();
      if (typeof value !== "object" || value === null || !("available" in value)) throw new Error("invalid_status");
      const state = value.available;
      if (typeof state !== "object" || state === null || !externalSources.every(source => typeof (state as Record<string, unknown>)[source] === "boolean")) throw new Error("invalid_status");
      setAvailable(state as ExternalPermissions);
    }).catch(cause => { if (!controller.signal.aborted) { console.warn("外部来源状态读取失败", cause); setError("无法确认来源配置，请稍后重试"); } });
    return () => controller.abort();
  }, []);
  return <section className={styles.section} aria-label="外部资料授权">
    <div className={styles.heading}>已接通插件 · 外部资料 <span>默认开启 · 长期保存</span></div>
    {externalSources.map(source => <label className={styles.option} key={source}>
      <input type="checkbox" checked={permissions[source] && available[source]} disabled={disabled || !available[source]} onChange={event => onChange({ ...permissions, [source]: event.target.checked })} />
      <span>{labels[source].title}<small>{available[source] ? labels[source].detail : "服务端未配置"}</small></span>
    </label>)}
    <details className={styles.disclosure}><summary>权限与数据说明</summary><p className={styles.note}>可用来源默认开启，修改后自动保存；生成中的本轮授权不变。Agent 按需发送简短检索词，不外发整段选文。OpenAlex 可按需读取其开放获取解析正文；允许网页搜索时，也允许 Tavily 按需提取已检索的公开页面及 OA 链接。检索记录与链接可在回复上方展开；书目/片段不等于全文。</p></details>
    {error && <p role="status" className={styles.error}>{error}</p>}
  </section>;
}
