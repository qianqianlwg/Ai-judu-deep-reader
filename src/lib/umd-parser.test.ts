import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseUmd } from "./umd-parser";
import { makeUmdFixture, umdData, umdNumbers, umdSection } from "./umd-fixture";

function replaceCompressed(bytes: Buffer, replacement: Buffer): Buffer {
  let offset = 4;
  while (offset < bytes.length) {
    const size = bytes[offset] === 0x23 ? bytes[offset + 4] : bytes.readUInt32LE(offset + 5);
    if (bytes[offset] === 0x24 && bytes.readUInt32LE(offset + 1) === 0x1000) {
      const body = Buffer.concat([bytes.subarray(0, offset), umdData(0x1000, replacement), bytes.subarray(offset + size, bytes.length - 9)]);
      return Buffer.concat([body, umdSection(0x0c, umdNumbers([body.length + 9]))]);
    } offset += size;
  }
  throw new Error("fixture未找到正文数据");
}

describe("UMD受限异步解压与章节保真", () => {
  it("跨块UTF16字节、中文emoji与换行原样保留，来源哈希来自完整原件", async () => {
    const bytes = makeUmdFixture({ indexOrder: [1, 0] }); const result = await parseUmd(bytes);
    expect(result).toMatchObject({ kind: "text", title: "UMD本地自造样本", author: "测试作者", sourceSize: bytes.length,
      sourceHash: createHash("sha256").update(bytes).digest("hex") });
    expect(result.chapters.map(chapter => chapter.text)).toEqual(["中文与emoji😀。\u2029逐字保留 <公式>&符号。\r\n", "第二段正文。\n结尾。"]);
    expect(result.chapters[0].endByte).toBe(result.chapters[1].startByte);
    expect(result.chapters.at(-1)!.endByte).toBe(result.declaredBytes);
  });
  it("调用后修改原Buffer不改变已校验快照", async () => {
    const input = makeUmdFixture(); const hash = createHash("sha256").update(input).digest("hex");
    const pending = parseUmd(input); input.fill(0); expect((await pending).sourceHash).toBe(hash);
  });
  it("实际展开超声明预算立即拒绝，不能先完整解压再裁短", async () => {
    await expect(parseUmd(replaceCompressed(makeUmdFixture(), deflateSync(Buffer.alloc(1024 * 1024, 65)))))
      .rejects.toThrow("超限");
  });
  it("缺字节、坏checksum和压缩流尾随数据都拒绝", async () => {
    const bytes = makeUmdFixture();
    await expect(parseUmd(replaceCompressed(bytes, deflateSync(Buffer.from([65]))))).rejects.toThrow("长度");
    await expect(parseUmd(replaceCompressed(bytes, Buffer.from([0x78, 0x9c, 0])))).rejects.toThrow("压缩");
    await expect(parseUmd(replaceCompressed(bytes, Buffer.concat([deflateSync(Buffer.from([65])), Buffer.from([0])])))).rejects.toThrow("尾随");
  });
  it("章节边界不能把代理对切成两章", async () => {
    const chapters = [{ title: "甲", text: "\ud83d" }, { title: "乙", text: "\ude00" }];
    await expect(parseUmd(makeUmdFixture({ chapters, textParts: [Buffer.from("😀", "utf16le")] }))).rejects.toThrow("损坏");
  });
  it("坏UTF16或未支持封面类型不静默替换", async () => {
    await expect(parseUmd(makeUmdFixture({ chapters: [{ title: "甲", text: "\ud800" }], textParts: [Buffer.from([0, 0xd8])] }))).rejects.toThrow("损坏");
    await expect(parseUmd(makeUmdFixture({ cover: Buffer.from("<svg onload='danger'/>") }))).rejects.toThrow("PNG/JPEG");
  });
  it("空标题有明确回退，不修改正文", async () => {
    expect((await parseUmd(makeUmdFixture({ title: "" }))).title).toBe("UMD 电子书");
  });
});
