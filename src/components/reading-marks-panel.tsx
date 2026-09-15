"use client";

import { useEffect, useState } from "react";
import type { MessageAnchor } from "@/lib/chat-stream";
import type { ReadingMark } from "@/lib/reading-marks";
import styles from "./reading-marks-panel.module.css";

type Props = { editionId: string | null; onOpenSource?: (anchor: MessageAnchor) => void; refreshToken?: number };
function label(mark: ReadingMark): string { return mark.kind === "note" ? "笔记" : mark.kind === "favorite" ? "收藏" : "标亮"; }
export function ReadingMarksPanel({ editionId, onOpenSource, refreshToken = 0 }: Props) {
  const [marks, setMarks] = useState<ReadingMark[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!editionId) return;
    const controller = new AbortController();
    void fetch("/api/reading-marks?editionId=" + encodeURIComponent(editionId), { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("阅读标注读取失败（HTTP " + response.status + "）");
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" || !("marks" in body) || !Array.isArray(body.marks)) throw new Error("阅读标注响应格式错误");
        return body.marks as ReadingMark[];
      })
      .then(value => { if (!controller.signal.aborted) { setMarks(value); setError(""); } })
      .catch(cause => { if (controller.signal.aborted) return; console.error("知识卡片读取标注失败", cause); setError(cause instanceof Error ? cause.message : "阅读标注读取失败"); });
    return () => controller.abort();
  }, [editionId, refreshToken]);
  return <section className={styles.panel} aria-label="我的标注">
    <div className={styles.heading}><div><p>从正文留下的痕迹</p><h2>我的标注</h2></div><span>{marks.length}</span></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!error && marks.length === 0 && <p className={styles.empty}>标亮、笔记和收藏会出现在这里。</p>}
    <div className={styles.list}>{marks.map(mark => mark.anchors.map((anchor, index) => <article className={styles.card} key={mark.id + ":" + index}>
      <div className={styles.meta}><span>{label(mark)}</span><time dateTime={mark.updatedAt}>{new Date(mark.updatedAt).toLocaleString("zh-CN")}</time></div>
      <button type="button" className={styles.quote} disabled={!onOpenSource} onClick={() => onOpenSource?.({ paragraphId: anchor.paragraphId, startOffset: anchor.startOffset, endOffset: anchor.endOffset, selectedText: anchor.selectedText })}>{"“"}{anchor.selectedText}{"”"}</button>
      {mark.note && <p className={styles.note}>{mark.note}</p>}
    </article>))}</div>
  </section>;
}

