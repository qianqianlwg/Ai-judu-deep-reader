"use client";
import { useMemo, type MouseEvent } from "react";
import type { GuideNode } from "@/lib/guide";
import { GUIDE_POSITION_GRADIENT, guideColorScale, guideNodePosition, guidePercentLabel, guidePositionLabel, type GuideLocations, type GuideColorScale, type GuideColorMode } from "@/lib/guide-locations";
import styles from "./guide-position-bar.module.css";
export type GuideLocationView = {
  locations: GuideLocations | null; loading: boolean; error: string; retry: () => void;
  colorScale?: GuideColorScale; onColorMode?: (mode: GuideColorMode) => void;
};
type Props = { nodes: GuideNode[]; selected: string | null; state?: GuideLocationView; onSelect: (id: string) => void; compact?: boolean };
export function GuidePositionBar({ nodes, selected, state, onSelect, compact = false }: Props) {
  const locations = state?.locations;
  const scale = state?.colorScale ?? guideColorScale(locations, "book");
  const points = useMemo(() => locations ? nodes.flatMap(node => guideNodePosition(node, nodes, locations).sources.flatMap(source => source.spans.map(span => ({ id: node.id, value: (span.start + span.end) / 2 })))).sort((a, b) => a.value - b.value) : [], [nodes, locations]);
  const node = nodes.find(item => item.id === selected);
  const position = node && locations ? guideNodePosition(node, nodes, locations) : null;
  const spans = position?.sources.flatMap(source => source.spans) ?? [];
  const relative = (value: number) => (value - scale.start) / (scale.end - scale.start);
  const precision = (scale.end - scale.start) * 100 < .01 ? 6 : 2;
  function choose(event: MouseEvent<HTMLButtonElement>) {
    if (!points.length) return;
    if (event.detail === 0) {
      const ids = [...new Set(points.map(point => point.id))];
      onSelect(ids[(ids.indexOf(selected ?? "") + 1) % ids.length]); return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const value = scale.start + ratio * (scale.end - scale.start);
    const closest = points.reduce((best, point) => Math.abs(point.value - value) < Math.abs(best.value - value) ? point : best);
    onSelect(closest.id);
  }
  return <section className={[styles.legend, compact ? styles.compact : ""].join(" ")} aria-label="全书位置与连线颜色对照">
    <div className={styles.heading}><strong>连线颜色对照</strong>{state?.onColorMode ? <div className={styles.modes} role="group" aria-label="位置颜色范围">
      <button aria-pressed={scale.mode === "mapped"} disabled={!points.length} onClick={() => state.onColorMode?.("mapped")}>已关联范围</button>
      <button aria-pressed={scale.mode === "book"} onClick={() => state.onColorMode?.("book")}>全书</button>
    </div> : <span>全书位置</span>}</div>
    <button className={styles.trackButton} title="蓝 → 青 → 青绿 → 绿 → 黄 → 橙 → 红 → 粉 → 紫；连续色阶只表示原文位置" disabled={!points.length} aria-label="全书位置色条，点击定位附近主题，键盘依次切换主题" onClick={choose}>
      <span className={styles.track} style={{ background: GUIDE_POSITION_GRADIENT }} />
      {points.map((point, index) => <span key={point.id + ":" + index} className={styles.point} style={{ left: relative(point.value) * 100 + "%" }} />)}
      {spans.map((span, index) => <span key={index} className={styles.selected} style={{ left: relative(span.start) * 100 + "%", width: (span.end - span.start) / (scale.end - scale.start) * 100 + "%" }} title={span.chapterTitle + " · " + guidePositionLabel(span)} />)}
    </button>
    <div className={styles.axis}><span>{scale.mode === "book" ? "书首 0%" : guidePercentLabel(scale.start, precision)}</span><span>{guidePercentLabel((scale.start + scale.end) / 2, precision)}</span><span>{scale.mode === "book" ? "书末 100%" : guidePercentLabel(scale.end, precision)}</span></div>
    <div className={styles.note} aria-live="polite">{state?.loading ? "正在读取全书位置…" : state?.error ? <><span role="alert">{state.error}</span> <button onClick={state.retry}>重试</button></> : locations?.issues.length ? locations.issues.join(" ") : compact ? null : <>{scale.mode === "mapped" ? "局部色阶放大 · 全书百分比不变" : "固定全书色阶"}{spans.length ? " · " + spans.length + " 处来源已标出" + (position?.inherited ? "（含子主题）" : "") : " · 灰色虚线：无可核对来源"}</>}</div>
  </section>;
}
