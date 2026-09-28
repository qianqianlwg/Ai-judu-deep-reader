import { describe, expect, it } from "vitest";
import { makeEpub, makePdf, makeCompressedDirectoryZip } from "./fixtures";
import { inflateRawSync } from "node:zlib";
import JSZip from "jszip";
describe("synthetic import fixtures", () => {
  it("generates deterministic ZIP and PDF bytes without private files", () => {
    expect(makeEpub().subarray(0, 2).toString()).toBe("PK"); expect(makeEpub()).toEqual(makeEpub());
    expect(makePdf().subarray(0, 8).toString()).toBe("%PDF-1.4"); expect(makePdf()).toEqual(makePdf());
    expect(makeEpub(true)).not.toEqual(makeEpub());
  });
  it("空目录的压缩体确实为 2 字节 DEFLATE，解压及 CRC 与真实样本结构一致", async () => {
    const bytes = makeCompressedDirectoryZip();
    const local = bytes.indexOf(Buffer.from("META-INF/")) - 30;
    expect(bytes.readUInt16LE(local + 8)).toBe(8);
    expect(bytes.readUInt32LE(local + 18)).toBe(2);
    expect(bytes.readUInt32LE(local + 22)).toBe(0);
    const data = local + 30 + bytes.readUInt16LE(local + 26);
    expect(inflateRawSync(bytes.subarray(data, data + 2))).toEqual(Buffer.alloc(0));
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
    expect(zip.files["META-INF/"].dir).toBe(true);
    expect(await zip.files["META-INF/"].async("nodebuffer")).toEqual(Buffer.alloc(0));
  });
});
