import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { makeUmdFixture, umdData, umdSection, umdNumbers } from "./umd-fixture";
it("自造section/data字段为小端且长度含头部", () => {
  expect(umdSection(0x83, umdNumbers([0x12345678]))).toEqual(Buffer.from([0x23, 0x83, 0, 0, 9, 0x78, 0x56, 0x34, 0x12]));
  expect(umdData(5, Buffer.from([8, 9]))).toEqual(Buffer.from([0x24, 5, 0, 0, 0, 11, 0, 0, 0, 8, 9]));
});
describe("UMD结构fixture不是扩展名假样本", () => {
  it("magic、逆序索引不改变物理正文顺序，终止长度准确", () => {
    const bytes = makeUmdFixture({ indexOrder: [1, 0] });
    expect(bytes.readUInt32LE(0)).toBe(0xde9a9b89); expect(bytes.readUInt32LE(bytes.length - 4)).toBe(bytes.length);
    let offset = 4; const compressed: { id: number; content: Buffer }[] = [];
    while (offset < bytes.length) {
      if (bytes[offset] === 0x23) offset += bytes[offset + 4];
      else { const id = bytes.readUInt32LE(offset + 1), length = bytes.readUInt32LE(offset + 5);
        if (id >= 0x1000) compressed.push({ id, content: inflateSync(bytes.subarray(offset + 9, offset + length)) }); offset += length; }
    }
    expect(compressed.map(item => item.id)).toEqual([0x1000, 0x1001]);
    const text = Buffer.concat(compressed.map(item => item.content)).toString("utf16le");
    expect(text).toContain("中文与emoji😀。"); expect(text).toContain("第二段正文。");
  });
  it("编码和元数据边界无法生成超长章节标题", () => {
    expect(() => makeUmdFixture({ chapters: [{ title: "章".repeat(128), text: "正文" }] })).toThrow("过长");
    expect(() => umdSection(2, Buffer.alloc(251))).toThrow("过长");
  });
});
