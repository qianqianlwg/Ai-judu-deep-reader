"use client";
import type { AnalysisOnlySource } from "@/lib/analysis-only-source";
import { ProgressiveQuote } from "./progressive-quote";
import styles from "./message-source-card.module.css";
export function AnalysisOnlySourceCard({source}: {source: AnalysisOnlySource}) {
  return <div className={styles.card} data-testid="analysis-only-source" data-source-channel="analysis-only">
    <details className={styles.details}>
      <summary aria-label="展开仅分析选文"><span className={styles.heading}><span className={styles.label}>仅分析选文</span><span className={styles.meta}>无原文位置 · {Array.from(source.text).length} 字</span></span><span className={styles.preview}>{Array.from(source.text).slice(0,72).join("")}{Array.from(source.text).length>72 ? "…" : ""}</span></summary>
      <div className={styles.content}><p className={styles.caption}>选文与回答保存在聊天历史；没有可靠原文位置，不能回跳，也不保存原文标注、知识卡或导读。</p><ProgressiveQuote text={source.text}/></div>
    </details>
  </div>;
}
