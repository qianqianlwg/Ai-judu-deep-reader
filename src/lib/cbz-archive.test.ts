import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import sharp from "sharp";
import { cbzSourceHref } from "./cbz-manifest";
import { inspectCbzArchive, readCbzPage } from "./cbz-archive";
async function picture(format: "png" | "jpeg", color: { r: number; g: number; b: number } = { r: 30, g: 80, b: 140 }): Promise<Buffer> {
  return sharp({ create: { width: 3, height: 2, channels: 3, background: color } }).toFormat(format).toBuffer();
}
async function archive(entries: readonly { name: string; bytes: Buffer | string }[], compression: "STORE" | "DEFLATE" = "STORE"): Promise<Buffer> {
  const zip = new JSZip(); for (const entry of entries) zip.file(entry.name, entry.bytes, { compression, createFolders: false });
  return zip.generateAsync({ type: "nodebuffer", compression });
}
function duplicateCentralRecord(bytes: Buffer, name: string): Buffer {
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]), eocd = bytes.lastIndexOf(signature); if (eocd < 0) throw new Error("缺少EOCD");
  const start = bytes.readUInt32LE(eocd + 16), size = bytes.readUInt32LE(eocd + 12); let at = start, record: Buffer | undefined;
  while (at < start + size) { if (bytes.readUInt32LE(at) !== 0x02014b50) throw new Error("目录损坏"); const nameLength = bytes.readUInt16LE(at + 28), extraLength = bytes.readUInt16LE(at + 30), commentLength = bytes.readUInt16LE(at + 32); if (bytes.subarray(at + 46, at + 46 + nameLength).toString() === name) { record = bytes.subarray(at, at + 46 + nameLength + extraLength + commentLength); break; } at += 46 + nameLength + extraLength + commentLength; }
  if (!record) throw new Error("找不到目录项"); const result = Buffer.concat([bytes.subarray(0, eocd), record, bytes.subarray(eocd)]), newEocd = eocd + record.length, count = result.readUInt16LE(newEocd + 10);
  result.writeUInt16LE(count + 1, newEocd + 8); result.writeUInt16LE(count + 1, newEocd + 10); result.writeUInt32LE(size + record.length, newEocd + 12); return result;
}
function mutateEntryPayload(bytes: Buffer, original: Buffer): Buffer {
  const result = Buffer.from(bytes), at = result.indexOf(original); if (at < 0) throw new Error("找不到存储条目数据"); result[at + Math.min(10, original.length - 1)] ^= 0x01; return result;
}
async function fixture() {
  const first = await picture("png", { r: 30, g: 80, b: 140 }), second = await picture("jpeg", { r: 200, g: 70, b: 40 });
  const bytes = await archive([{ name: "page10.jpg", bytes: second }, { name: "page2.png", bytes: first }, { name: "ComicInfo.xml", bytes: "<ComicInfo><Title>元数据</Title></ComicInfo>" }]);
  return { bytes, first, second };
}

describe("CBZ归档导入与原始页读取", () => {
  it("真实PNG/JPEG归档检查按manifest顺序返回，元数据不成为页面", async () => {
    const f = await fixture(), pages = await inspectCbzArchive(f.bytes);
    expect(pages.map(page => ({ page: page.page, name: page.name, href: page.sourceHref }))).toEqual([
      { page: 1, name: "page2.png", href: cbzSourceHref("page2.png") }, { page: 2, name: "page10.jpg", href: cbzSourceHref("page10.jpg") },
    ]);
  });
  it("readCbzPage按page+完整sourceHref读取原始bytes，未重编码且返回sharp信息", async () => {
    const f = await fixture(), result = await readCbzPage(f.bytes, 1, cbzSourceHref("page2.png"));
    expect(result.bytes).toEqual(f.first); expect(result.info).toEqual({ width: 3, height: 2, mime: "image/png" });
    const jpeg = await readCbzPage(f.bytes, 2, cbzSourceHref("page10.jpg")); expect(jpeg.bytes).toEqual(f.second); expect(jpeg.info.mime).toBe("image/jpeg");
  });
  it("sourceHref不匹配、页码0/越界都在解压目标前拒绝", async () => {
    const f = await fixture(); await expect(readCbzPage(f.bytes, 1, cbzSourceHref("page10.jpg"))).rejects.toThrow(/来源/);
    await expect(readCbzPage(f.bytes, 0, cbzSourceHref("page2.png"))).rejects.toThrow(/页码/); await expect(readCbzPage(f.bytes, 3, cbzSourceHref("page2.png"))).rejects.toThrow(/页码/);
  });
  it("目标页CRC篡改拒绝，不能只相信manifest和图片header", async () => {
    const f = await fixture(), broken = mutateEntryPayload(f.bytes, f.first); await expect(readCbzPage(broken, 1, cbzSourceHref("page2.png"))).rejects.toThrow(/CRC|校验/);
  });
  it("完整归档检查会验证每一页，而按需读取目标页不inflate损坏的无关页", async () => {
    const f = await fixture(), brokenOther = mutateEntryPayload(f.bytes, f.second);
    await expect(inspectCbzArchive(brokenOther)).rejects.toThrow(/CRC|校验|格式/);
    const result = await readCbzPage(brokenOther, 1, cbzSourceHref("page2.png")); expect(result.bytes).toEqual(f.first);
  });
  it("DEFLATE归档仍做CRC和真实sharp校验，目标原始bytes保持压缩后解码结果", async () => {
    const f = await fixture(), compressed = await archive([{ name: "page2.png", bytes: f.first }, { name: "page10.jpg", bytes: f.second }], "DEFLATE");
    const result = await readCbzPage(compressed, 2, cbzSourceHref("page10.jpg")); expect(result.bytes).toEqual(f.second); await expect(inspectCbzArchive(compressed)).resolves.toHaveLength(2);
  });
  it("重复中央目录项造成同名/同数据范围重叠时拒绝，不选首项", async () => {
    const f = await fixture(), duplicate = duplicateCentralRecord(f.bytes, "page2.png");
    await expect(inspectCbzArchive(duplicate)).rejects.toThrow(/重复|重叠|目录/); await expect(readCbzPage(duplicate, 1, cbzSourceHref("page2.png"))).rejects.toThrow();
  });
  it.each(["README.txt", "page.svg", "page.pdf", "script.js"])("未知归档条目%s拒绝，不偷偷导入其余正文", async name => {
    const f = await fixture(), bytes = await archive([{ name: "page1.png", bytes: f.first }, { name, bytes: "主动或未知内容" }]);
    await expect(inspectCbzArchive(bytes)).rejects.toThrow(/不支持/);
  });
  it("危险路径和绝对路径不能绕过ZIP预检", async () => {
    const f = await fixture();
    for (const name of ["../page.png", "/page.png", "a/../page.png"]) { const bytes = await archive([{ name, bytes: f.first }]); await expect(inspectCbzArchive(bytes)).rejects.toThrow(); }
  });
  it("没有图片页、空归档和只含元数据明确失败", async () => {
    await expect(inspectCbzArchive(await archive([{ name: "ComicInfo.xml", bytes: "<ComicInfo/>" }]))).rejects.toThrow(/没有支持/);
    await expect(inspectCbzArchive(Buffer.alloc(0))).rejects.toThrow();
  });
});
