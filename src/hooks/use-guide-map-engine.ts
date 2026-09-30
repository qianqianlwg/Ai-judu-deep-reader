"use client";
import { useEffect, useRef, useState } from "react";
import {
  fromMindTree,
  mindCanvasSignature,
  toMindTree,
  parseMindView,
  GUIDE_ROOT_ID,
} from "@/lib/guide-map-adapter";
import { isMindNode, type MindMapEngine } from "@/lib/guide-map-engine";
import { loadGuideEngine } from "@/lib/guide-map-loader";
import type { GuideCommand, GuideNode } from "@/lib/guide";
export type GuideEngineProps = {
  bookId: string;
  title: string;
  nodes: GuideNode[];
  version: number;
  busy: boolean;
  selected?: string | null;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string | null) => void;
  onCommand: (command: GuideCommand, version?: number) => Promise<boolean>;
};
export function useGuideMapEngine(props: GuideEngineProps) {
  const element = useRef<HTMLDivElement>(null),
    engine = useRef<MindMapEngine | null>(null),
    latest = useRef(props),
    appliedVersion = useRef(-1),
    baseline = useRef("");
  const editing = useRef(false),
    moving = useRef(false),
    saving = useRef(false),
    awaitingCommand = useRef(false),
    lastExternal = useRef("");
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [zoom, setZoom] = useState(1),
    [revision, setRevision] = useState(0),
    [reload, setReload] = useState(0);
  useEffect(() => {
    latest.current = props;
  }, [props]);
  useEffect(() => {
    const host = element.current;
    if (!host) return;
    let dead = false,
      map: MindMapEngine | null = null,
      observer: ResizeObserver | null = null,
      commandTimer: ReturnType<typeof setTimeout> | undefined;
    editing.current = false;
    moving.current = false;
    saving.current = false;
    awaitingCommand.current = false;
    const preventUnsavedExit = (event: BeforeUnloadEvent) => {
      if (editing.current || moving.current || saving.current || awaitingCommand.current || latest.current.busy) {
        event.preventDefault(); event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", preventUnsavedExit);
    void (async () => {
      try {
        const Constructor = await loadGuideEngine();
        if (dead) return;
        const p = latest.current,
          tree = toMindTree(p.title, p.nodes, p.collapsed);
        baseline.current = mindCanvasSignature(fromMindTree(tree).nodes);
        appliedVersion.current = p.version;
        lastExternal.current = JSON.stringify([
          p.title,
          p.version,
          baseline.current,
          [...p.collapsed].sort(),
        ]);
        let viewData;
        try {
          const stored = localStorage.getItem("judu:mind-view:" + p.bookId);
          if (stored) viewData = parseMindView(JSON.parse(stored));
        } catch (cause: unknown) {
          console.warn("画板视角未恢复", cause);
        }
        // WHY：直接使用SimpleMindMap默认矩形主题与布局，不再自制圆形、彩色卡片样式。
        map = new Constructor({
          el: host,
          data: tree,
          layout: "logicalStructure",
          theme: "default",
          viewData,
          fit: !viewData,
          addHistoryOnInit: false,
          addHistoryTime: 50,
          maxHistoryCount: 2,
          enableFreeDrag: true,
          customCheckEnableShortcut: (event: KeyboardEvent) => {
            const target = event.target;
            return target instanceof HTMLElement && (target === document.body || host.contains(target) || target.classList.contains("smm-node-edit-wrap"));
          },
          textAutoWrapWidth: 260,
          mousewheelAction: "zoom",
          mousewheelZoomActionReverse: true,
          minZoomRatio: 20,
          maxZoomRatio: 250,
          resetScaleOnMoveNodeToCenter: false,
          isShowExpandNum: true,
          alwaysShowExpandBtn: false,
          defaultInsertSecondLevelNodeText: "新主题",
          defaultInsertBelowSecondLevelNodeText: "新分支",
          beforeTextEdit: (node: unknown) => isMindNode(node) && !node.isRoot,
          themeConfig: { backgroundColor: "#f5f5f5" },
          errorHandler: (_code: unknown, cause: unknown) => {
            console.error("思维导图引擎异常", cause);
            if (!dead) setError("画板操作未完成，请重试；已保存导读不受影响。");
          },
        });
        engine.current = map;
        // WHY：取消内核独立撤销栈的命令入口；手动与AI修改统一回到服务端版本，刷新不丢撤销记录。
        map.command.remove("BACK");
        map.command.remove("FORWARD");
        map.command.add("BACK", () => {
          if (!saving.current)
            void latest.current.onCommand({ action: "undo" });
        });
        map.command.add("FORWARD", () => {
          if (!saving.current)
            void latest.current.onCommand({ action: "redo" });
        });
        map.on("before_show_text_edit", () => {
          editing.current = true;
        });
        map.on("hide_text_edit", () => {
          editing.current = false;
          scheduleCapture();
        });
        map.on("node_dragging", () => {
          moving.current = true;
        });
        map.on("node_dragend", () => {
          moving.current = false;
          scheduleCapture();
        });
        map.on("node_click", (...args) => {
          const node = args.find(isMindNode);
          if (node) {
            const id = node.getData("uid");
            if (typeof id === "string") latest.current.onSelect(id === GUIDE_ROOT_ID ? null : id);
          }
        });
        map.on("node_active", (_node, list) => {
          if (moving.current || !Array.isArray(list) || list.length !== 1 || !isMindNode(list[0])) return;
          const id = list[0].getData("uid");
          if (typeof id === "string" && id !== GUIDE_ROOT_ID && latest.current.selected !== id) latest.current.onSelect(id);
        });
        map.on("draw_click", () => latest.current.onSelect(null));
        map.on("scale", (value) => {
          if (typeof value === "number" && !dead) setZoom(value);
        });
        map.on("node_tree_render_end", () => {
          if (!dead) setRevision((value) => value + 1);
        });
        map.on("view_data_change", (value) => {
          if (!dead) {
            try {
              localStorage.setItem(
                "judu:mind-view:" + p.bookId,
                JSON.stringify(value),
              );
            } catch (cause: unknown) {
              console.warn("画板视角未保存", cause);
            }
            setRevision((value) => value + 1);
          }
        });
        const captureChange = (value: unknown) => {
          if (dead || saving.current || editing.current || moving.current)
            return;
          awaitingCommand.current = false;
          try {
            const changed = fromMindTree(value),
              signature = mindCanvasSignature(changed.nodes);
            const previous = latest.current.collapsed;
            for (const id of new Set([...previous, ...changed.collapsed]))
              if (previous.has(id) !== changed.collapsed.has(id))
                latest.current.onToggle(id);
            if (signature === baseline.current) {
              setRevision((value) => value + 1);
              return;
            }
            saving.current = true;
            setError("");
            map!.opt.readonly = true;
            const version = appliedVersion.current;
            void latest.current
              .onCommand(
                {
                  action: "change",
                  change: { type: "canvas", nodes: changed.nodes },
                },
                version,
              )
              .then((ok) => {
                if (!dead && !ok)
                  setError("画板修改未保存，已恢复已保存内容，请检查后重试。");
              })
              .catch((cause: unknown) => {
                console.error("保存画板失败", cause);
                if (!dead) setError("画板修改未保存，请重试。");
              })
              .finally(() => {
                if (!dead) {
                  saving.current = false;
                  map!.opt.readonly = latest.current.busy;
                  appliedVersion.current = -1;
                  lastExternal.current = "";
                  setRevision((value) => value + 1);
                }
              });
          } catch (cause: unknown) {
            console.error("画板变更格式无效", cause);
            if (!dead) {
              setError("这次画板修改超出可保存范围，已保留此前版本。");
              appliedVersion.current = -1;
              lastExternal.current = "";
              setRevision((value) => value + 1);
            }
          }
        };
        function scheduleCapture() {
          if (commandTimer) clearTimeout(commandTimer);
          commandTimer = setTimeout(() => {
            if (!dead && map) captureChange(map.getData());
          }, 100);
        }
        map.on("data_change", captureChange);
        map.on("afterExecCommand", (name) => {
          if (
            typeof name !== "string" ||
            [
              "BACK",
              "FORWARD",
              "SET_NODE_ACTIVE",
              "CLEAR_ACTIVE_NODE",
              "GO_TARGET_NODE",
            ].includes(name) ||
            saving.current
          )
            return;
          awaitingCommand.current = true;
          scheduleCapture();
        });
        // WHY：工作区切换或过渡布局可能暂时没有尺寸；仅在实际可见且有尺寸时通知SVG引擎。
        observer = new ResizeObserver(() => {
          if (
            !dead &&
            map &&
            host.isConnected &&
            host.clientWidth > 0 &&
            host.clientHeight > 0
          )
            map.resize();
        });
        observer.observe(host);
        setZoom(map.view.scale);
        setReady(true);
        setError("");
      } catch (cause: unknown) {
        console.error("加载思维导图失败", cause);
        if (!dead)
          setError("思维导图加载失败，请重新加载画板；已保存的数据不受影响。");
      }
    })();
    return () => {
      // WHY：离开页面时结束尚未提交的原生编辑，不能让100ms防抖丢失最后一次操作。
      if (map && editing.current) map.renderer.textEdit.hideEditTextBox();
      if (map && !saving.current) {
        try {
          const changed = fromMindTree(map.getData());
          if (mindCanvasSignature(changed.nodes) !== baseline.current)
            void latest.current.onCommand(
              {
                action: "change",
                change: { type: "canvas", nodes: changed.nodes },
              },
              appliedVersion.current,
            );
        } catch (cause: unknown) {
          console.error("离开画板时未能保存变更", cause);
        }
      }
      dead = true;
      window.removeEventListener("beforeunload", preventUnsavedExit);
      if (commandTimer) clearTimeout(commandTimer);
      observer?.disconnect();
      if (map) map.destroy();
      engine.current = null;
    };
  }, [props.bookId, reload]);
  useEffect(() => {
    const map = engine.current;
    if (
      !ready ||
      !map ||
      editing.current ||
      moving.current ||
      saving.current ||
      awaitingCommand.current
    )
      return;
    map.opt.readonly = props.busy;
    const tree = toMindTree(props.title, props.nodes, props.collapsed),
      projection = fromMindTree(tree),
      signature = mindCanvasSignature(projection.nodes);
    const external = JSON.stringify([
      props.title,
      props.version,
      signature,
      [...props.collapsed].sort(),
    ]);
    if (lastExternal.current === external) return;
    lastExternal.current = external;
    baseline.current = signature;
    appliedVersion.current = props.version;
    map.updateData(tree);
  }, [
    props.version,
    props.nodes,
    props.title,
    props.collapsed,
    props.busy,
    ready,
    revision,
  ]);
  function action(fn: (map: MindMapEngine) => void) {
    if (engine.current) fn(engine.current);
  }
  return {
    element,
    ready,
    error,
    zoom,
    revision,
    action,
    engine,
    retry: () => setReload((value) => value + 1),
  };
}
