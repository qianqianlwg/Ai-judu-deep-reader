import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { inspectZip, assertPackagePath, resolvePackageReference, EPUB_LIMITS, validateArchive } from './epub-security-zip';

async function zip(extra = 'chapter.xhtml') {
  const archive = new JSZip(); archive.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  archive.file(extra, '<p>Hello</p>', { createFolders: false });
  return new Blob([new Uint8Array(await archive.generateAsync({ type: 'uint8array', compression: 'STORE' }))]);
}
describe('EPUB ZIP and path security', () => {
  it('validates a bounded EPUB archive and permits canonical package paths', async () => {
    expect((await inspectZip(await zip())).get('chapter.xhtml')?.size).toBe(12);
    expect(assertPackagePath('EPUB/Chapter 1.xhtml')).toBe('EPUB/Chapter 1.xhtml');
  });
  it.each(['../escape', '/api/book', 'a/../b', 'a//b', 'a\\b', 'a/%2e/b', 'a:b', 'a\0b', './a'])('rejects malicious ZIP path %s', path => {
    expect(() => assertPackagePath(path)).toThrow();
  });
  it.each(['/api/book', '//evil.test/p', 'https://evil.test', 'blob:attacker', 'data:image/svg+xml,bad', '../../escape', '%2fapi/book', '%252e%252e/escape', 'a?x=1', 'a\\b'])('blocks authored network/ambiguous references: %s', path => {
    expect(resolvePackageReference(path, 'EPUB/ch.xhtml')).toBeNull();
  });
  it('resolves encoded local hrefs and preserves fragments', () => {
    expect(resolvePackageReference('../images/a%20b.png#x', 'EPUB/text/ch.xhtml')).toEqual({ path: 'EPUB/images/a b.png', fragment: '#x' });
    expect(resolvePackageReference('#note', 'EPUB/ch.xhtml')).toEqual({ path: 'EPUB/ch.xhtml', fragment: '#note' });
  });
  it('rejects invalid ZIP, oversized input, and missing first mimetype', async () => {
    await expect(inspectZip(new Blob(['not a zip']))).rejects.toThrow('ZIP');
    await expect(inspectZip({ size: EPUB_LIMITS.compressed + 1 } as Blob)).rejects.toThrow('64 MiB');
    const archive = new JSZip(); archive.file('chapter.xhtml', 'x');
    await expect(inspectZip(new Blob([new Uint8Array(await archive.generateAsync({ type: 'uint8array' }))]))).rejects.toThrow('mimetype');
  });
  it('rejects advertised bombs before decompression', async () => {
    const bytes = new Uint8Array(await (await zip()).arrayBuffer()), view = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length - 46; i++) if (view.getUint32(i, true) === 0x02014b50) {
      view.setUint32(i + 24, EPUB_LIMITS.entry + 1, true); break;
    }
    await expect(inspectZip(new Blob([bytes]))).rejects.toThrow();
  });
  it('rejects filename disagreement between independently parsed and decoded directories', () => {
    expect(() => validateArchive({ entries: [{ filename: 'wrong' } as never], close: async () => {} },
      new Map([['right', { name: 'right', compressed: 1, size: 1, directory: false }]]))).toThrow('不一致');
  });
});

describe("FBZ 模式复用不能削弱 ZIP 结构检查和 EPUB 默认规则", () => {
  const asBlob = (bytes: Buffer) => new Blob([new Uint8Array(bytes)]);
  async function make(format: "epub" | "fbz", compression: "STORE" | "DEFLATE" = "STORE") {
    const archive = new JSZip();
    if (format === "epub") archive.file("mimetype", "application/epub+zip", { compression });
    archive.file(format === "epub" ? "chapter.xhtml" : "raw.FB2", "bounded local text");
    return archive.generateAsync({ type: "nodebuffer", compression: "STORE" });
  }
  it("FBZ 放宽只针对显式模式；缺省调用仍强制 EPUB mimetype", async () => {
    const bytes = await make("fbz");
    expect((await inspectZip(asBlob(bytes), "fbz")).has("raw.FB2")).toBe(true);
    await expect(inspectZip(asBlob(bytes))).rejects.toThrow("mimetype");
    await expect(inspectZip(asBlob(bytes), "epub")).rejects.toThrow("mimetype");
  });
  it("显式FBZ路径不会污染后续默认EPUB检查", async () => {
    await inspectZip(asBlob(await make("fbz")), "fbz");
    await expect(inspectZip(asBlob(await make("epub", "DEFLATE")))).rejects.toThrow("mimetype");
  });
  it("即使存在mimetype，默认EPUB仍要求它是首条目", async () => {
    const archive = new JSZip(); archive.file("chapter.xhtml", "x"); archive.file("mimetype", "application/epub+zip");
    await expect(inspectZip(asBlob(await archive.generateAsync({ type: "nodebuffer" })))).rejects.toThrow("mimetype");
  });
  it.each(["epub", "fbz"] as const)("%s 在交给另一ZIP解码器前拒绝注释内嵌EOCD歧义", async format => {
    const outer = await make(format), innerZip = new JSZip(); innerZip.file("inner.FB2", "different inner document");
    const inner = await innerZip.generateAsync({ type: "nodebuffer" }); outer.writeUInt16LE(inner.length + 1, outer.length - 2);
    const ambiguous = Buffer.concat([outer, inner, Buffer.from([0])]);
    expect(Object.keys((await JSZip.loadAsync(ambiguous)).files)).toEqual(["inner.FB2"]);
    await expect(inspectZip(asBlob(ambiguous), format)).rejects.toThrow(/结束记录|歧义/u);
  });
  it.each(["epub", "fbz"] as const)("%s 不因正常注释而误拒合法归档", async format => {
    const bytes = await make(format), comment = Buffer.from("normal archive comment"); bytes.writeUInt16LE(comment.length, bytes.length - 2);
    await expect(inspectZip(asBlob(Buffer.concat([bytes, comment])), format)).resolves.toBeInstanceOf(Map);
  });
  it("两个合法格式的校验状态相互独立，合法EPUB仍可默认通过", async () => {
    const [epub, fbz] = await Promise.all([make("epub"), make("fbz")]);
    const result = await Promise.all([inspectZip(asBlob(epub)), inspectZip(asBlob(fbz), "fbz")]);
    expect([...result[0].keys()]).toEqual(["mimetype", "chapter.xhtml"]);
    expect([...result[1].keys()]).toEqual(["raw.FB2"]);
  });
});


it("FBZ支持descriptor不改变EPUB首条mimetype不得有descriptor的要求", async () => {
  const archive = new JSZip(); archive.file("mimetype", "application/epub+zip", { compression: "STORE" }); archive.file("chapter.xhtml", "text");
  const bytes = await archive.generateAsync({ type: "nodebuffer", streamFiles: true });
  await expect(inspectZip(new Blob([new Uint8Array(bytes)]))).rejects.toThrow("mimetype");
});

it("默认EPUB仍拒绝mimetype本地额外字段，即使ZIP自身结构有效", async () => {
  const original = Buffer.from(await (await zip()).arrayBuffer()), firstNameLength = original.readUInt16LE(26);
  const insertAt = 30 + firstNameLength, extra = Buffer.from([0xfe, 0xca, 0, 0]);
  const bytes = Buffer.concat([original.subarray(0, insertAt), extra, original.subarray(insertAt)]);
  bytes.writeUInt16LE(extra.length, 28);
  const end = bytes.length - 22, directory = original.readUInt32LE(original.length - 6) + extra.length;
  bytes.writeUInt32LE(directory, end + 16); let at = directory;
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    const local = bytes.readUInt32LE(at + 42); if (local !== 0) bytes.writeUInt32LE(local + extra.length, at + 42);
    at += 46 + bytes.readUInt16LE(at + 28) + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  await expect(inspectZip(new Blob([new Uint8Array(bytes)]), "fbz")).resolves.toBeInstanceOf(Map);
  await expect(inspectZip(new Blob([new Uint8Array(bytes)]))).rejects.toThrow("mimetype");
});
