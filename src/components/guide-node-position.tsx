"use client";
import { useState } from "react";
import type { GuideNode } from "@/lib/guide";
import { GUIDE_POSITION_GRADIENT, groupGuideLocations, guideNodePosition, guidePositionColor, guidePositionLabel } from "@/lib/guide-locations";
import type { GuideLocationView } from "./guide-position-bar";
import styles from "./guide-node-position.module.css";
type Props = { node: GuideNode; nodes: GuideNode[]; state?: GuideLocationView };
export function GuideNodePosition({ node, nodes, state }: Props) {
  const [limit, setLimit] = useState(8);
  const position = state?.locations ? guideNodePosition(node, nodes, state.locations) : null;
  const groups = groupGuideLocations(position?.sources ?? []);
  const entries = groups.flatMap(group => group.spans);
  const editions = new Set(groups.map(group => group.editionId));
  // WHY：全书底带独立于当前来源区段，不能因长书中的来源很短或切换主题而退化为灰条；标记仍使用真实全书坐标。
  return <section className={styles.position} aria-label="主题全书位置">
    <div className={styles.heading}><h3>全书位置</h3>{position?.inherited && <small>含子主题来源</small>}</div>
    <div className={styles.track} style={{ background: GUIDE_POSITION_GRADIENT }} aria-hidden="true">{entries.map((span, index) => <span key={index} style={{ left: span.start * 100 + "%", width: (span.end - span.start) * 100 + "%", background: guidePositionColor((span.start + span.end) / 2, state?.colorScale) }} />)}</div>
    <div className={styles.axis} aria-hidden="true"><span>书首 0%</span><span>书末 100%</span></div>
    {state?.loading ? <p role="status">正在读取全书位置…</p> : state?.error ? <p role="alert">{state.error} <button onClick={state.retry}>重试</button></p> : groups.length ? <>
      <ul>{groups.slice(0, limit).map((group, index) => <li key={group.editionId + ":" + index} title={group.hasGap ? "近似来源合并显示位置跨度；实际来源仍独立保留，不补齐间隔原文。" : undefined}>
        <span className={styles.swatch} style={{ background: guidePositionColor((group.spans[0].start + group.spans[0].end) / 2, state?.colorScale) }} aria-hidden="true" />
        <span><strong>{group.chapterTitles.filter(Boolean).join(" → ") || "原文"}</strong>{editions.size > 1 && <small>{group.editionLabel || group.editionId} · 独立定位</small>}</span>
        <span className={styles.percent}>{guidePositionLabel(group)}</span>
      </li>)}</ul>
      {groups.length > limit && <button onClick={() => setLimit(value => value + 8)}>查看更多位置（共 {groups.length} 处）</button>}
      {position?.missing ? <p role="alert">{position.missing} 则依据无法核对位置，未使用推测值。</p> : null}
    </> : <p>{node.sourceIds.length || position?.missing ? "暂无可核对的全书位置" : "无原文来源"}</p>}
  </section>;
}
