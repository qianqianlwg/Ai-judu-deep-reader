// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useGuideMapEngine, type GuideEngineProps } from "./use-guide-map-engine";
import type { MindMapEngine } from "@/lib/guide-map-engine";
import { toMindTree, type MindTree } from "@/lib/guide-map-adapter";
const loader = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/guide-map-loader", () => ({ loadGuideEngine: loader.load }));
let root: Root, host: HTMLDivElement, latest: ReturnType<typeof useGuideMapEngine>, props: GuideEngineProps;
let resize: () => void;
class FakeEngine implements MindMapEngine {
  static current: FakeEngine;
  static usePlugin() { return FakeEngine; }
  options: Record<string, unknown>;
  tree: MindTree;
  handlers = new Map<string, (...args: unknown[]) => void>();
  commands = new Map<string, () => void>();
  opt = { readonly: false };
  renderer = { activeNodeList: [], textEdit: { showTextEdit: false, hideEditTextBox: () => this.emit("hide_text_edit") }, findNodeByUid: vi.fn(), moveNodeToCenter: vi.fn() };
  command = { pause: vi.fn(), recovery: vi.fn(), remove: vi.fn(), add: (key: string, fn: () => void) => { this.commands.set(key, fn); } };
  view = { scale: 1, fit: vi.fn(), enlarge: vi.fn(), narrow: vi.fn(), setScale: vi.fn(), getTransformData: vi.fn(), setTransformData: vi.fn() };
  constructor(options: Record<string, unknown>) { this.options = options; this.tree = options.data as MindTree; FakeEngine.current = this; }
  on(name: string, fn: (...args: unknown[]) => void) { this.handlers.set(name, fn); }
  off(name: string) { this.handlers.delete(name); }
  emit(name: string, ...args: unknown[]) { this.handlers.get(name)?.(...args); }
  getData() { return this.tree; }
  updateData = vi.fn((tree: unknown) => { this.tree = tree as MindTree; });
  resize = vi.fn(); destroy = vi.fn(); execCommand = vi.fn(); export = vi.fn();
}
function Harness() {
  const value = useGuideMapEngine(props);
  useEffect(() => { latest = value; });
  // WHY：测试挂载的是hook公开的DOM ref对象，并未读取ref.current；编译器将测试观察器别名误判为读取。
  // eslint-disable-next-line react-hooks/refs
  return <div ref={value.element} />;
}
const render = async () => { await act(async () => root.render(<Harness />)); };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers(); localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { constructor(fn: () => void) { resize = fn; } observe() {} disconnect() {} });
  props = { bookId: "b", title: "书", version: 1, busy: false, nodes: [{ id: "a", parentId: null, title: "认识", summary: "依据", sourceIds: ["s"] }], collapsed: new Set(), onSelect: vi.fn(), onToggle: vi.fn(), onCommand: vi.fn().mockResolvedValue(true) };
  loader.load.mockReset().mockResolvedValue(FakeEngine);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("加载原生主题并销毁内核，尺寸为零不触发resize", async () => {
  await render(); const map = FakeEngine.current;
  expect(latest.ready).toBe(true); expect(map.options).toMatchObject({ theme: "default", enableFreeDrag: true });
  resize(); expect(map.resize).not.toHaveBeenCalled();
  act(() => root.unmount()); expect(map.destroy).toHaveBeenCalledTimes(1);
  root = createRoot(host);
});
it("本地视角可恢复，只允许有限的变换字段", async () => {
  const view = { state: { scale: 0.8, x: 20, y: 30, sx: 20, sy: 30 }, transform: { a: 0.8, b: 0, c: 0, d: 0.8, e: 20, f: 30 } };
  localStorage.setItem("judu:mind-view:b", JSON.stringify(view)); await render();
  expect(FakeEngine.current.options).toMatchObject({ viewData: view, fit: false });
});
it("轮询不会覆盖编辑草稿，完成输入后只保存一次且使用编辑前版本", async () => {
  await render(); const map = FakeEngine.current;
  act(() => { map.emit("before_show_text_edit"); map.tree.children[0].data.text = "新理解"; map.emit("afterExecCommand", "SET_NODE_TEXT"); });
  props = { ...props, version: 2, nodes: props.nodes.map(node => ({ ...node, title: "AI的更新" })) }; await render();
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  expect(map.tree.children[0].data.text).toBe("新理解"); expect(props.onCommand).not.toHaveBeenCalled();
  await act(async () => { map.emit("hide_text_edit"); await vi.advanceTimersByTimeAsync(150); });
  expect(props.onCommand).toHaveBeenCalledTimes(1);
  expect(props.onCommand).toHaveBeenCalledWith({ action: "change", change: { type: "canvas", nodes: [{ id: "a", parentId: null, title: "新理解" }] } }, 1);
  expect(map.tree.children[0].data.text).toBe("AI的更新");
});
it("折叠只改变视图，撤销重做统一发给服务端", async () => {
  await render(); const map = FakeEngine.current;
  act(() => { map.tree.children[0].data.expand = false; map.emit("data_change", map.tree); });
  expect(props.onToggle).toHaveBeenCalledWith("a"); expect(props.onCommand).not.toHaveBeenCalled();
  await act(async () => { map.commands.get("BACK")?.(); map.commands.get("FORWARD")?.(); });
  expect(props.onCommand).toHaveBeenNthCalledWith(1, { action: "undo" }); expect(props.onCommand).toHaveBeenNthCalledWith(2, { action: "redo" });
});
it("保存失败显示错误，并恢复最新的已保存树", async () => {
  props.onCommand = vi.fn().mockResolvedValue(false); await render(); const map = FakeEngine.current;
  await act(async () => { map.tree.children[0].data.text = "草稿"; map.emit("data_change", map.tree); });
  expect(latest.error).toContain("未保存"); expect(map.tree.children[0].data.text).toBe("认识");
});
it("结构拖动中的轮询延迟应用，拖动结束后保存层级与坐标", async () => {
  await render(); const map = FakeEngine.current;
  act(() => { map.emit("node_dragging"); map.tree.children[0].data.customLeft = 24; map.tree.children[0].data.customTop = 88; map.emit("data_change", map.tree); });
  expect(props.onCommand).not.toHaveBeenCalled();
  await act(async () => { map.emit("node_dragend"); await vi.advanceTimersByTimeAsync(150); });
  expect(props.onCommand).toHaveBeenCalledWith(expect.objectContaining({ change: { type: "canvas", nodes: [{ id: "a", parentId: null, title: "认识", position: { x: 24, y: 88 } }] } }), 1);
});
it("离开画板仍会冲刷尚未触发的防抖修改", async () => {
  await render(); FakeEngine.current.tree.children[0].data.text = "最后一笔";
  await act(async () => root.unmount()); root = createRoot(host);
  expect(props.onCommand).toHaveBeenCalledTimes(1);
});
it("重载失败可重试，不让延迟加载的实例挂到已卸载页面", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  loader.load.mockRejectedValueOnce(new Error("network")); await render(); expect(latest.error).toContain("加载失败");
  await act(async () => latest.retry()); expect(latest.ready).toBe(true);
});
it("外部只改来源归纳不反向制造画板版本", async () => {
  await render(); const map = FakeEngine.current;
  props = { ...props, version: 2, nodes: props.nodes.map(node => ({ ...node, summary: "AI增加归纳" })) }; await render();
  act(() => map.emit("data_change", map.tree)); expect(props.onCommand).not.toHaveBeenCalled();
  expect(map.tree).toEqual(toMindTree(props.title, props.nodes, new Set()));
});
it("有未保存编辑时提示不要直接关闭页面，保存后解除", async () => {
  await render(); const map = FakeEngine.current;
  act(() => map.emit("before_show_text_edit"));
  const dirty = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(dirty); expect(dirty.defaultPrevented).toBe(true);
  await act(async () => { map.emit("hide_text_edit"); await vi.advanceTimersByTimeAsync(150); });
  const clean = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(clean); expect(clean.defaultPrevented).toBe(false);
});
