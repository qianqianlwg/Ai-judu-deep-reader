// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import JSZip from "jszip";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { UmdBook, UmdCover, UmdTextChapter } from "./umd-parser";
import { createUmdEpub } from "./umd-epub";
import { validateEpubImport } from "./epub-import-security";
import { EPUB_LIMITS, inspectZip } from "./epub-security-zip";
import { parseEpubFile } from "./epub-parser";

type XmlWindow = { document: Document; close(): void };
type XmlModule = { JSDOM: new (source: string, options: { contentType: string }) => { window: XmlWindow } };
function isXmlModule(value: unknown): value is XmlModule {
  return value !== null && typeof value === "object" && "JSDOM" in value && typeof value.JSDOM === "function";
}
// WHY：只加载项目已有jsdom；在缺少外部类型声明时明确验证模块边界，不安装依赖或引入any。
const xmlModule: unknown = createRequire(import.meta.url)("jsdom");
if (!isXmlModule(xmlModule)) throw new Error("本地jsdom模块无效");
const { JSDOM } = xmlModule;
const windows: XmlWindow[] = [];
afterEach(() => { for (const window of windows.splice(0)) window.close(); });

const MIB = 1024 * 1024;
const sourceHash = createHash("sha256").update("自造 UMD 来源身份，不是合法 UMD 二进制").digest("hex");
let directory: string;
let sequence = 0;
beforeAll(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "judu-umd-epub-")); });
afterAll(async () => {
  if (!directory) return;
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("judu-umd-epub-")) throw new Error("测试清理路径不安全");
  await rm(resolved, { recursive: true, force: true });
});

// WHY：只构造转换器的类型输入；不导入或执行主代理正在实现的UMD解析器。
function book(texts = ["中文第一段 🐉。\n第二行。\n\n  保留缩进\t与制表。", "第二章正文😀。"]): UmdBook {
  let offset = 0;
  const chapters = texts.map((text, index) => {
    const startByte = offset;
    offset += Buffer.byteLength(text, "utf16le");
    return { title: `第${index + 1}章`, text, startByte, endByte: offset };
  });
  return { kind: "text", title: "自造转换书😀", author: "自造作者", sourceHash, sourceSize: 1024, declaredBytes: offset, chapters };
}

function forged(input: unknown): UmdBook { return input as UmdBook; }
function oneChapter(changes: Partial<UmdTextChapter>): UmdBook {
  const input = book(["测试正文"]);
  return { ...input, chapters: [{ ...input.chapters[0], ...changes }] };
}
async function content(zip: JSZip, name: string): Promise<string> {
  const entry = zip.file(name);
  if (!entry) throw new Error(`缺少ZIP条目：${name}`);
  return entry.async("string");
}
function xml(value: string): Document {
  const dom = new JSDOM(value, { contentType: "application/xml" });
  windows.push(dom.window);
  const document = dom.window.document;
  expect(document.querySelector("parsererror")).toBeNull();
  return document;
}
async function cover(format: "png" | "jpeg"): Promise<UmdCover> {
  return { mediaType: `image/${format}`, bytes: await sharp({ create: { width: 8, height: 6, channels: 3, background: "#6478ab" } }).toFormat(format).toBuffer() };
}
async function roundTrip(input: UmdBook) {
  const result = await createUmdEpub(input);
  await validateEpubImport(result.epub);
  const filename = path.join(directory, `synthetic-${sequence++}.epub`);
  await writeFile(filename, result.epub);
  return { ...result, parsed: await parseEpubFile(filename) };
}

describe("UMD → EPUB2 可复现转换", () => {
  it("mimetype是首个STORE条目，没有extra/descriptor，所有条目固定UTC日期", async () => {
    const result = await createUmdEpub(book());
    const bytes = result.epub;
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.readUInt16LE(6) & 8).toBe(0);
    expect(bytes.readUInt16LE(8)).toBe(0);
    expect(bytes.readUInt16LE(28)).toBe(0);
    expect(bytes.subarray(30, 38).toString()).toBe("mimetype");
    expect(bytes.subarray(38, 58).toString()).toBe("application/epub+zip");
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
    expect(Object.keys(zip.files)).toEqual(["mimetype", "META-INF/container.xml", "OPS/package.opf", "OPS/toc.ncx", "OPS/chapter-0001.xhtml", "OPS/chapter-0002.xhtml"]);
    for (const entry of Object.values(zip.files)) {
      expect(entry.date.toISOString()).toBe("1980-01-01T00:00:00.000Z");
      expect(entry.dir).toBe(false);
    }
    await expect(validateEpubImport(bytes)).resolves.toBeUndefined();
    expect((await inspectZip(new Blob([new Uint8Array(bytes)]))).size).toBe(6);
  });

  it("生成EPUB2/NCX及有序spine，来源范围与稳定路径一一对应", async () => {
    const input = book();
    const result = await createUmdEpub(input);
    expect(result.sourceHash).toBe(sourceHash);
    expect(result.converterVersion).toBe("umd-epub-v1");
    expect(result.chapters).toEqual(input.chapters.map((chapter, index) => ({
      href: `OPS/chapter-000${index + 1}.xhtml`, startByte: chapter.startByte, endByte: chapter.endByte,
    })));
    const zip = await JSZip.loadAsync(result.epub);
    const opf = xml(await content(zip, "OPS/package.opf"));
    expect(opf.documentElement.getAttribute("version")).toBe("2.0");
    expect(opf.querySelector("spine")?.getAttribute("toc")).toBe("ncx");
    expect(Array.from(opf.querySelectorAll("itemref"), item => item.getAttribute("idref"))).toEqual(["chapter-0001", "chapter-0002"]);
    expect(opf.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "source")[0]?.textContent).toBe(`urn:sha256:${sourceHash}`);
    expect(opf.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "description")[0]?.textContent).toContain("不代表原始排版");
    const ncx = xml(await content(zip, "OPS/toc.ncx"));
    expect(Array.from(ncx.querySelectorAll("navPoint content"), item => item.getAttribute("src"))).toEqual(["chapter-0001.xhtml", "chapter-0002.xhtml"]);
    const identifier = opf.querySelector('[id="book-id"]')?.textContent;
    expect(ncx.querySelector('[name="dtb:uid"]')?.getAttribute("content")).toBe(identifier);
    expect(ncx.querySelector("docTitle text")?.textContent).toBe(input.title);
  });

  it("不修剪章名/正文，中文emoji、BOM、空行、tab、CRLF及段分隔符保持文本内容", async () => {
    const original = "\ufeff  开头🐉\t\r\n\r第二行\n\n尾部😀\u2029  ";
    const input = book([original]); input.chapters[0].title = "  第一章\r\n😀  ";
    const result = await createUmdEpub(input);
    const zip = await JSZip.loadAsync(result.epub);
    const doc = xml(await content(zip, result.chapters[0].href));
    expect(doc.querySelector("h1")?.textContent).toBe(input.chapters[0].title);
    expect(doc.querySelector("#umd-body")?.textContent).toBe(original);
    expect(doc.querySelectorAll("#umd-body p")).toHaveLength(6);
    expect(doc.querySelectorAll("#umd-body p")[1].textContent).toBe("");
  });

  it.each([
    ["A\r\nB", "A\nB"], ["A\nB", "A\r\nB"], ["\ufeff甲😀", "甲😀"],
  ])("拒绝原始文本%j变成%j但范围未变，不隐式猜测规范化映射", async (source, changed) => {
    const input = book([source]); input.chapters[0].text = changed;
    await expect(createUmdEpub(input)).rejects.toThrow("UTF-16LE字节长度与来源范围不一致");
  });

  it("拒绝首部缺失，即使每个保留章节的文本和范围各自匹配", async () => {
    const input = book(["甲", "乙😀"]); input.chapters.shift();
    expect(input.chapters[0].endByte - input.chapters[0].startByte).toBe(input.chapters[0].text.length * 2);
    await expect(createUmdEpub(input)).rejects.toThrow("首章来源必须从0开始");
  });

  it("拒绝中间缺口，即使首尾覆盖且每章文本字节数匹配", async () => {
    const input = book(["甲", "乙😀", "丙"]); input.chapters.splice(1, 1);
    expect(input.chapters[0].startByte).toBe(0);
    expect(input.chapters.at(-1)?.endByte).toBe(input.declaredBytes);
    await expect(createUmdEpub(input)).rejects.toThrow("中间缺口");
  });

  it("拒绝尾部缺失，即使已保留章节从0开始连续且文本长度匹配", async () => {
    const input = book(["甲😀", "乙"]); input.chapters.pop();
    await expect(createUmdEpub(input)).rejects.toThrow("末章来源未覆盖declaredBytes");
  });

  it("相同输入重复/并发转换字节完全一致，输入不被改写", async () => {
    const input = { ...book(), cover: await cover("png") };
    const before = { ...input, chapters: input.chapters.map(chapter => ({ ...chapter })), cover: { ...input.cover, bytes: Buffer.from(input.cover.bytes) } };
    const [first, second] = await Promise.all([createUmdEpub(input), createUmdEpub(input)]);
    expect(first.epub.equals(second.epub)).toBe(true);
    expect(first).toEqual(second);
    expect(input).toEqual(before);
  });

  it("await前快照输入，调用者后续改对象/章节/封面不改变结果", async () => {
    const input = { ...book(), cover: await cover("png") };
    const expected = await createUmdEpub(input);
    const pending = createUmdEpub(input);
    input.title = "被修改"; input.chapters[0].text = "被篡改";
    input.chapters.reverse(); input.cover.bytes.fill(0); input.sourceHash = "0".repeat(64);
    expect((await pending).epub.equals(expected.epub)).toBe(true);
  });

  it("无章名仍保留正文和确定性导航标签", async () => {
    const input = oneChapter({ title: "" });
    const result = await roundTrip(input);
    expect(result.parsed.chapters[0]).toMatchObject({ title: "第 1 章", paragraphs: ["测试正文"], sourceHref: "OPS/chapter-0001.xhtml" });
  });
});

describe("XHTML/XML数据不能成为标记或路径", () => {
  it("转义HTML、XML实体/DOCTYPE/处理指令，不产生脚本/网络/iframe", async () => {
    const attack = '<script>alert(1)</script><img src="https://evil.test/a" onerror="alert(2)"/><iframe src="/api/delete"/>\n<!DOCTYPE x [<!ENTITY ex SYSTEM "file:///secret">]><?xml-stylesheet href="evil"?>\n&amp; &lt; > " \' ]]> 🐉';
    const input = book([attack]); input.title = '书 & <title> " \' 🐉\r\n'; input.author = '作者 & <a>"\'';
    input.chapters[0].title = '../../目录<script>😀 & "';
    const result = await createUmdEpub(input), zip = await JSZip.loadAsync(result.epub);
    const doc = xml(await content(zip, result.chapters[0].href));
    expect(doc.querySelector("#umd-body")?.textContent).toBe(attack);
    expect(doc.querySelectorAll("script,img,iframe,object,a,base,form")).toHaveLength(0);
    expect(Array.from(doc.querySelectorAll("*"), element => Array.from(element.attributes).map(a => a.name)).flat()).not.toContain("onerror");
    expect(Object.keys(zip.files).every(name => !name.includes("..") && !name.includes("<"))).toBe(true);
    const opf = xml(await content(zip, "OPS/package.opf"));
    expect(opf.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "title")[0].textContent).toBe(input.title);
    expect(opf.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "creator")[0].textContent).toBe(input.author);
    const ncx = xml(await content(zip, "OPS/toc.ncx"));
    expect(ncx.querySelector("navLabel text")?.textContent).toBe(input.chapters[0].title);
  });

  it.each(["\u0000", "\u0001", "\u000b", "\u000c", "\u001f", "\ufffe", "\uffff", "\ud800", "\udfff", "\ud800A"])("拒绝非法XML字符/孤立代理项 %j", async bad => {
    for (const input of [book([bad]), { ...book(), title: bad }, { ...book(), author: bad }, oneChapter({ title: bad })]) {
      await expect(createUmdEpub(input)).rejects.toThrow(/XML|代理/);
    }
  });
});

describe("可选封面必须是完整真实栅格图像", () => {
  it.each(["png", "jpeg"] as const)("完整解码%s、生成cover metadata/guide，并与真实EPUB提取闭环", async format => {
    const image = await cover(format), input = { ...book(), cover: image };
    const result = await roundTrip(input), zip = await JSZip.loadAsync(result.epub);
    const name = `OPS/cover.${format === "jpeg" ? "jpg" : "png"}`;
    expect(await zip.file(name)!.async("nodebuffer")).toEqual(Buffer.from(image.bytes));
    const opf = xml(await content(zip, "OPS/package.opf"));
    expect(opf.querySelector('meta[name="cover"]')?.getAttribute("content")).toBe("cover-image");
    expect(opf.querySelector('item[id="cover-image"]')?.getAttribute("media-type")).toBe(image.mediaType);
    expect(opf.querySelector("guide reference")?.getAttribute("href")).toBe("cover.xhtml");
    expect(result.parsed.title).toBe(input.title);
    expect(result.parsed.author).toBe(input.author);
    expect(result.parsed.chapters).toHaveLength(2);
    expect(result.parsed.chapters[0].paragraphs).toEqual(["中文第一段 🐉。", "第二行。", "保留缩进 与制表。"]);
    expect(result.parsed.chapters[1]).toMatchObject({ title: "第2章", paragraphs: ["第二章正文😀。"], sourceHref: result.chapters[1].href });
  });

  it("拒绝假PNG、SVG伪装、截断图片、类型不符、空字节及共享可变内存", async () => {
    const png = await cover("png");
    const bad: unknown[] = [
      { mediaType: "image/png", bytes: Buffer.from("\x89PNGfake") },
      { mediaType: "image/png", bytes: Buffer.from('<svg onload="alert(1)"/>') },
      { ...png, bytes: png.bytes.subarray(0, -1) }, { ...png, mediaType: "image/jpeg" },
      { mediaType: "image/png", bytes: new Uint8Array() }, { mediaType: "image/gif", bytes: png.bytes },
      { mediaType: "image/png", bytes: new Uint8Array(new SharedArrayBuffer(12)) },
      { mediaType: "image/png", bytes: Buffer.alloc(24 * MIB + 1) },
      { mediaType: "image/png", bytes: [1, 2, 3] }, null,
    ];
    for (const image of bad) await expect(createUmdEpub(forged({ ...book(), cover: image }))).rejects.toThrow();
  });
});

describe("运行时边界与严格预算", () => {
  it.each([null, undefined, false, 4, "book", [], {}, new Date("1980-01-01T00:00:00Z")])("拒绝伪造非UmdBook输入 %j", async value => {
    await expect(createUmdEpub(forged(value))).rejects.toThrow();
  });
  it.each([
    ["kind", "comic"], ["title", ""], ["title", 42], ["author", null], ["extra", true],
    ["sourceHash", "x".repeat(64)], ["sourceHash", "A".repeat(64)], ["sourceHash", "0".repeat(65)],
    ["sourceSize", 0], ["sourceSize", 100 * MIB + 1], ["sourceSize", NaN], ["sourceSize", Infinity],
    ["declaredBytes", 0], ["declaredBytes", 3], ["declaredBytes", 20 * MIB + 2], ["chapters", []],
    ["chapters", new Array(1025)], ["chapters", new Array(1)], ["chapters", {}],
    ["title", "x".repeat(4097)], ["author", "作".repeat(1400)],
  ] as const)("拒绝字段%s的非法值", async (key, value) => {
    await expect(createUmdEpub(forged({ ...book(), [key]: value }))).rejects.toThrow();
  });
  it.each([
    { startByte: -2 }, { startByte: 1 }, { startByte: 0.5 }, { startByte: "0" }, { endByte: 1 },
    { endByte: 9999 }, { endByte: 0 }, { endByte: NaN }, { text: null }, { title: "a".repeat(4097) },
  ])("拒绝章节字段 %j", async changes => {
    const input = book(["测试正文"]);
    await expect(createUmdEpub(forged({ ...input, chapters: [{ ...input.chapters[0], ...changes }] }))).rejects.toThrow();
  });
  it("拒绝范围重叠、倒序和空文本假范围；不调用getter", async () => {
    const input = book(); input.chapters[1].startByte = input.chapters[0].endByte - 2;
    await expect(createUmdEpub(input)).rejects.toThrow(/重叠/);
    const reversed = book(); reversed.chapters.reverse();
    await expect(createUmdEpub(reversed)).rejects.toThrow("首章来源必须从0开始");
    await expect(createUmdEpub(oneChapter({ text: "" }))).rejects.toThrow("字节长度与来源范围不一致");
    const accessor = book(); let called = false;
    Object.defineProperty(accessor, "title", { get() { called = true; return "trap"; } });
    await expect(createUmdEpub(accessor)).rejects.toThrow("访问器");
    expect(called).toBe(false);
  });
  it("正好1024章通过且所有ZIP路径保持确定性", async () => {
    const input = book(Array.from({ length: 1024 }, () => "短章😀"));
    const result = await createUmdEpub(input);
    expect(result.chapters).toHaveLength(1024);
    expect(result.chapters.at(-1)?.href).toBe("OPS/chapter-1024.xhtml");
    expect((await inspectZip(new Blob([new Uint8Array(result.epub)]))).size).toBe(1028);
  });
  it("NCX目录自身也受2MiB限制，不能通过很多长标题绕过", async () => {
    const input = book(Array.from({ length: 1024 }, () => "x"));
    input.chapters.forEach(chapter => { chapter.title = "x".repeat(2048); });
    await expect(createUmdEpub(input)).rejects.toThrow("XML/XHTML 超过2MiB");
  });
  it("章节数组访问器/伪造原型和非数据字段拒绝", async () => {
    const input = book(); let called = false;
    Object.defineProperty(input.chapters, "0", { get() { called = true; return {}; } });
    await expect(createUmdEpub(input)).rejects.toThrow("访问器");
    expect(called).toBe(false);
    const inherited = Object.create(book()) as unknown;
    await expect(createUmdEpub(forged(inherited))).rejects.toThrow("普通数据对象");
    await expect(createUmdEpub(forged({ ...book(), chapters: [null] }))).rejects.toThrow();
  });
  it("合法连续范围也不能绕过UTF-8合计20MiB文本预算", async () => {
    // WHY：中文UTF-8比UTF-16LE占用更多字节；完整合法范围仍能独立命中累计文本预算，而非来源校验。
    const input = book(Array.from({ length: 14 }, () => "中".repeat(500_000)));
    expect(input.declaredBytes).toBeLessThan(20 * MIB);
    expect(Buffer.byteLength(input.chapters[0].text)).toBeLessThan(2 * MIB);
    expect(input.chapters.reduce((sum, chapter) => sum + Buffer.byteLength(chapter.text), 0)).toBeGreaterThan(20 * MIB);
    await expect(createUmdEpub(input)).rejects.toThrow("正文和元数据超过20MiB文本预算");
    const tooLarge = book(["中".repeat(7 * MIB)]);
    expect(tooLarge.declaredBytes).toBeLessThan(20 * MIB);
    await expect(createUmdEpub(tooLarge)).rejects.toThrow("章节正文无效或超过文本预算");
  });
  it("拒绝单章超2MiB以及转义展开后的XML超限，不产生截断EPUB", async () => {
    await expect(createUmdEpub(book(["x".repeat(2 * MIB + 1)]))).rejects.toThrow("2MiB");
    await expect(createUmdEpub(book(["&".repeat(430_000)]))).rejects.toThrow("2MiB");
  });
  it("高重复正文使用STORE仍符合压缩比限制", async () => {
    const result = await createUmdEpub(book(["中".repeat(100_000)]));
    const record = (await inspectZip(new Blob([new Uint8Array(result.epub)]))).get("OPS/chapter-0001.xhtml");
    expect(record?.compressed).toBe(record?.size);
    expect(result.epub.length).toBeLessThanOrEqual(64 * MIB);
  });
  it("全书段落数有独立上限", async () => {
    const input = book(Array.from({ length: 11 }, () => "x\n".repeat(10_000)));
    await expect(createUmdEpub(input)).rejects.toThrow("100000段落");
  });
  it("生成前拒绝真正超过64MiB的输出，即使正文/每章/封面分别合规", async () => {
    const input = book(Array.from({ length: 32 }, () => '"'.repeat(327_000)));
    const bytes = await sharp({ create: { width: 1280, height: 1536, channels: 3, background: "#abcdef" } })
      .png({ compressionLevel: 0 }).toBuffer();
    input.cover = { bytes, mediaType: "image/png" };
    expect(input.declaredBytes).toBeLessThan(20 * MIB);
    expect(bytes.length).toBeGreaterThan(5 * MIB);
    expect(bytes.length).toBeLessThan(EPUB_LIMITS.entry);
    await expect(createUmdEpub(input)).rejects.toThrow("输出64MiB");
  }, 15_000);
});
