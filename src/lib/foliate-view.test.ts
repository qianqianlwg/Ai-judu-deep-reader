// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { FoliateView } from "./foliate-types";

async function makeView(fail = false) {
  const path = "../../public/vendor/foliate/view.js";
  const { View } = await import(path) as { View: new () => FoliateView };
  const view = new View();
  const error = new Error("章节排版失败");
  const goTo = vi.fn(async () => { if (fail) throw error; });
  Object.assign(view, { renderer: { goTo }, book: { sections: [{ linear: "yes" }] } });
  return { view, error, goTo };
}
it("真实view.goTo将renderer错误上抛，而不是只记日志伪装成功", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try { const { view, error } = await makeView(true); await expect(view.goTo(0)).rejects.toBe(error); }
  finally { log.mockRestore(); }
});
it("真实view.init首章加载错误一路传回组件，无需等待超时", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try { const { view, error } = await makeView(true); await expect(view.init({ showTextStart: true })).rejects.toBe(error); }
  finally { log.mockRestore(); }
});
it("正常首章导航不受错误传播补丁影响", async () => {
  const { view, goTo } = await makeView(); await view.init({ showTextStart: true });
  expect(goTo).toHaveBeenCalledExactlyOnceWith({ index: 0 });
});
