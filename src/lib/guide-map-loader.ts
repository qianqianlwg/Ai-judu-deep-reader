import { asMindMapConstructor } from "./guide-map-engine";
let loading: ReturnType<typeof load> | undefined;
async function load() {
  const [core, drag, touch, keyboard, minimap, exporter] = await Promise.all([
    import("simple-mind-map/index.js"),
    import("simple-mind-map/src/plugins/Drag.js"),
    import("simple-mind-map/src/plugins/TouchEvent.js"),
    import("simple-mind-map/src/plugins/KeyboardNavigation.js"),
    import("simple-mind-map/src/plugins/MiniMap.js"),
    import("simple-mind-map/src/plugins/Export.js"),
  ]);
  const Constructor = asMindMapConstructor(core.default);
  // WHY：这是第三方类的静态插件注册方法，不是 React Hook。
  for (const plugin of [
    drag.default,
    touch.default,
    keyboard.default,
    minimap.default,
    exporter.default,
  ]) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    Constructor.usePlugin(plugin);
  }
  return Constructor;
}
export async function loadGuideEngine() {
  // WHY：仅浏览器挂载后加载SVG内核；只注册阅读画板需要的插件，不加载富文本/网络协作/任意HTML节点。
  loading ??= load();
  try {
    return await loading;
  } catch (error: unknown) {
    loading = undefined;
    throw error;
  }
}
