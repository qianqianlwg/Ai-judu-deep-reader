import { expect, it, vi } from "vitest";
const fake = vi.hoisted(() => {
  const plugin = vi.fn();
  return {
    plugin,
    Constructor: Object.assign(function Mock() {}, { usePlugin: plugin }),
  };
});
vi.mock("simple-mind-map/index.js", () => ({ default: fake.Constructor }));
vi.mock("simple-mind-map/src/plugins/Drag.js", () => ({ default: "drag" }));
vi.mock("simple-mind-map/src/plugins/TouchEvent.js", () => ({
  default: "touch",
}));
vi.mock("simple-mind-map/src/plugins/KeyboardNavigation.js", () => ({
  default: "keyboard",
}));
vi.mock("simple-mind-map/src/plugins/MiniMap.js", () => ({ default: "map" }));
vi.mock("simple-mind-map/src/plugins/Export.js", () => ({ default: "export" }));
import { loadGuideEngine } from "./guide-map-loader";
it("按需注册五个插件，同会话只加载一次，不启用网络协作和富文本", async () => {
  const a = await loadGuideEngine(),
    b = await loadGuideEngine();
  expect(a).toBe(b);
  expect(fake.plugin).toHaveBeenCalledTimes(5);
  expect(fake.plugin.mock.calls.flat()).toEqual([
    "drag",
    "touch",
    "keyboard",
    "map",
    "export",
  ]);
});
