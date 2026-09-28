"use client";
import { isRecord, type ChatMessage, type ToolActivity } from "@/lib/chat-stream";
import styles from "./external-research-activity.module.css";
const names = new Set(["search_openalex", "verify_crossref", "search_web", "read_external_source"]);
const labels: Record<string, string> = { search_openalex: "OpenAlex 文献发现", verify_crossref: "Crossref 元数据核验", search_web: "Tavily 网页搜索" };
function safeLink(value: unknown): string | undefined { if (typeof value !== "string") return; try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined; } catch { return; } }
function SearchDetails({ tool, interrupted }: { tool: ToolActivity; interrupted: boolean }) {
  const data = isRecord(tool.result) ? tool.result : undefined;
  const entries = Array.isArray(data?.results) ? data.results.slice(0, 5) : [];
  return <section className={styles.channel} data-source={tool.name}>
    <h4>{labels[tool.name]} <small>{tool.status === "running" ? interrupted ? "已中断" : "进行中" : tool.status === "error" ? "未成功" : "已完成"}</small></h4>
    {typeof data?.query === "string" && data.query && <p className={styles.meta}>检索词：{data.query}{data.matchType === "exact_doi" ? " · DOI 精确查询" : data.matchType === "candidates" ? " · 候选书目，需自行核对" : ""}</p>}
    {entries.length ? <ol className={styles.results}>{entries.map((item, index) => {
      if (!isRecord(item) || typeof item.title !== "string") return null;
      const url = safeLink(item.url);
      return <li key={index}><strong>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{item.title} ↗</a> : item.title}</strong>
        <span>{typeof item.year === "number" ? item.year + " · " : ""}{typeof item.doi === "string" ? "DOI " + item.doi + " · " : ""}{item.evidence === "snippet" ? "网页标题/片段" : "书目元数据"}{tool.name === "search_openalex" ? safeLink(item.readUrl) || typeof item.xmlId === "string" ? " · 有开放正文候选" : " · 未发现开放正文地址" : ""}</span>
        {typeof item.venue === "string" && <span>刊载：{item.venue}{typeof item.recordType === "string" ? " · " + item.recordType : ""}</span>}
        {typeof item.snippet === "string" && <p>{item.snippet}</p>}
      </li>;
    })}</ol> : <p className={styles.meta}>{tool.status === "running" ? interrupted ? "检索中断，未取得可用资料。" : "正在等待来源返回…" : typeof data?.message === "string" ? data.message : "没有找到可展示的条目。"}</p>}
    {typeof data?.durationMs === "number" && <p className={styles.meta}>来源响应 {(data.durationMs / 1000).toFixed(2)} 秒</p>}
  </section>;
}
function ReadingDetails({ tool, interrupted }: { tool: ToolActivity; interrupted: boolean }) {
  const data = isRecord(tool.result) ? tool.result : undefined;
  const content = typeof data?.text === "string" ? data.text : "";
  const check = isRecord(data?.crossref) ? data.crossref : undefined;
  return <section className={styles.channel} data-source="read_external_source" data-evidence={content ? "extracted" : "none"}>
    <h4>读取外部原文 <small>{tool.status === "running" ? interrupted ? "已中断" : "进行中" : content ? data?.provider === "openalex_xml" ? "已取得 OpenAlex 解析正文片段" : "已取得网页文字片段" : "未取得文字"}</small></h4>
    {content ? <>
      <p className={styles.meta}>{typeof data?.title === "string" ? data.title : "外部来源"} · <a href={safeLink(data?.url)} target="_blank" rel="noopener noreferrer">{data?.provider === "openalex_xml" ? "OpenAlex 作品页 ↗" : "查看页面 ↗"}</a></p>
      <details className={styles.excerpt}><summary>已提取相关片段：{content.slice(0, 200)}{content.length > 200 ? "…" : ""}</summary><blockquote>{content}</blockquote></details>
      <p className={styles.note}>{data?.provider === "openalex_xml" ? "OpenAlex 机器解析的相关正文段落" : "Tavily 提取的网页文字，可能含摘要或页面导航"}；都不等于读完全文，引文仍需在原站核对上下文和页码。</p>
    </> : <p className={styles.meta}>{tool.status === "running" ? interrupted ? "读取中断，可重试。" : "正在提取公开正文…" : typeof data?.message === "string" ? data.message : "未取得可核读内容。"}</p>}
    {check && <p className={styles.meta}>Crossref DOI 核验：{check.status === "verified" ? "已匹配书目记录" : check.status === "not_found" ? "该库未收录" : "暂未核实"}{typeof check.venue === "string" ? " · " + check.venue : ""}{typeof check.recordType === "string" ? " · " + check.recordType : ""}（不代表正文或论点已核验）</p>}
    {typeof data?.durationMs === "number" && <p className={styles.meta}>提取耗时 {(data.durationMs / 1000).toFixed(2)} 秒</p>}
  </section>;
}
export function ExternalResearchActivity({ message }: { message: ChatMessage }) {
  const tools = (message.tools ?? []).filter(tool => names.has(tool.name)); if (!tools.length) return null;
  const interrupted = message.status !== "streaming";
  const running = tools.some(tool => tool.status === "running") && !interrupted;
  const searches = tools.filter(tool => tool.name !== "read_external_source"), reads = tools.length - searches.length;
  const count = searches.reduce((sum, tool) => sum + (isRecord(tool.result) && Array.isArray(tool.result.results) ? tool.result.results.length : 0), 0);
  return <details className={styles.card} data-testid="external-research-activity">
    <summary>{running ? "正在检索外部资料" : "外部资料检索"} <small>· {searches.length} 次查询{reads ? " · " + reads + " 次正文读取" : ""}{count ? " · " + count + " 条候选" : ""}</small><span aria-hidden="true">⌄</span></summary>
    <div className={styles.content}>{tools.map(tool => tool.name === "read_external_source" ? <ReadingDetails key={tool.id} tool={tool} interrupted={interrupted} /> : <SearchDetails key={tool.id} tool={tool} interrupted={interrupted} />)}
      <p className={styles.note}>书目与搜索片段只是发现线索；只有明确显示“已取得解析正文片段”才代表取得文献正文，网页文字仍需核对是否为全文。未读取到的文献不能归纳其观点，也不能凭 DOI 推定已读全文。</p>
    </div>
  </details>;
}
