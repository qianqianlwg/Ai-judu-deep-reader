import { describe, expect, it } from "vitest";
import { makeMobiFixture } from "./mobi-fixture";

describe("无版权内容的MOBI binary fixture", () => {
  it("记录偏移/文本长度/标题长度来自实际字节，不伪造KF8", () => {
    const bytes = makeMobiFixture();
    expect(bytes.subarray(60, 68).toString()).toBe("BOOKMOBI");
    expect(bytes.readUInt16BE(76)).toBe(2);
    const first = bytes.readUInt32BE(78), text = bytes.readUInt32BE(86);
    expect(bytes.readUInt32BE(first + 36)).toBe(6);
    expect(bytes.readUInt32BE(first + 4)).toBe(bytes.length - text);
    const offset = bytes.readUInt32BE(first + 84), length = bytes.readUInt32BE(first + 88);
    expect(bytes.subarray(first + offset, first + offset + length).toString()).toBe("本地测试标题");
  });
  it("空EXTH可选，PalmDOC压缩记录不同于未压缩记录", () => {
    const plain = makeMobiFixture(), packed = makeMobiFixture({ compression: 2 }), noExth = makeMobiFixture({ exth: false });
    expect(plain.equals(packed)).toBe(false);
    expect(packed.readUInt16BE(packed.readUInt32BE(78))).toBe(2);
    expect(noExth.readUInt32BE(noExth.readUInt32BE(78) + 128)).toBe(0);
  });
});
