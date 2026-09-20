import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "./db";
import { EDITION_CONVERSIONS_SCHEMA, readConversionSources } from "./edition-conversion";
let root: string, db: ReturnType<typeof createDatabase>;
const source = "a".repeat(64), target = "b".repeat(64), map = JSON.stringify({ version: 1, chapters: [{ href: "OPS/chapter-0001.xhtml", startByte: 0, endByte: 8 }] });
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "judu-conversions-schema-")); vi.stubEnv("JUDU_DATA_DIR", root); db = createDatabase();
  db.exec(`INSERT INTO books VALUES ('book','原书','作者','now'); INSERT INTO editions (id,book_id,file_name,file_type,file_hash,original_file_path,original_file_size,original_hash,created_at) VALUES ('edition','book','book.umd','.umd','legacy','originals/edition.umd',42,'${source}','now')`);
});
afterEach(async () => { db.close(); vi.unstubAllEnvs(); if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("judu-conversions-schema-")) throw new Error("测试清理越界"); await rm(root, { recursive: true, force: true }); });
function insert(overrides: { id?: string; sourceHash?: string; fileSize?: number; version?: string; filePath?: string; sourceMap?: string } = {}) {
  return db.prepare("INSERT INTO edition_conversions VALUES (?,?,?,?,?,?,?,?,?)").run(overrides.id ?? "edition", overrides.sourceHash ?? source, ".epub", overrides.filePath ?? "derived/edition.epub", overrides.fileSize ?? 99, target, overrides.version ?? "umd-epub-v1", overrides.sourceMap ?? map, "now");
}
describe("派生版本增量schema", () => {
  it("可重复迁移并保留旧版所有字段与派生关系", () => {
    const before = db.prepare("SELECT * FROM editions").all(); insert(); const links = db.prepare("SELECT * FROM edition_conversions").all();
    db.exec(EDITION_CONVERSIONS_SCHEMA); const again = createDatabase();
    try { expect(again.prepare("SELECT * FROM editions").all()).toEqual(before); expect(again.prepare("SELECT * FROM edition_conversions").all()).toEqual(links); }
    finally { again.close(); }
  });
  it.each([{ id: "other" }, { sourceHash: target }, { fileSize: 0 }, { fileSize: 1.5 }, { fileSize: 67108865 },
    { version: "unverified" }, { filePath: "derived/other.epub" }, { sourceMap: "{}" }, { sourceMap: "null" }, { sourceMap: "{bad" }, { sourceMap: '{"version":1,"chapters":[]}' }])("无效关联在SQL边界拒绝 %#", value => {
    expect(() => insert(value)).toThrow(); expect(db.prepare("SELECT COUNT(*) AS n FROM edition_conversions").get()).toEqual({ n: 0 });
  });
  it("不能给EPUB原件虚构UMD转换关系，更新也不能改绑另一原件", () => {
    db.exec("UPDATE editions SET file_type='.epub'"); expect(() => insert()).toThrow("source");
    db.exec("UPDATE editions SET file_type='.umd'"); insert();
    expect(() => db.prepare("UPDATE edition_conversions SET source_hash=?").run(target)).toThrow("source");
  });
});
describe("来源映射独立边界", () => {
  it("返回经过白名单读取的连续UTF16字节范围", () => expect(readConversionSources(JSON.parse(map))).toEqual([{ href: "OPS/chapter-0001.xhtml", startByte: 0, endByte: 8 }]));
  it.each([null, {}, { version: 2, chapters: [] }, { version: 1, chapters: [{ href: "../chapter.xhtml", startByte: 0, endByte: 8 }] },
    { version: 1, chapters: [{ href: "OPS/chapter-0001.xhtml", startByte: 2, endByte: 8 }] },
    { version: 1, chapters: [{ href: "OPS/chapter-0001.xhtml", startByte: 0, endByte: 7 }] }])("坏映射拒绝 %#", input => expect(() => readConversionSources(input)).toThrow());
});

function legacyTable() {
  db.exec("DROP TRIGGER IF EXISTS edition_conversions_source_insert; DROP TRIGGER IF EXISTS edition_conversions_source_update; DROP TABLE edition_conversions");
  db.exec("CREATE TABLE edition_conversions (edition_id TEXT PRIMARY KEY,source_hash TEXT,target_format TEXT,file_path TEXT,file_size INTEGER,file_hash TEXT,converter_version TEXT,source_map_json TEXT,created_at TEXT)");
}
it("升级旧约束时原样保留转换记录，不能只CREATE IF NOT EXISTS", () => {
  legacyTable(); insert(); const before = db.prepare("SELECT * FROM edition_conversions").all();
  const reopened = createDatabase();
  try {
    expect(reopened.prepare("SELECT * FROM edition_conversions").all()).toEqual(before);
    expect(reopened.prepare("SELECT sql FROM sqlite_master WHERE name='edition_conversions'").get()).toMatchObject({ sql: expect.stringContaining("CONSTRAINT conversion_metadata_v2") });
    expect(reopened.prepare("SELECT name FROM sqlite_master WHERE name='edition_conversions_legacy_v1'").get()).toBeUndefined();
  } finally { reopened.close(); }
});
it("旧约束下的坏记录阻止升级并整体回滚，不能丢弃坏行或留下半个表", () => {
  legacyTable(); insert({ sourceMap: "{}" }); const before = db.prepare("SELECT * FROM edition_conversions").all();
  expect(() => createDatabase()).toThrow("转换存储升级失败");
  expect(db.prepare("SELECT * FROM edition_conversions").all()).toEqual(before);
  expect(db.prepare("SELECT sql FROM sqlite_master WHERE name='edition_conversions'").get()).toMatchObject({ sql: expect.not.stringContaining("CONSTRAINT conversion_metadata_v2") });
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='edition_conversions_legacy_v1'").get()).toBeUndefined();
});
