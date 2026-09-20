import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { originalRelativePath, derivedRelativePath, storeOriginalFile, storeDerivedEpub, readStoredOriginalFile, readDerivedEpub, removeStoredOriginalFile, removeDerivedEpub, isStoredOriginalExtension } from "./data-storage";
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "judu-derived-storage-")); });
afterEach(async () => { if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("judu-derived-storage-")) throw new Error("清理越界"); await fs.rm(root, { recursive: true, force: true }); });
describe("原UMD和派生EPUB互不覆盖的不可变存储", () => {
  it("不同目录、独立哈希、原样读回，重复发布不覆盖任何一份", async () => {
    const original = await storeOriginalFile({ dataDir: root, editionId: "edition", extension: ".umd", buffer: Buffer.from("UMD bytes") });
    const derived = await storeDerivedEpub({ dataDir: root, editionId: "edition", buffer: Buffer.from("EPUB bytes") });
    expect(original.relativePath).toBe(originalRelativePath("edition", ".umd")); expect(derived.relativePath).toBe(derivedRelativePath("edition"));
    expect(original.originalHash).not.toBe(derived.fileHash); expect(derived).not.toHaveProperty("originalHash");
    expect((await readStoredOriginalFile({ ...original, dataDir: root })).toString()).toBe("UMD bytes");
    expect((await readDerivedEpub({ ...derived, dataDir: root })).toString()).toBe("EPUB bytes");
    await expect(storeDerivedEpub({ dataDir: root, editionId: "edition", buffer: Buffer.from("replacement") })).rejects.toThrow();
    expect((await readDerivedEpub({ ...derived, dataDir: root })).toString()).toBe("EPUB bytes");
    await removeDerivedEpub(root, derived.relativePath); expect((await readStoredOriginalFile({ ...original, dataDir: root })).toString()).toBe("UMD bytes");
  });
  it("角色分离：原件接口不能读取或删除派生物，反向亦然", async () => {
    const derived = await storeDerivedEpub({ dataDir: root, editionId: "edition", buffer: Buffer.from("epub") });
    await expect(readStoredOriginalFile({ ...derived, originalHash: derived.fileHash, dataDir: root })).rejects.toMatchObject({ code: "UNSAFE_PATH" });
    await expect(removeStoredOriginalFile(root, derived.relativePath)).rejects.toMatchObject({ code: "UNSAFE_PATH" });
    await expect(removeDerivedEpub(root, "originals/edition.umd")).rejects.toMatchObject({ code: "UNSAFE_PATH" });
  });
  it.each(["../evil", "CON", "x/y", "x\\y", "a\n", ""])("派生版本ID%s不能逃逸", async editionId => {
    expect(() => derivedRelativePath(editionId)).toThrow(); await expect(storeDerivedEpub({ dataDir: root, editionId, buffer: Buffer.from("x") })).rejects.toThrow();
  });
  it("派生目录junction不能绕过路径校验", async () => {
    const outside = path.join(root, "other"); await fs.mkdir(outside); await fs.symlink(outside, path.join(root, "derived"), "junction");
    await expect(storeDerivedEpub({ dataDir: root, editionId: "e", buffer: Buffer.from("x") })).rejects.toMatchObject({ code: "UNSAFE_PATH" });
    expect(await fs.readdir(outside)).toEqual([]);
  });
  it("支持保存UMD不代表放开任意存储扩展名", () => { expect(isStoredOriginalExtension(".umd")).toBe(true); expect(isStoredOriginalExtension(".html")).toBe(false); });
});
