import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getJuduDataDir, originalRelativePath, readStoredOriginalFile, removeStoredOriginalFile, storeOriginalFile } from "./data-storage";
let root: string;
let dataDir: string;
const bytes = Buffer.from([0, 255, 128, 42]);
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "judu-storage-test-")); dataDir = path.join(root, "data"); });
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("judu-storage-test-")) throw new Error("不安全测试清理");
  await fs.rm(root, { recursive: true, force: true });
});
const store = (editionId = "edition-1") => storeOriginalFile({ dataDir, editionId, extension: ".epub", buffer: bytes });
describe("immutable original file storage", () => {
  it("publishes complete bytes, raw SHA-256 and portable relative path; can read after a fresh caller and remove", async () => {
    const result = await store();
    expect(result).toMatchObject({ relativePath: "originals/edition-1.epub", size: 4, originalHash: createHash("sha256").update(bytes).digest("hex") });
    expect(await fs.readFile(result.absolutePath)).toEqual(bytes);
    expect(await readStoredOriginalFile({ dataDir, ...result })).toEqual(bytes);
    expect(await fs.readdir(path.join(dataDir, "originals"))).toEqual(["edition-1.epub"]);
    await removeStoredOriginalFile(dataDir, result.relativePath);
    await expect(fs.readFile(result.absolutePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("snapshots caller bytes before asynchronous filesystem operations", async () => {
    const mutable = Buffer.from("original"); const pending = storeOriginalFile({ dataDir, editionId: "snapshot", extension: ".txt", buffer: mutable });
    mutable.fill(0); const result = await pending;
    expect(await readStoredOriginalFile({ dataDir, ...result })).toEqual(Buffer.from("original"));
  });
  it("never overwrites an existing original, including concurrent publication", async () => {
    const results = await Promise.allSettled([store(), store()]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await fs.readdir(path.join(dataDir, "originals"))).toEqual(["edition-1.epub"]);
    expect(await fs.readFile(path.join(dataDir, "originals", "edition-1.epub"))).toEqual(bytes);
  });
  it.each(["../escape", "a/b", "a\\b", "a:stream", "", "a\u0000", "a\n", "CON", "nul", "LPT1", "a".repeat(129)])("rejects unsafe IDs: %j", id => {
    expect(() => originalRelativePath(id, ".pdf")).toThrow();
  });
  it.each(["../secret", "originals/../secret", "/secret", "C:\\secret", "originals/a.txt:stream", "originals/a/b.txt", "\\\\host\\share", "originals/a.html", "originals/a.txt\n", "originals/CON.txt"])("rejects unsafe read AND cleanup paths: %j", async relativePath => {
    await expect(readStoredOriginalFile({ dataDir, relativePath, size: 4, originalHash: "0".repeat(64) })).rejects.toMatchObject({ code: "UNSAFE_PATH" });
    await expect(removeStoredOriginalFile(dataDir, relativePath)).rejects.toMatchObject({ code: "UNSAFE_PATH" });
  });
  it("rejects public storage configuration", () => {
    vi.stubEnv("JUDU_DATA_DIR", path.join(process.cwd(), "public", "private"));
    expect(getJuduDataDir).toThrow();
  });
  it.each(["ancestor", "originals", "leaf"])("rejects symlink/junction traversal at %s on write/read/removal", async position => {
    const outside = path.join(root, "outside"); await fs.mkdir(outside);
    const target = position === "ancestor" ? dataDir : position === "originals" ? path.join(dataDir, "originals") : path.join(dataDir, "originals", "edition-1.epub");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.symlink(outside, target, "junction");
    await expect(store()).rejects.toThrow();
    await expect(readStoredOriginalFile({ dataDir, relativePath: "originals/edition-1.epub", size: 4, originalHash: "0".repeat(64) })).rejects.toMatchObject({ code: "UNSAFE_PATH" });
    await expect(removeStoredOriginalFile(dataDir, "originals/edition-1.epub")).rejects.toMatchObject({ code: "UNSAFE_PATH" });
    expect(await fs.readdir(outside)).toEqual([]);
  });
  it("rejects hard links rather than serving another file", async () => {
    const result = await store(); await fs.link(result.absolutePath, path.join(root, "other-link"));
    await expect(readStoredOriginalFile({ dataDir, ...result })).rejects.toMatchObject({ code: "UNSAFE_PATH" });
    await expect(removeStoredOriginalFile(dataDir, result.relativePath)).rejects.toMatchObject({ code: "UNSAFE_PATH" });
  });
  it("detects missing files, wrong sizes, same-length corruption and absent hash", async () => {
    const result = await store();
    await expect(readStoredOriginalFile({ dataDir, ...result, size: 5 })).rejects.toMatchObject({ code: "CORRUPT_FILE" });
    await expect(readStoredOriginalFile({ dataDir, ...result, originalHash: "" })).rejects.toMatchObject({ code: "CORRUPT_FILE" });
    await fs.chmod(result.absolutePath, 0o600); await fs.writeFile(result.absolutePath, Buffer.from("evil"));
    await expect(readStoredOriginalFile({ dataDir, ...result })).rejects.toMatchObject({ code: "CORRUPT_FILE" });
    await fs.rm(result.absolutePath);
    await expect(readStoredOriginalFile({ dataDir, ...result })).rejects.toMatchObject({ code: "MISSING_FILE" });
  });
  it("cleans a partial temporary write and never publishes a final file", async () => {
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      vi.spyOn(handle, "writeFile").mockRejectedValue(new Error("disk full")); return handle;
    });
    await expect(store()).rejects.toThrow("disk full");
    expect(await fs.readdir(path.join(dataDir, "originals"))).toEqual([]);
  });
  it("cleans failed exclusive publication without leaving pending bytes", async () => {
    vi.spyOn(fs, "link").mockRejectedValueOnce(new Error("publication failed"));
    await expect(store()).rejects.toThrow("publication failed");
    expect(await fs.readdir(path.join(dataDir, "originals"))).toEqual([]);
  });
});
