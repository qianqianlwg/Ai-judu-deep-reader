// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { Blob as NodeBlob } from "node:buffer";
import { deflateRaw } from "node:zlib";
import { promisify } from "node:util";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFb2Book } from "./fb2-book";
import { FB2_XML_LIMIT } from "./fb2-xml";
import type { EpubArchive, FoliateBook, FoliateBridge } from "./foliate-types";

const deflate = promisify(deflateRaw);
function crc32(bytes: Uint8Array): number { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
type ZipInput = { name: string; data: Uint8Array };
async function zip(entries: ZipInput[], compressed = false, badCRC = false): Promise<Blob> {
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8"), raw = Buffer.from(entry.data), payload = compressed ? await deflate(raw) : raw;
    const crc = (crc32(raw) ^ (badCRC ? 1 : 0)) >>> 0, method = compressed ? 8 : 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46); header.writeUInt32LE(0x02014b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8); header.writeUInt16LE(method, 10);
    header.writeUInt32LE(crc, 16); header.writeUInt32LE(payload.length, 20); header.writeUInt32LE(raw.length, 24); header.writeUInt16LE(name.length, 28);
    if (entry.name.endsWith("/")) header.writeUInt32LE(0x10, 38); header.writeUInt32LE(offset, 42);
    locals.push(local, name, payload); central.push(header, name); offset += local.length + name.length + payload.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return new Blob([new Uint8Array(Buffer.concat([...locals, directory, end]))]);
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let fixture: Uint8Array, realBridge: FoliateBridge, loadFb2: typeof import("./fb2-loader").loadFb2;
let openArchive: ReturnType<typeof vi.fn<FoliateBridge["openArchive"]>>, handles: EpubArchive[], books: FoliateBook[], blobs: Map<string, Blob>, revoked: Set<string>, counter: number;
async function load(blob: Blob, format: string) { const book = await loadFb2(blob, format); books.push(book); return book; }
async function summary(book: FoliateBook) { return { metadata: book.metadata, toc: book.toc, sections: await Promise.all(book.sections.map(async section => {
  const doc = await section.createDocument(); return { id: section.id, linear: section.linear, paragraphs: [...doc.querySelectorAll("[data-fb2-paragraph]")].map(node => node.textContent?.replace(/\s+/gu, " ").trim()), hrefs: [...doc.querySelectorAll("a")].map(node => node.getAttribute("href")), imageAlts: [...doc.querySelectorAll("img")].map(node => node.getAttribute("alt")) };
})) }; }
beforeAll(async () => { fixture = new Uint8Array(await readFile("src/lib/fixtures/reader.fb2")); const path = "../../public/vendor/foliate/bridge.js"; realBridge = await import(path) as FoliateBridge; });
beforeEach(async () => {
  vi.resetModules(); vi.stubGlobal("Blob", NodeBlob); vi.stubGlobal("CSS", { escape: (value: string) => value });
  handles = []; books = []; blobs = new Map(); revoked = new Set(); counter = 0;
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((blob: Blob) => { const url = `blob:fb2-loader-${++counter}`; blobs.set(url, blob); return url; }) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn((url: string) => revoked.add(url)) });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("FB2验收禁止网络/真实书/AI"); }));
  openArchive = vi.fn(async blob => { const archive = await realBridge.openArchive(blob), close = vi.fn(() => archive.close()), tracked = { ...archive, close }; handles.push(tracked); return tracked; });
  // WHY：只包装真实bridge的close计数；ZIP解压/CRC/路径校验都运行产品实现，不改blob运输或依赖模块。
  const actualWindow = window; vi.stubGlobal("window", { __juduFoliate: { ...realBridge, openArchive }, setTimeout: actualWindow.setTimeout.bind(actualWindow), clearTimeout: actualWindow.clearTimeout.bind(actualWindow) });
  ({ loadFb2 } = await import("./fb2-loader"));
});
afterEach(async () => { for (const book of books) book.destroy?.(); for (const archive of handles) if (!vi.mocked(archive.close).mock.calls.length) await archive.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("真实FB2/FBZ加载链路", () => {
  it("raw FB2模型与解析结果相同，不走ZIP桥或网络", async () => {
    const book = await load(new Blob([new Uint8Array(fixture)]), "fb2"), parsed = parseFb2Book(fixture), value = await summary(book);
    expect(value.metadata).toEqual({ title: parsed.title, author: parsed.author, language: parsed.language });
    expect(value.sections.map(section => section.paragraphs)).toEqual(parsed.sections.map(section => section.paragraphs)); expect(openArchive).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([false, true])("真实ZIP压缩=%s的FBZ与raw FB2正文/目录/引用/图片模型一致", async compressed => {
    const archive = await zip([{ name: "reader.fb2", data: fixture }], compressed), raw = await load(new Blob([new Uint8Array(fixture)]), ".fb2"), fbz = await load(archive, ".fbz");
    expect(await summary(fbz)).toEqual(await summary(raw)); expect(openArchive).toHaveBeenCalledExactlyOnceWith(archive);
    expect(handles[0].close).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["fbz", ".FBZ", "fb2.zip", ".FB2.ZIP"])("%s扩展名走真实安全ZIPbridge", async format => {
    const archive = await zip([{ name: "目录/", data: new Uint8Array() }, { name: "目录/READER.FB2", data: fixture }]);
    const book = await load(archive, format); expect(book.sections).toHaveLength(3); expect(openArchive).toHaveBeenCalledOnce(); expect(handles[0].close).toHaveBeenCalledOnce();
  });
  it("FBZ无EPUB mimetype/container也能读取，不能伪造EPUB再交错误解析器", async () => {
    const book = await load(await zip([{ name: "reader.fb2", data: fixture }]), "fbz");
    expect(book.sections.map(section => section.id)).toEqual(["fb2-v1/section-0.xhtml", "fb2-v1/section-1.xhtml", "fb2-v1/section-2.xhtml"]);
    expect(book.metadata?.title).toBe("FB2 本地完整性验收"); expect(document.querySelector("script[data-judu-foliate]")).toBeNull();
  });
  it("UTF16原始FB2按XML编码解析，不用blob.text错解", async () => {
    const text = Buffer.from(fixture).toString("utf8").replace('encoding="UTF-8"', 'encoding="UTF-16"');
    const encoded = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    const book = await load(new Blob([new Uint8Array(encoded)]), "fb2"); expect(book.metadata?.title).toBe("FB2 本地完整性验收");
    expect((await book.sections[0].createDocument()).body.textContent).toContain("😀增补字符");
  });
});

describe("FBZ错误归属、安全校验和archive cleanup", () => {
  it("超过24MiB的raw FB2在读取或资源分配前拒绝", async () => {
    const blob = new Blob([new Uint8Array(FB2_XML_LIMIT + 1)]), read = vi.spyOn(blob, "arrayBuffer");
    await expect(load(blob, "fb2")).rejects.toThrow("24MiB"); expect(read).not.toHaveBeenCalled(); expect(blobs.size).toBe(0);
  });
  it.each(["../reader.fb2", "/reader.fb2", "dir\\reader.fb2"])("不安全ZIP路径%s在打开bridge前拒绝", async name => {
    await expect(load(await zip([{ name, data: fixture }]), "fbz")).rejects.toThrow(); expect(openArchive).not.toHaveBeenCalled(); expect(blobs.size).toBe(0);
  });
  it("ZIP含多个FB2文档不猜正文，拒绝前不创建资源", async () => {
    await expect(load(await zip([{ name: "a.fb2", data: fixture }, { name: "b.fb2", data: fixture }]), "fbz")).rejects.toThrow("一个FB2"); expect(openArchive).not.toHaveBeenCalled();
  });
  it("FBZ带额外资源文件也拒绝，不绕过唯一文档规则", async () => {
    await expect(load(await zip([{ name: "a.fb2", data: fixture }, { name: "evil.html", data: new Uint8Array([1]) }]), "fbz")).rejects.toThrow("一个FB2"); expect(openArchive).not.toHaveBeenCalled();
  });
  it("CRC真实损坏由固定版ZIP引擎拒绝并关闭archive", async () => {
    await expect(load(await zip([{ name: "reader.fb2", data: fixture }], true, true), "fbz")).rejects.toThrow();
    expect(openArchive).toHaveBeenCalledOnce(); expect(handles).toHaveLength(1); expect(handles[0].close).toHaveBeenCalledOnce(); expect(blobs.size).toBe(0);
  });
  it("ZIP结构截断拒绝，不启动解压或静默回落rawXML", async () => {
    const good = await zip([{ name: "reader.fb2", data: fixture }]), bad = good.slice(0, good.size - 9);
    await expect(load(bad, "fbz")).rejects.toThrow(); expect(openArchive).not.toHaveBeenCalled(); expect(blobs.size).toBe(0);
  });
  it("有效ZIP中的非法XML关闭archive后明确失败，不分配图片", async () => {
    const source = Buffer.from(fixture).toString("utf8").replace("</FictionBook>", "");
    await expect(load(await zip([{ name: "reader.fb2", data: new Uint8Array(Buffer.from(source)) }]), "fbz")).rejects.toThrow();
    expect(handles[0].close).toHaveBeenCalledOnce(); expect(blobs.size).toBe(0);
  });
  it("ZIP条目read拒绝仍执行finally.close并保留原错误", async () => {
    const failure = new Error("受控条目读取失败"); openArchive.mockImplementationOnce(async blob => {
      const archive = await realBridge.openArchive(blob), close = vi.fn(() => archive.close()); const tracked = { ...archive, entries: archive.entries.map(entry => ({ ...entry, read: vi.fn(async () => { throw failure; }) })), close }; handles.push(tracked); return tracked;
    });
    await expect(load(await zip([{ name: "reader.fb2", data: fixture }]), "fbz")).rejects.toBe(failure); expect(handles[0].close).toHaveBeenCalledOnce(); expect(blobs.size).toBe(0);
  });
  it("archive关闭失败不能返回仍占用资源的成功书籍", async () => {
    const failure = new Error("受控关闭失败"); openArchive.mockImplementationOnce(async blob => {
      const archive = await realBridge.openArchive(blob), close = vi.fn(async () => { await archive.close(); throw failure; }); const tracked = { ...archive, close }; handles.push(tracked); return tracked;
    });
    await expect(load(await zip([{ name: "reader.fb2", data: fixture }]), "fbz")).rejects.toBe(failure); expect(blobs.size).toBe(0); expect(handles[0].close).toHaveBeenCalledOnce();
  });
  it("解压库条目与中央目录不一致被validateArchive拒绝并清理", async () => {
    openArchive.mockImplementationOnce(async blob => {
      const archive = await realBridge.openArchive(blob), close = vi.fn(() => archive.close()); const tracked = { ...archive, entries: archive.entries.map(entry => ({ ...entry, uncompressedSize: entry.uncompressedSize + 1 })), close }; handles.push(tracked); return tracked;
    });
    await expect(load(await zip([{ name: "reader.fb2", data: fixture }]), "fbz")).rejects.toThrow(); expect(handles[0].close).toHaveBeenCalledOnce(); expect(blobs.size).toBe(0);
  });
});

describe("加载后原生blob和迟到资源归属", () => {
  it("FBZ章节blob与内嵌图片在destroy全部撤销，archive早已关闭", async () => {
    const book = await load(await zip([{ name: "reader.fb2", data: fixture }], true), "fbz"); expect(handles[0].close).toHaveBeenCalledOnce();
    await Promise.all(book.sections.map(section => section.load())); const owned = [...blobs.keys()]; expect(owned).toHaveLength(4);
    book.destroy!(); expect([...revoked].sort()).toEqual(owned.sort()); await expect(book.sections[0].load()).rejects.toThrow("已销毁");
  });
  it("FBZ读取延后时不提前关闭archive或分配章节，完成后交回可销毁的所有权", async () => {
    const gate = deferred<Uint8Array<ArrayBuffer>>(); let reading = false;
    openArchive.mockImplementationOnce(async blob => {
      const archive = await realBridge.openArchive(blob), close = vi.fn(() => archive.close()); const tracked = { ...archive, entries: archive.entries.map(entry => ({ ...entry, read: vi.fn(async () => { reading = true; return gate.promise; }) })), close }; handles.push(tracked); return tracked;
    });
    const pending = load(await zip([{ name: "reader.fb2", data: fixture }]), "fbz"); await vi.waitFor(() => expect(reading).toBe(true));
    expect(blobs.size).toBe(0); expect(handles[0].close).not.toHaveBeenCalled(); gate.resolve(new Uint8Array(fixture));
    const book = await pending; expect(handles[0].close).toHaveBeenCalledOnce(); book.destroy!(); expect(revoked.size).toBe(blobs.size);
  });
});

describe("未知FB2容器格式不得隐式当raw XML加载", () => {
  it.each(["", "zip", "epub", "application/fb2+xml"])("未知格式%s即使内容为有效FB2也在读取前拒绝", async format => {
    const original = new Blob([new Uint8Array(fixture)]), read = vi.spyOn(original, "arrayBuffer");
    await expect(load(original, format)).rejects.toThrow("不支持的FB2容器格式");
    expect(read).not.toHaveBeenCalled(); expect(openArchive).not.toHaveBeenCalled(); expect(blobs.size).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
});
