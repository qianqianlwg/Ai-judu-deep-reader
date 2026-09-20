import { readFile, mkdtemp, rm, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "./db";
import { importUmdEdition } from "./umd-import";
import * as storage from "./data-storage";
import { makeUmdFixture } from "./umd-fixture";
vi.mock("./data-storage", async original => ({ ...await original<typeof import("./data-storage")>() }));
let root: string, db: ReturnType<typeof createDatabase>;
const tables = ["books", "editions", "chapters", "paragraphs", "edition_conversions"];
const counts = () => tables.map(table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get());
async function files(folder: string) { try { return await readdir(path.join(root, folder)); } catch (error: unknown) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error; } }
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "judu-umd-import-")); vi.stubEnv("JUDU_DATA_DIR", root); db = createDatabase(); });
afterEach(async () => { db.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("judu-umd-import-")) throw new Error("清理越界"); await rm(root, { recursive: true, force: true }); });
describe("UMD双份导入内部组合根", () => {
  it("真实上游原件与派生EPUB分别保存，重开数据库后关系、范围与正文不变", async () => {
    const input = await readFile("src/lib/fixtures/umd/flyfish-book.umd"), result = await importUmdEdition({ db, dataDir: root }, "public-sample.umd", input);
    expect(result.edition.fileType).toBe(".umd"); expect(result.edition.conversion.fileHash).not.toBe(result.edition.originalHash);
    const original = db.prepare("SELECT original_file_path AS relativePath,original_file_size AS size,original_hash AS originalHash FROM editions WHERE id=?").get(result.editionId) as { relativePath: string; size: number; originalHash: string };
    const derived = db.prepare("SELECT file_path AS relativePath,file_size AS size,file_hash AS fileHash,source_map_json AS map FROM edition_conversions WHERE edition_id=?").get(result.editionId) as { relativePath: string; size: number; fileHash: string; map: string };
    expect(await storage.readStoredOriginalFile({ ...original, dataDir: root })).toEqual(input);
    expect((await storage.readDerivedEpub({ ...derived, dataDir: root })).subarray(0, 2).toString()).toBe("PK");
    expect(JSON.parse(derived.map).chapters.map((chapter: { startByte: number; endByte: number }) => [chapter.startByte, chapter.endByte])).toEqual([[0, 208], [208, 380]]);
    const snapshot = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all()), reopened = createDatabase();
    try { expect(tables.map(table => reopened.prepare(`SELECT * FROM ${table}`).all())).toEqual(snapshot); } finally { reopened.close(); }
    expect(result.chapters).toHaveLength(2); expect(await files("originals")).toEqual([result.editionId + ".umd"]); expect(await files("derived")).toEqual([result.editionId + ".epub"]);
  });
  it("同名重复导入创建独立版本和两套不可变文件，未改旧版字节", async () => {
    const a = await importUmdEdition({ db, dataDir: root }, "same.umd", makeUmdFixture()), b = await importUmdEdition({ db, dataDir: root }, "same.umd", makeUmdFixture());
    expect(a.editionId).not.toBe(b.editionId); expect(a.edition.originalHash).toBe(b.edition.originalHash); expect(await files("originals")).toHaveLength(2); expect(await files("derived")).toHaveLength(2);
  });
  it("未重新解码字面实体或过滤同标题正文，输入修改不能污染快照", async () => {
    const input = makeUmdFixture({ chapters: [{ title: "同文", text: "同文\n字面 &lt;标签&gt; &#x41; 😀" }] }); const copy = Buffer.from(input);
    const pending = importUmdEdition({ db, dataDir: root }, "literal.umd", input); input.fill(0); const result = await pending;
    expect(result.chapters[0].paragraphs.map(item => item.text)).toEqual(["同文", "字面 &lt;标签&gt; &#x41; 😀"]);
    expect(await readFile(path.join(root, "originals", result.editionId + ".umd"))).toEqual(copy);
  });
  it("解析失败在发布原件和数据库写入前终止", async () => {
    await expect(importUmdEdition({ db, dataDir: root }, "bad.umd", Buffer.from("bad!"))).rejects.toThrow();
    expect(counts()).toEqual(tables.map(() => ({ n: 0 }))); expect(await files("originals")).toEqual([]); expect(await files("derived")).toEqual([]);
  });
  it("派生物发布失败清理本次原件，但不删除已存在的派生物", async () => {
    const actual = storage.storeDerivedEpub; let existing: Awaited<ReturnType<typeof actual>> | undefined;
    vi.spyOn(storage, "storeDerivedEpub").mockImplementationOnce(async input => { existing = await actual({ ...input, buffer: Buffer.from("existing") }); return actual(input); });
    await expect(importUmdEdition({ db, dataDir: root }, "race.umd", makeUmdFixture())).rejects.toThrow();
    expect(counts()).toEqual(tables.map(() => ({ n: 0 }))); expect(await files("originals")).toEqual([]);
    expect((await readFile(existing!.absolutePath)).toString()).toBe("existing");
  });
  it("数据库中途失败回滚全部新记录、删除两份新文件，保留既有书", async () => {
    db.exec("INSERT INTO books VALUES ('kept','旧书','作者','old'); CREATE TRIGGER reject_test BEFORE INSERT ON paragraphs BEGIN SELECT RAISE(ABORT,'测试SQL失败'); END");
    await expect(importUmdEdition({ db, dataDir: root }, "database.umd", makeUmdFixture())).rejects.toThrow("测试SQL失败");
    expect(counts()).toEqual([{ n: 1 }, ...tables.slice(1).map(() => ({ n: 0 }))]);
    expect(db.prepare("SELECT title FROM books WHERE id='kept'").get()).toEqual({ title: "旧书" }); expect(await files("originals")).toEqual([]); expect(await files("derived")).toEqual([]);
  });
  it.each(["storeOriginalFile", "storeDerivedEpub"] as const)("%s后取消会清理全部本次文件，不提交版本", async method => {
    const controller = new AbortController();
    if (method === "storeOriginalFile") { const actual = storage.storeOriginalFile; vi.spyOn(storage, method).mockImplementationOnce(async input => { const value = await actual(input); controller.abort(); return value; }); }
    else { const actual = storage.storeDerivedEpub; vi.spyOn(storage, method).mockImplementationOnce(async input => { const value = await actual(input); controller.abort(); return value; }); }
    await expect(importUmdEdition({ db, dataDir: root }, "cancel.umd", makeUmdFixture(), { signal: controller.signal })).rejects.toThrow("取消");
    expect(counts()).toEqual(tables.map(() => ({ n: 0 }))); expect(await files("originals")).toEqual([]); expect(await files("derived")).toEqual([]);
  });
  it("清理失败明确上抛，仍继续清理另一个文件", async () => {
    db.exec("CREATE TRIGGER reject_test BEFORE INSERT ON paragraphs BEGIN SELECT RAISE(ABORT,'测试SQL失败'); END");
    vi.spyOn(storage, "removeDerivedEpub").mockRejectedValueOnce(new Error("派生物锁定"));
    const removeOriginal = vi.spyOn(storage, "removeStoredOriginalFile");
    await expect(importUmdEdition({ db, dataDir: root }, "cleanup.umd", makeUmdFixture())).rejects.toThrow("清理未完成");
    expect(removeOriginal).toHaveBeenCalledOnce(); expect(await files("originals")).toEqual([]); expect(await files("derived")).toHaveLength(1);
  });
  it.each(["../a.umd", "a.txt", "a\n.umd", ""])("拒绝非法文件名%s且不创建存储目录", async name => {
    await expect(importUmdEdition({ db, dataDir: root }, name, makeUmdFixture())).rejects.toThrow("文件名"); await expect(stat(path.join(root, "originals"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

it("回滚失败时不删除可能仍被数据库引用的文件，明确反馈状态不确定", async () => {
  db.exec("CREATE TRIGGER reject_test BEFORE INSERT ON paragraphs BEGIN SELECT RAISE(ABORT,'SQL写入失败'); END");
  const actual = db.exec.bind(db);
  vi.spyOn(db, "exec").mockImplementation(sql => { if (sql === "ROLLBACK") throw new Error("rollback暂不可用"); actual(sql); });
  await expect(importUmdEdition({ db, dataDir: root }, "uncertain.umd", makeUmdFixture())).rejects.toThrow("已保留原件和转换版");
  expect(await files("originals")).toHaveLength(1); expect(await files("derived")).toHaveLength(1);
  actual("ROLLBACK"); expect(counts()).toEqual(tables.map(() => ({ n: 0 })));
});
