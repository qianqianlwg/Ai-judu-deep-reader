import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashText } from "./hash";

describe("跨运行时 SHA-256 兼容性", () => {
  it("为同一段文本生成稳定哈希", () => {
    expect(hashText("句读")).toBe(hashText("句读"));
    expect(hashText("句读")).not.toBe(hashText("阅读"));
  });
  it.each(["", "abc", "你好世界😀", "e\u0301", "\ud800", "长文本".repeat(10000)])("与既有 Node UTF-8 哈希一致 %#", (value) => {
    expect(hashText(value)).toBe(createHash("sha256").update(value).digest("hex"));
  });
});
