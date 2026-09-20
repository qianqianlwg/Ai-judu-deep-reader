import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { readFb2Archive } from "./fb2-archive";
import { EPUB_LIMITS, inspectZip } from "./epub-security-zip";
import { validateEpubImport, visitValidatedZip } from "./epub-import-security";

const xml = '<?xml version="1.0"?><FictionBook><body><section><p>唯一正文😀</p></section></body></FictionBook>';
const blob = (bytes: Buffer) => new Blob([new Uint8Array(bytes)]);
type Entry = { central: number; local: number; data: number; name: string };
async function archive(name = "raw.FB2", content: string | Buffer = xml, compression: "STORE" | "DEFLATE" = "DEFLATE"): Promise<Buffer> {
  const zip = new JSZip(); zip.file(name, content, { createFolders: false });
  return zip.generateAsync({ type: "nodebuffer", compression });
}
function entries(bytes: Buffer): Entry[] {
  const end = bytes.length - 22;
  if (bytes.readUInt32LE(end) !== 0x06054b50) throw new Error("fixture 必须没有 ZIP 注释");
  const result: Entry[] = [];
  let central = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    if (bytes.readUInt32LE(central) !== 0x02014b50) throw new Error("fixture 中央目录无效");
    const local = bytes.readUInt32LE(central + 42), length = bytes.readUInt16LE(central + 28);
    result.push({ central, local, data: local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28), name: bytes.subarray(central + 46, central + 46 + length).toString("utf8") });
    central += 46 + length + bytes.readUInt16LE(central + 30) + bytes.readUInt16LE(central + 32);
  }
  return result;
}
function one(bytes: Buffer): Entry { const result = entries(bytes)[0]; if (!result) throw new Error("fixture 没有条目"); return result; }
function setSize(bytes: Buffer, size: number) { const entry = one(bytes); bytes.writeUInt32LE(size, entry.central + 24); bytes.writeUInt32LE(size, entry.local + 22); }
function setFlags(bytes: Buffer, flags: number) { const entry = one(bytes); bytes.writeUInt16LE(flags, entry.central + 8); bytes.writeUInt16LE(flags, entry.local + 6); }
function setMethod(bytes: Buffer, method: number) { const entry = one(bytes); bytes.writeUInt16LE(method, entry.central + 10); bytes.writeUInt16LE(method, entry.local + 8); }
function setCrc(bytes: Buffer, crc: number) { const entry = one(bytes); bytes.writeUInt32LE(crc, entry.central + 16); bytes.writeUInt32LE(crc, entry.local + 14); }
function rename(bytes: Buffer, entry: Entry, name: Buffer) {
  if (name.length !== bytes.readUInt16LE(entry.central + 28)) throw new Error("fixture 改名必须等长");
  name.copy(bytes, entry.central + 46); name.copy(bytes, entry.local + 30);
}

describe("FBZ 原生解包和唯一正文", () => {
  it.each(["STORE", "DEFLATE"] as const)("接受 %s，不需要 EPUB mimetype，逐字节返回 raw.FB2", async compression => {
    const bytes = await archive("raw.FB2", xml, compression), before = Buffer.from(bytes);
    const result = await readFb2Archive(bytes);
    expect(Buffer.from(result).equals(Buffer.from(xml))).toBe(true);
    result[0] ^= 1; expect(bytes.equals(before)).toBe(true);
  });
  it("完整样本在内存压缩后解包保持二进制、脚注与增补字符字节不变", async () => {
    const original = await readFile(new URL("./fixtures/reader.fb2", import.meta.url));
    const result = await readFb2Archive(await archive("目录/正文.FB2", original));
    expect(Buffer.from(result).equals(original)).toBe(true);
  });
  it("允许一个嵌套 FB2 加显式空目录，包括后缀像FB2的目录", async () => {
    const zip = new JSZip(); zip.folder("books"); zip.folder("spare.FB2"); zip.file("books/raw.FB2", xml);
    expect(Buffer.from(await readFb2Archive(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }))).toString()).toBe(xml);
  });
  it("允许合法 data descriptor 的流式 ZIP", async () => {
    const zip = new JSZip(); zip.file("raw.FB2", xml);
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", streamFiles: true });
    expect(bytes.readUInt16LE(one(bytes).central + 8) & 8).toBe(8);
    expect(Buffer.from(await readFb2Archive(bytes)).toString()).toBe(xml);
  });
  it("普通 ZIP 注释不影响读取", async () => {
    const zip = new JSZip(); zip.file("raw.FB2", xml);
    expect(Buffer.from(await readFb2Archive(await zip.generateAsync({ type: "nodebuffer", comment: "normal local archive comment" }))).toString()).toBe(xml);
  });
  it.each(["no entries", "directories only", "not FB2", "two FB2", "extra image", "extra mimetype", "mac metadata"])("拒绝 %s，不猜或忽略额外文件", async kind => {
    const zip = new JSZip();
    if (kind === "directories only") zip.folder("raw.FB2");
    if (kind === "not FB2") zip.file("raw.xml", xml);
    if (["two FB2", "extra image", "extra mimetype", "mac metadata"].includes(kind)) {
      zip.file("raw.FB2", xml);
      zip.file(kind === "two FB2" ? "second.fb2" : kind === "extra image" ? "cover.png" : kind === "extra mimetype" ? "mimetype" : "__MACOSX/._raw.FB2", "extra", { createFolders: false });
    }
    await expect(readFb2Archive(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toThrow();
  });
  it.each([Buffer.alloc(0), Buffer.from(xml), Buffer.from("PK\u0003\u0004")])("原始XML或截断ZIP不能冒充压缩文档 %#", async bytes => {
    await expect(readFb2Archive(bytes)).rejects.toThrow();
  });
});

describe("FBZ 大小/压缩比/CRC 必须基于实际输出", () => {
  it("高压缩比在解压前拒绝", async () => {
    const bytes = await archive("raw.FB2", "x".repeat(1024 * 1024));
    expect(bytes.length).toBeLessThan(4000);
    await expect(readFb2Archive(bytes)).rejects.toThrow("压缩比");
  });
  it("同时伪造本地与中央的小size仍受原生 zlib 输出上限约束", async () => {
    const bytes = await archive("raw.FB2", "x".repeat(1024 * 1024)); setSize(bytes, 32);
    await expect(inspectZip(blob(bytes), "fbz")).resolves.toBeInstanceOf(Map);
    await expect(readFb2Archive(bytes)).rejects.toThrow("实际输出超过限制");
  });
  it("受限解压失败前不向访问者交付任何半成品", async () => {
    const bytes = await archive("raw.FB2", "x".repeat(1024 * 1024)); setSize(bytes, 32); const visit = vi.fn();
    await expect(visitValidatedZip(bytes, false, visit)).rejects.toThrow("实际输出超过限制"); expect(visit).not.toHaveBeenCalled();
  });
  it.each([0, Buffer.byteLength(xml) + 1])("声明size=%i但实际输出不同也拒绝", async size => {
    const bytes = await archive(); setSize(bytes, size);
    await expect(readFb2Archive(bytes)).rejects.toThrow(/实际输出超过限制|实际解压大小或 CRC/u);
  });
  it("伪造超过单条目上限的size在分配内容前拒绝", async () => {
    const bytes = await archive(); setSize(bytes, EPUB_LIMITS.entry + 1);
    await expect(readFb2Archive(bytes)).rejects.toThrow("超过限制");
  });
  it("STORE 条目不能虚报解压size", async () => {
    const bytes = await archive("raw.FB2", xml, "STORE"); setSize(bytes, 1);
    await expect(readFb2Archive(bytes)).rejects.toThrow("解压大小");
  });
  it.each(["STORE", "DEFLATE"] as const)("%s 中央和本地伪造相同CRC仍被真实CRC挡住", async compression => {
    const bytes = await archive("raw.FB2", xml, compression); setCrc(bytes, 0);
    await expect(inspectZip(blob(bytes), "fbz")).resolves.toBeInstanceOf(Map);
    await expect(readFb2Archive(bytes)).rejects.toThrow("CRC");
  });
  it("修改STORE正文一字节且保留原CRC必须失败", async () => {
    const bytes = await archive("raw.FB2", xml, "STORE"); bytes[one(bytes).data] ^= 1;
    await expect(readFb2Archive(bytes)).rejects.toThrow("CRC");
  });
  it("损坏DEFLATE数据不可返回部分正文", async () => {
    const bytes = await archive(); bytes.fill(0xff, one(bytes).data, one(bytes).data + 5);
    await expect(readFb2Archive(bytes)).rejects.toThrow();
  });
});

describe("FBZ 目录、本地头和路径一致性", () => {
  it.each(["../raw.fb2", "/raw.fb2", "a/../raw.fb2", "a//raw.fb2", "a\\raw.fb2", "C:raw.fb2", "./raw.fb2", "a/%2e%2e/raw.fb2", "a/raw#x.fb2", "a/raw?x.fb2", "raw\u0000.fb2", "e\u0301.fb2"])("拒绝不安全路径 %j", async path => {
    await expect(readFb2Archive(await archive(path))).rejects.toThrow(/路径/u);
  });
  it("UTF-8标志存在时允许中文正文路径", async () => {
    const bytes = await archive("中文.FB2"); expect(bytes.readUInt16LE(one(bytes).central + 8) & 2048).toBe(2048);
    expect(Buffer.from(await readFb2Archive(bytes)).toString()).toBe(xml);
  });
  it("非ASCII文件名缺UTF-8标志时拒绝，不能容忍不同解码器猜测", async () => {
    const bytes = await archive("中文.FB2"); setFlags(bytes, 0);
    await expect(readFb2Archive(bytes)).rejects.toThrow("UTF-8");
  });
  it("即使有UTF-8标志，非法UTF-8字节仍拒绝", async () => {
    const bytes = await archive(); setFlags(bytes, 2048); const entry = one(bytes), name = Buffer.from("raw.FB2"); name[0] = 0xff; rename(bytes, entry, name);
    await expect(readFb2Archive(bytes)).rejects.toThrow();
  });
  it("中央目录与本地路径不一致时拒绝", async () => {
    const bytes = await archive(); bytes[one(bytes).local + 30] ^= 1;
    await expect(readFb2Archive(bytes)).rejects.toThrow("本地文件头");
  });
  it("同一路径重复记录不能折叠为一个合法正文", async () => {
    const zip = new JSZip(); zip.file("aaa.fb2", xml); zip.file("bbb.fb2", xml);
    const bytes = await zip.generateAsync({ type: "nodebuffer" }); rename(bytes, entries(bytes)[1], Buffer.from("aaa.fb2"));
    await expect(readFb2Archive(bytes)).rejects.toThrow("重复路径");
  });
  it("文件/同名目录冲突拒绝", async () => {
    const zip = new JSZip(); zip.file("raw.fb2", xml); zip.folder("raw.fb2");
    await expect(readFb2Archive(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toThrow("重复路径");
  });
  it("有效小目录头被嵌在正文数据里也不能与正文物理区间重叠", async () => {
    const nested = Buffer.alloc(32); nested.writeUInt32LE(0x04034b50); nested.writeUInt16LE(20, 4); nested.writeUInt16LE(2, 26); nested.write("d/", 30);
    const zip = new JSZip(); zip.file("raw.fb2", Buffer.concat([Buffer.from(xml), nested])); zip.folder("d");
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" }), records = entries(bytes);
    bytes.writeUInt32LE(records[0].data + Buffer.byteLength(xml), records[1].central + 42);
    await expect(readFb2Archive(bytes)).rejects.toThrow("重叠");
  });
  it.each([1, 64, 4096])( "拒绝加密或不支持的flags=%i", async flags => {
    const bytes = await archive(); setFlags(bytes, flags); await expect(readFb2Archive(bytes)).rejects.toThrow("加密");
  });
  it("拒绝未知压缩方法", async () => {
    const bytes = await archive(); setMethod(bytes, 12); await expect(readFb2Archive(bytes)).rejects.toThrow("压缩方法");
  });
  it("中央/本地flags不一致拒绝", async () => {
    const bytes = await archive(); bytes.writeUInt16LE(2048, one(bytes).central + 8);
    await expect(readFb2Archive(bytes)).rejects.toThrow("本地文件头");
  });
  it("无descriptor时中央/本地size及CRC不一致拒绝", async () => {
    const bytes = await archive(); bytes.writeUInt32LE(1, one(bytes).local + 14);
    await expect(readFb2Archive(bytes)).rejects.toThrow("本地大小");
  });
  it("正文压缩区不能延伸进入中央目录", async () => {
    const bytes = await archive(), entry = one(bytes); bytes.writeUInt32LE(bytes.length, entry.central + 20); bytes.writeUInt32LE(bytes.length, entry.local + 18);
    await expect(readFb2Archive(bytes)).rejects.toThrow("本地文件头");
  });
});

describe("FBZ EOCD歧义与EPUB默认门禁隔离", () => {
  it("ZIP注释内嵌第二个EOCD加尾随字节时拒绝双解析器分歧", async () => {
    const outer = await archive(), inner = await archive("inner.fb2", "different body"); outer.writeUInt16LE(inner.length + 1, outer.length - 2);
    const bytes = Buffer.concat([outer, inner, Buffer.from([0])]);
    await expect(readFb2Archive(bytes)).rejects.toThrow("结束记录存在歧义");
  });
  it.each(["trailing", "disk", "count", "directory size", "zip64", "too many entries"])("拒绝EOCD错误：%s", async kind => {
    const bytes = await archive(), end = bytes.length - 22;
    if (kind === "trailing") { await expect(readFb2Archive(Buffer.concat([bytes, Buffer.from([0])]))).rejects.toThrow("结束记录"); return; }
    if (kind === "disk") bytes.writeUInt16LE(1, end + 4);
    if (kind === "count") bytes.writeUInt16LE(2, end + 8);
    if (kind === "directory size") bytes.writeUInt32LE(1, end + 12);
    if (kind === "zip64") bytes.writeUInt32LE(0xffffffff, end + 16);
    if (kind === "too many entries") { bytes.writeUInt16LE(EPUB_LIMITS.entries + 1, end + 8); bytes.writeUInt16LE(EPUB_LIMITS.entries + 1, end + 10); }
    await expect(readFb2Archive(bytes)).rejects.toThrow();
  });
  it("同一无mimetype归档只在显式FBZ路径允许，EPUB默认/显式模式仍拒绝", async () => {
    const bytes = await archive(); await expect(readFb2Archive(bytes)).resolves.toBeInstanceOf(Uint8Array);
    await expect(inspectZip(blob(bytes))).rejects.toThrow("mimetype");
    await expect(inspectZip(blob(bytes), "epub")).rejects.toThrow("mimetype");
    await expect(validateEpubImport(bytes)).rejects.toThrow("mimetype");
    await expect(visitValidatedZip(bytes, true, vi.fn())).rejects.toThrow("mimetype");
  });
});

