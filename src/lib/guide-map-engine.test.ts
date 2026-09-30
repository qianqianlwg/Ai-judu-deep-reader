import { expect, it } from "vitest";
import { asMindMapConstructor, isMindNode } from "./guide-map-engine";
it("上游无types时仍在运行时校验最小接口", () => {
  expect(() => asMindMapConstructor({})).toThrow("未正确加载");
  expect(isMindNode(null)).toBe(false);
  expect(isMindNode({ getData: () => "uid" })).toBe(true);
});
