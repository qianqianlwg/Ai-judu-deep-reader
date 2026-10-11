import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { htmlToBlocks } from './epub-parser';
import { EPUB_BLOCK_SCHEMA, hasEpubBlockVersion, installEpubHeadingSources, readStoredSourceBlocks, type SourceDb } from './epub-block-store';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SourceDb & { close(): void };
};
function fixture(version: 0 | 1) {
  const db = new DatabaseSync(':memory:');
  db.exec(EPUB_BLOCK_SCHEMA + `CREATE TABLE chapters(id TEXT PRIMARY KEY,edition_id TEXT,title TEXT,order_index INTEGER,source_href TEXT);
    CREATE TABLE paragraphs(id TEXT PRIMARY KEY,chapter_id TEXT,text TEXT,text_hash TEXT,order_index INTEGER);
    CREATE TABLE annotations(id TEXT,paragraph_id TEXT,start_offset INTEGER,end_offset INTEGER);
    INSERT INTO chapters VALUES('toc','e','目录',0,'text/toc.html'),('body','e','正文',1,'text/body.html');
    INSERT INTO paragraphs VALUES('old-toc','toc','目录 甲😀 乙','toc-hash',0),('old-body','body','正文内容','body-hash',0);
    INSERT INTO annotations VALUES('a','old-toc',3,6);`);
  if (version === 1) db.exec("INSERT INTO reading_block_metadata VALUES('old-toc','paragraph',NULL,0),('old-body','paragraph',NULL,0); INSERT INTO epub_block_versions VALUES('e','hash',1);");
  const toc = htmlToBlocks('<div>目录</div><div>甲😀</div><div>乙</div>');
  const body = htmlToBlocks('<p>正文内容</p><div>独立原文</div>');
  return { db, chapters: [
    { title: '目录', sourceHref: 'text/toc.html', ...toc },
    { title: '正文', sourceHref: 'text/body.html', ...body },
  ] };
}
for (const version of [0, 1] as const) {
  it(`旧整页来源v${version}完整保留ID、文本、哈希、标注，其他章节正常补建且幂等`, () => {
    const { db, chapters } = fixture(version);
    try {
      installEpubHeadingSources(db, 'e', 'hash', chapters);
      expect(readStoredSourceBlocks(db, 'toc')).toEqual([{ id: 'old-toc', text: '目录 甲😀 乙' }]);
      expect(readStoredSourceBlocks(db, 'body').map(p => p.text)).toEqual(['正文内容', '独立原文']);
      expect(readStoredSourceBlocks(db, 'body')[0].id).toBe('old-body');
      expect(db.prepare("SELECT text_hash,order_index FROM paragraphs WHERE id='old-toc'").get()).toEqual({ text_hash: 'toc-hash', order_index: 0 });
      expect(db.prepare('SELECT * FROM annotations').all()).toEqual([{ id: 'a', paragraph_id: 'old-toc', start_offset: 3, end_offset: 6 }]);
      expect(hasEpubBlockVersion(db, 'e', 'hash')).toBe(true);
      installEpubHeadingSources(db, 'e', 'hash', chapters);
      expect(readStoredSourceBlocks(db, 'toc')).toHaveLength(1);
    } finally { db.close(); }
  });
}
it('旧整页篡改仍报错，不得放宽逐字校验', () => {
  const { db, chapters } = fixture(0);
  try {
    db.exec("UPDATE paragraphs SET text='改写目录' WHERE id='old-toc'");
    expect(() => installEpubHeadingSources(db, 'e', 'hash', chapters)).toThrow('正文与已保存内容不一致');
    expect(hasEpubBlockVersion(db, 'e', 'hash')).toBe(false);
    expect(readStoredSourceBlocks(db, 'body')).toEqual([{ id: 'old-body', text: '正文内容' }]);
  } finally { db.close(); }
});
it('其他章写入失败时整页元数据与版本一并回滚', () => {
  const { db, chapters } = fixture(1);
  try {
    db.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON paragraphs BEGIN SELECT RAISE(ABORT,'写入失败'); END;");
    expect(() => installEpubHeadingSources(db, 'e', 'hash', chapters)).toThrow('写入失败');
    expect(readStoredSourceBlocks(db, 'toc')[0]).toMatchObject({ id: 'old-toc', sourceOrdinal: 0 });
    expect(db.prepare('SELECT version FROM epub_block_versions').get()).toEqual({ version: 1 });
    expect(readStoredSourceBlocks(db, 'body')).toHaveLength(1);
  } finally { db.close(); }
});
