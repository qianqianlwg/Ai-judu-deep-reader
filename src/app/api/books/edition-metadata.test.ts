import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { readBookResponse, readLibraryResponse } from "@/lib/library";
import { EDITION_COLUMNS, publicEdition, type EditionRow } from "./edition-metadata";

const sourceHash = "a".repeat(64), targetHash = "b".repeat(64);
const conversion = { format: ".epub", sourceHash, fileHash: targetHash, fileSize: 1200,
  converterVersion: "umd-epub-v1", createdAt: "2026-09-20T08:00:00Z" };
const umdRow: EditionRow = { id: "umd-e", bookId: "b", fileName: "book.umd", fileType: ".umd", hasOriginalFile: 1,
  fileSize: 3456, originalHash: sourceHash, createdAt: "2026-09-20T07:00:00Z", conversionJson: JSON.stringify(conversion) };
const expectedUmd = { id: umdRow.id, fileName: umdRow.fileName, fileType: ".umd", hasOriginalFile: true,
  fileSize: 3456, originalHash: sourceHash, createdAt: umdRow.createdAt, readerMode: "text", conversion };

describe("public edition metadata", () => {
  it("exposes only the allowlist and never claims EPUB rendering readiness", () => {
    const row = { id: "e", bookId: "b", fileName: "a.epub", fileType: ".epub", hasOriginalFile: 1, fileSize: 42, originalHash: "a".repeat(64), createdAt: "now", originalFilePath: "secret", readerMode: "epub" };
    expect(publicEdition(row)).toEqual({ id: "e", fileName: "a.epub", fileType: ".epub", hasOriginalFile: true, fileSize: 42, originalHash: "a".repeat(64), createdAt: "now", readerMode: "text" });
    expect(publicEdition({ ...row, hasOriginalFile: 0, fileSize: 0, originalHash: null })).not.toHaveProperty("originalHash");
  });

  it("旧mock缺字段和SQL NULL不添加conversion，不改变旧EPUB对象", () => {
    const row = { ...umdRow, fileType: ".epub", conversionJson: undefined };
    const legacy = publicEdition(row);
    expect(legacy).not.toHaveProperty("conversion");
    expect(publicEdition({ ...row, conversionJson: null })).toEqual(legacy);
    expect(publicEdition({ ...umdRow, conversionJson: null })).not.toHaveProperty("conversion");
  });

  it("公开独立的原件和派生文件身份，复用客户端验证且不泄露两层私有信息", () => {
    const row = { ...umdRow, file_path: "PRIVATE_TARGET", original_file_path: "PRIVATE_SOURCE", source_map_json: "PRIVATE_MAP",
      conversionJson: JSON.stringify({ ...conversion, file_path: "PRIVATE_TARGET", source_map_json: "PRIVATE_MAP" }) };
    const result = publicEdition(row);
    expect(result).toEqual(expectedUmd);
    expect(result.originalHash).toBe(sourceHash);
    expect(result.fileSize).toBe(3456);
    expect(result.conversion?.fileHash).toBe(targetHash);
    expect(result.conversion?.fileSize).toBe(1200);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|file_path|source_map_json|conversionJson|bookId/);
    const response = { id: "b", title: "书", author: "作者", editions: [result], editionId: result.id, edition: result, chapters: [] };
    expect(readLibraryResponse([response])[0].editions?.[0]).toEqual(result);
    expect(readBookResponse(response, "b", result.id).edition).toEqual(result);
  });

  it.each(["", " ", "{", '{"format":', "null", "[]", "{}", "false", "123", '"string"'])("坏JSON或非对象转换数据%s不能默默降级", conversionJson => {
    expect(() => publicEdition({ ...umdRow, conversionJson })).toThrow(/转换版本/);
  });
  it("运行时伪造非字符串conversionJson明确拒绝", () => {
    const bad = { ...umdRow, conversionJson: conversion } as unknown as EditionRow;
    expect(() => publicEdition(bad)).toThrow("JSON字段类型无效");
  });
  it("坏JSON异常保留cause以供调用方记录诊断", () => {
    let caught: unknown;
    try { publicEdition({ ...umdRow, conversionJson: "{" }); }
    catch (error: unknown) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof Error)) throw new Error("缺少错误");
    expect(caught.cause).toBeInstanceOf(SyntaxError);
  });
  it.each([
    { format: ".pdf" }, { sourceHash: targetHash }, { sourceHash: sourceHash.toUpperCase() },
    { fileHash: targetHash.toUpperCase() }, { fileHash: "bad" }, { fileSize: 0 }, { fileSize: -1 },
    { fileSize: 0.5 }, { fileSize: 64 * 1024 * 1024 + 1 }, { fileSize: "1200" },
    { converterVersion: "umd-epub-v2" }, { createdAt: "" }, { createdAt: " \n" }, { createdAt: null },
  ])("转换字段异常不能从服务端输出 %j", changes => {
    expect(() => publicEdition({ ...umdRow, conversionJson: JSON.stringify({ ...conversion, ...changes }) })).toThrow("转换版本");
  });
  it.each([
    { fileType: ".epub" }, { fileType: "umd" }, { fileType: ".UMD" }, { hasOriginalFile: 0 },
    { originalHash: null }, { originalHash: targetHash }, { originalHash: sourceHash.toUpperCase() },
  ])("数据库转换记录必须绑定正确UMD原件 %j", changes => {
    expect(() => publicEdition({ ...umdRow, ...changes })).toThrow("身份不匹配");
  });
});

type MemoryStatement = { all(...args: string[]): unknown[]; get(...args: string[]): unknown; run(...args: (string | number | null)[]): void };
type MemoryDatabase = { exec(sql: string): void; prepare(sql: string): MemoryStatement; close(): void };
type SqliteModule = { DatabaseSync: new (name: string) => MemoryDatabase };
function isSqliteModule(value: unknown): value is SqliteModule {
  return value !== null && typeof value === "object" && "DatabaseSync" in value && typeof value.DatabaseSync === "function";
}
const sqlite: unknown = createRequire(import.meta.url)("node:sqlite");
if (!isSqliteModule(sqlite)) throw new Error("内存SQLite测试模块无效");
const { DatabaseSync } = sqlite;
function withDatabase(run: (db: MemoryDatabase) => void): void {
  // WHY：仅用内存SQLite同步执行真实SELECT验证相关子查询；不调用getDb，不迁移或访问任何磁盘数据库。
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE editions (id TEXT PRIMARY KEY, book_id TEXT, file_name TEXT, file_type TEXT,
      original_file_path TEXT, original_file_size INTEGER, original_hash TEXT, created_at TEXT);
      CREATE TABLE edition_conversions (edition_id TEXT PRIMARY KEY, source_hash TEXT, target_format TEXT,
      file_path TEXT, file_size INTEGER, file_hash TEXT, converter_version TEXT, source_map_json TEXT, created_at TEXT);`);
    const insertEdition = db.prepare("INSERT INTO editions VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    insertEdition.run("umd-e", "b", "book.umd", ".umd", "PRIVATE_SOURCE", 3456, sourceHash, "2026-09-20T07:00:00Z");
    insertEdition.run("old-e", "b", "book.epub", ".epub", "", 0, null, "2025-01-01");
    insertEdition.run("other-e", "other-book", "other.umd", ".umd", "PRIVATE_OTHER", 4096, "c".repeat(64), "2026-09-20T06:00:00Z");
    const insertConversion = db.prepare("INSERT INTO edition_conversions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    insertConversion.run("umd-e", sourceHash, ".epub", "PRIVATE_TARGET", 1200, targetHash, "umd-epub-v1", "PRIVATE_MAP", conversion.createdAt);
    insertConversion.run("other-e", "c".repeat(64), ".epub", "PRIVATE_OTHER_TARGET", 2222, "d".repeat(64), "umd-epub-v1", "PRIVATE_OTHER_MAP", "2026-09-20T09:00:00Z");
    run(db);
  } finally { db.close(); }
}

describe("EDITION_COLUMNS相关子查询（真实内存SQL，无路由/正式数据）", () => {
  it("按edition_id关联且不扩张行数，无记录返回NULL，私有字段根本不进入conversionJson", () => {
    withDatabase(db => {
      const rows = db.prepare(`SELECT ${EDITION_COLUMNS} FROM editions ORDER BY created_at DESC, id`).all() as EditionRow[];
      expect(rows.map(row => row.id)).toEqual(["umd-e", "other-e", "old-e"]);
      expect(rows[0].conversionJson).toBeTypeOf("string");
      expect(JSON.parse(rows[0].conversionJson!)).toEqual(conversion);
      expect(rows[2].conversionJson).toBeNull();
      expect(rows[0].createdAt).toBe("2026-09-20T07:00:00Z");
      expect(JSON.stringify(rows)).not.toMatch(/PRIVATE|file_path|source_map_json/);
      expect(publicEdition(rows[0])).toEqual(expectedUmd);
      expect(publicEdition(rows[1]).conversion).toMatchObject({ sourceHash: "c".repeat(64), fileHash: "d".repeat(64), fileSize: 2222 });
      expect(publicEdition(rows[2])).not.toHaveProperty("conversion");
    });
  });
  it("保持原路由WHERE/ORDER BY/LIMIT形状，选中行不会串到别书转换记录", () => {
    withDatabase(db => {
      const row = db.prepare(`SELECT ${EDITION_COLUMNS} FROM editions WHERE book_id = ? ORDER BY created_at DESC, id LIMIT 1`).get("b") as EditionRow;
      expect(publicEdition(row)).toEqual(expectedUmd);
      expect(db.prepare(`SELECT ${EDITION_COLUMNS} FROM editions WHERE book_id = ? ORDER BY created_at DESC, id`).all("b")).toHaveLength(2);
      expect(db.prepare(`SELECT ${EDITION_COLUMNS} FROM editions WHERE book_id = ? ORDER BY created_at DESC, id LIMIT 1`).get("missing")).toBeUndefined();
    });
  });
  it("缺少迁移时明确失败，不吞SQL异常伪装成没有转换", () => {
    withDatabase(db => {
      db.exec("DROP TABLE edition_conversions");
      expect(() => db.prepare(`SELECT ${EDITION_COLUMNS} FROM editions`).all()).toThrow(/edition_conversions/);
    });
  });
});
