import { describe, expect, it } from "vitest";
import { hashText } from "./hash";

describe("hashText", () => {
  it("为同一段文本生成稳定哈希", () => {
    expect(hashText("句读")).toBe(hashText("句读"));
    expect(hashText("句读")).not.toBe(hashText("阅读"));
  });
});
