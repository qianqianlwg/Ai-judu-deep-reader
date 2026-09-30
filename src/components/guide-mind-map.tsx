"use client";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  useGuideMapEngine,
  type GuideEngineProps,
} from "@/hooks/use-guide-map-engine";
import { guideMapMatches } from "@/lib/guide-map-adapter";
import styles from "./guide-mind-map.module.css";
export type GuideMindMapProps = GuideEngineProps & {
  selected: string | null;
  query: string;
  onInspect: () => void;
  onEdit: (id: string) => void;
  onCreate: (parentId: string | null) => void;
};
export function GuideMindMap(props: GuideMindMapProps) {
  const { element, ready, error, zoom, revision, action, engine, retry } =
    useGuideMapEngine(props);
  const [showMiniMap, setShowMiniMap] = useState(false),
    [mini, setMini] = useState<{ image: string; frame: CSSProperties } | null>(
      null,
    ),
    [matchIndex, setMatchIndex] = useState(0),
    [exportError, setExportError] = useState("");
  const matches = useMemo(
    () => guideMapMatches(props.nodes, props.query),
    [props.nodes, props.query],
  );
  const selected = props.nodes.find((node) => node.id === props.selected);
  useEffect(() => {
    if (!showMiniMap || !ready) return;
    try {
      const result = engine.current?.miniMap?.calculationMiniMap(200, 130);
      // WHY：小地图用图片承载内核生成的SVG，不将SVG字符串作为HTML注入宿主页。
      if (result)
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMini({
          image:
            "data:image/svg+xml;charset=utf-8," +
            encodeURIComponent(result.svgHTML),
          frame: result.viewBoxStyle,
        });
    } catch (cause: unknown) {
      console.warn("小地图未更新", cause);
    }
  }, [showMiniMap, ready, revision, engine]);
  function focusMatch(index: number) {
    if (!matches.length) return;
    const next = ((index % matches.length) + matches.length) % matches.length;
    setMatchIndex(next);
    props.onSelect(matches[next].id);
    action((engine) => engine.execCommand("GO_TARGET_NODE", matches[next].id));
  }
  return (
    <div className={styles.board} role="region" aria-label="思维导图交互画板">
      <div
        ref={element}
        className={styles.engine}
        tabIndex={0}
        aria-label="主题节点画板，双击节点编辑，拖动调整结构"
      />
      {(!ready || error) && (
        <div className={styles.error} role={error ? "alert" : "status"}>
          {error || "正在展开思维导图…"}
          {error && <button onClick={retry}>重新加载画板</button>}
        </div>
      )}
      {props.query.trim() && (
        <div className={styles.searchPanel}>
          <span>
            {matches.length
              ? `${(matchIndex % matches.length) + 1} / ${matches.length} 个匹配`
              : "没有匹配的主题"}
          </span>
          <button
            disabled={!matches.length}
            aria-label="上一个搜索结果"
            onClick={() => focusMatch(matchIndex - 1)}
          >
            ↑
          </button>
          <button
            disabled={!matches.length}
            aria-label="下一个搜索结果"
            onClick={() => focusMatch(matchIndex + 1)}
          >
            ↓
          </button>
          <button
            disabled={!matches.length}
            onClick={() => focusMatch(matchIndex)}
          >
            定位
          </button>
        </div>
      )}
      <div className={styles.hint}>
        拖动平移 · 滚轮缩放 · 双击编辑 · Tab 子主题 · Enter 同级
      </div>
      {selected && (
        <div className={styles.selectionTools}>
          <span>{selected.title}</span>
          <button onClick={props.onInspect}>节点详情</button>
          <button onClick={() => props.onEdit(selected.id)}>编辑内容</button>
          <button onClick={() => props.onCreate(selected.id)}>＋ 子主题</button>
        </div>
      )}
      <div className={styles.controls}>
        <button
          disabled={!ready}
          aria-label="缩小画板"
          onClick={() => action((engine) => engine.view.narrow())}
        >
          −
        </button>
        <button
          disabled={!ready}
          aria-label="画板恢复百分之百"
          onClick={() => action((engine) => engine.view.setScale(1))}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          disabled={!ready}
          aria-label="放大画板"
          onClick={() => action((engine) => engine.view.enlarge())}
        >
          ＋
        </button>
        <span />
        <button
          disabled={!ready}
          onClick={() => action((engine) => engine.view.fit())}
        >
          适应画布
        </button>
        <button
          disabled={!ready || props.busy}
          onClick={() => action((engine) => engine.execCommand("RESET_LAYOUT"))}
        >
          自动布局
        </button>
        <button
          disabled={!ready}
          aria-pressed={showMiniMap}
          onClick={() => setShowMiniMap(!showMiniMap)}
        >
          导航图
        </button>
        <button
          disabled={!ready}
          onClick={() =>
            action((engine) => {
              void engine
                .export("svg", true, props.title + "-思维导图")
                .then((result) => {
                  if (!result) setExportError("导出未完成，请重试");
                })
                .catch((cause: unknown) => {
                  console.error("导出思维导图失败", cause);
                  setExportError("导出未完成，请重试");
                });
            })
          }
        >
          导出 SVG
        </button>
      </div>
      {exportError && (
        <p role="alert" className={styles.error}>
          {exportError}
        </p>
      )}
      {showMiniMap && mini && (
        <div
          className={styles.minimap}
          aria-label="思维导图导航缩略图"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            action((engine) => engine.miniMap?.onMousedown(event));
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              action((engine) => engine.miniMap?.onMousemove(event));
          }}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture(event.pointerId);
            action((engine) => engine.miniMap?.onMouseup());
          }}
          onPointerCancel={() =>
            action((engine) => engine.miniMap?.onMouseup())
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mini.image} alt="全部主题位置" draggable={false} />
          <div className={styles.miniFrame} style={mini.frame} />
        </div>
      )}
      {!props.nodes.length && ready && (
        <button
          className={styles.firstNode}
          onClick={() => props.onCreate(null)}
        >
          ＋ 添加第一个主题
        </button>
      )}
      <span className={styles.credit} title="基于 SimpleMindMap（MIT）开发">
        SimpleMindMap
      </span>
    </div>
  );
}
