/** WHY：独立派生记录保留原件元数据语义；增量建表不重写旧版正文、标注和会话。 */
export const EDITION_CONVERSIONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS edition_conversions (
    edition_id TEXT PRIMARY KEY NOT NULL REFERENCES editions(id),
    source_hash TEXT NOT NULL CHECK (length(source_hash)=64 AND source_hash NOT GLOB '*[^0-9a-f]*'),
    target_format TEXT NOT NULL CHECK (target_format='.epub'),
    file_path TEXT NOT NULL UNIQUE CHECK (file_path='derived/'||edition_id||'.epub'),
    file_size INTEGER NOT NULL CONSTRAINT conversion_metadata_v2 CHECK (typeof(file_size)='integer' AND file_size>0 AND file_size<=67108864),
    file_hash TEXT NOT NULL CHECK (length(file_hash)=64 AND file_hash NOT GLOB '*[^0-9a-f]*'),
    converter_version TEXT NOT NULL CHECK (converter_version='umd-epub-v1'),
    source_map_json TEXT NOT NULL CHECK (coalesce(json_valid(source_map_json) AND json_type(source_map_json,'$.version')='integer' AND json_extract(source_map_json,'$.version')=1
      AND json_type(source_map_json,'$.chapters')='array' AND json_array_length(source_map_json,'$.chapters') BETWEEN 1 AND 1024,0)),
    created_at TEXT NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS edition_conversions_source_insert BEFORE INSERT ON edition_conversions
  WHEN NOT EXISTS(SELECT 1 FROM editions WHERE id=NEW.edition_id AND file_type='.umd' AND original_hash=NEW.source_hash AND original_file_size>0 AND original_file_path!='')
  BEGIN SELECT RAISE(ABORT,'conversion source does not match edition'); END;
  CREATE TRIGGER IF NOT EXISTS edition_conversions_source_update BEFORE UPDATE ON edition_conversions
  WHEN NOT EXISTS(SELECT 1 FROM editions WHERE id=NEW.edition_id AND file_type='.umd' AND original_hash=NEW.source_hash AND original_file_size>0 AND original_file_path!='')
  BEGIN SELECT RAISE(ABORT,'conversion source does not match edition'); END;
`;
export type ConversionSource = { href: string; startByte: number; endByte: number };
export function readConversionSources(value: unknown): ConversionSource[] {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1
    || !("chapters" in value) || !Array.isArray(value.chapters) || !value.chapters.length || value.chapters.length > 1024) throw new Error("转换来源映射无效");
  let previous = 0;
  return value.chapters.map((item: unknown, index) => {
    if (!item || typeof item !== "object" || !("href" in item) || item.href !== `OPS/chapter-${String(index + 1).padStart(4, "0")}.xhtml`
      || !("startByte" in item) || item.startByte !== previous || !("endByte" in item) || typeof item.endByte !== "number"
      || !Number.isSafeInteger(item.endByte) || item.endByte <= previous || item.endByte % 2 || item.endByte > 20 * 1024 * 1024) throw new Error("转换来源范围不完整或超限");
    const result = { href: item.href, startByte: previous, endByte: item.endByte }; previous = item.endByte; return result;
  });
}

/** 在createDatabase持有的同步SQLite事务内升级；不删除或重写原件/正文记录。 */
export function migrateEditionConversions(db: { exec(sql: string): void; prepare(sql: string): { get(): unknown } }): void {
  const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='edition_conversions'").get();
  if (existing === undefined) { db.exec(EDITION_CONVERSIONS_SCHEMA); return; }
  if (!existing || typeof existing !== "object" || !("sql" in existing) || typeof existing.sql !== "string") throw new Error("转换版本表定义无法读取");
  if (existing.sql.includes("CONSTRAINT conversion_metadata_v2")) { db.exec(EDITION_CONVERSIONS_SCHEMA); return; }
  // WHY：开发期旧schema可能在已有库中存在；不能只CREATE IF NOT EXISTS让旧的NULL可通过约束永久保留。
  try {
    db.exec("DROP TRIGGER IF EXISTS edition_conversions_source_insert; DROP TRIGGER IF EXISTS edition_conversions_source_update");
    db.exec("ALTER TABLE edition_conversions RENAME TO edition_conversions_legacy_v1");
    db.exec(EDITION_CONVERSIONS_SCHEMA);
    db.exec("INSERT INTO edition_conversions (edition_id,source_hash,target_format,file_path,file_size,file_hash,converter_version,source_map_json,created_at) SELECT edition_id,source_hash,target_format,file_path,file_size,file_hash,converter_version,source_map_json,created_at FROM edition_conversions_legacy_v1");
    db.exec("DROP TABLE edition_conversions_legacy_v1");
  } catch (cause: unknown) {
    // WHY：由外层事务统一ROLLBACK；坏旧记录不能被过滤或丢弃来制造迁移成功。
    throw new Error("转换存储升级失败，旧记录将由事务回滚保留；请核查转换元数据", { cause });
  }
}
