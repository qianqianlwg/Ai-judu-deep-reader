import { createRequire } from 'node:module';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { verifySelectionAnchors } from './reading-anchor-validation';
import { EPUB_BLOCK_SCHEMA, installEpubHeadingSources, readStoredSourceBlocks, hasEpubBlockVersion, type SourceDb } from './epub-block-store';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
    DatabaseSync: new (path: string) => SourceDb & {
        close(): void;
    };
};
let db: SourceDb & {
    close(): void;
};
const source = [{ title: '章标题', sourceHref: 'OPS/ch.xhtml', paragraphs: ['旧正文😀', '后段'], blocks: [{ kind: 'heading' as const, headingLevel: 1 as const, text: '章标题', sourceOrdinal: 0 }, { kind: 'paragraph' as const, text: '旧正文😀', sourceOrdinal: 1 }, { kind: 'heading' as const, headingLevel: 2 as const, text: '小标题', sourceOrdinal: 2 }, { kind: 'paragraph' as const, text: '后段', sourceOrdinal: 3 }] }];
beforeEach(() => { db = new DatabaseSync(':memory:'); db.exec(EPUB_BLOCK_SCHEMA + `CREATE TABLE editions(id TEXT,book_id TEXT);INSERT INTO editions VALUES('e','book');CREATE TABLE chapters(id TEXT PRIMARY KEY,edition_id TEXT,title TEXT,order_index INTEGER,source_href TEXT);CREATE TABLE paragraphs(id TEXT PRIMARY KEY,chapter_id TEXT,text TEXT,text_hash TEXT,order_index INTEGER);CREATE TABLE annotations(id TEXT,paragraph_id TEXT,start_offset INTEGER,end_offset INTEGER);INSERT INTO chapters VALUES('c','e','章标题',0,'OPS/ch.xhtml');INSERT INTO paragraphs VALUES('old','c','旧正文😀','old-hash',0),('later','c','后段','later-hash',1);INSERT INTO annotations VALUES('a','old',3,5);`); });
afterEach(() => db.close());
it('补建中间与开头标题且完整保留旧ID、哈希、标注及UTF16位置', () => { installEpubHeadingSources(db, 'e', 'hash', source); const blocks = readStoredSourceBlocks(db, 'c'); expect(blocks.map(b => b.text)).toEqual(['章标题', '旧正文😀', '小标题', '后段']); expect(blocks[0]).toMatchObject({ kind: 'heading', headingLevel: 1, sourceOrdinal: 0 }); expect(blocks[1].id).toBe('old'); expect(blocks[3].id).toBe('later'); expect(db.prepare("SELECT text_hash FROM paragraphs WHERE id='old'").get()).toEqual({ text_hash: 'old-hash' }); expect(db.prepare('SELECT * FROM annotations').all()).toEqual([{ id: 'a', paragraph_id: 'old', start_offset: 3, end_offset: 5 }]); expect(hasEpubBlockVersion(db, 'e', 'hash')).toBe(true); });
it('重复补建幂等且并发迟到计划不会覆盖现有来源', () => { installEpubHeadingSources(db, 'e', 'hash', source); const before = readStoredSourceBlocks(db, 'c'); installEpubHeadingSources(db, 'e', 'hash', source); expect(hasEpubBlockVersion(db, 'e', 'hash')).toBe(true); expect(readStoredSourceBlocks(db, 'c')).toEqual(before); });
it('正文或资源不匹配时不修改书库', () => { expect(() => installEpubHeadingSources(db, 'e', 'hash', [{ ...source[0], paragraphs: ['改写正文', '后段'] }])).toThrow(); expect(readStoredSourceBlocks(db, 'c').map(b => b.id)).toEqual(['old', 'later']); expect(hasEpubBlockVersion(db, 'e', 'hash')).toBe(false); expect(() => installEpubHeadingSources(db, 'e', 'hash', [{ ...source[0], sourceHref: 'other.xhtml' }])).toThrow(); });
it('写入失败事务回滚，不能留下部分标题或移动旧段落', () => { db.exec("CREATE TRIGGER fail_metadata BEFORE INSERT ON reading_block_metadata BEGIN SELECT RAISE(ABORT,'拒绝元数据'); END;"); expect(() => installEpubHeadingSources(db, 'e', 'hash', source)).toThrow('拒绝元数据'); expect(db.prepare('SELECT id,order_index FROM paragraphs ORDER BY order_index').all()).toEqual([{ id: 'old', order_index: 0 }, { id: 'later', order_index: 1 }]); expect(hasEpubBlockVersion(db, 'e', 'hash')).toBe(false); });
it('标题正文完整选区通过服务端来源核验，省略中间标题或篡改字符均拒绝', () => {
    installEpubHeadingSources(db, 'e', 'hash', source);
    const blocks = readStoredSourceBlocks(db, 'c');
    const parts = blocks.map(p => ({ paragraphId: p.id, startOffset: 0, endOffset: p.text.length, selectedText: p.text }));
    const input = { editionId: 'e', bookId: 'book', chapterId: 'c', paragraphId: parts[0].paragraphId, selectionStart: 0, selectionEnd: parts[0].endOffset, selectedText: parts.map(p => p.selectedText).join('\n\n'), selectionAnchors: parts };
    expect(verifySelectionAnchors(db, input)).toMatchObject({ version: 2, fragments: parts });
    const skipped = [parts[0], parts[1], parts[3]];
    expect(verifySelectionAnchors(db, { ...input, selectedText: skipped.map(p => p.selectedText).join('\n\n'), selectionAnchors: skipped })).toBeNull();
    const changed = parts.map((p, i) => i === 2 ? { ...p, selectedText: '错标题' } : p);
    expect(verifySelectionAnchors(db, { ...input, selectedText: changed.map(p => p.selectedText).join('\n\n'), selectionAnchors: changed })).toBeNull();
});

it('旧版缺失的仅标题资源也能补建且不改变已有正文身份', () => {
  const titleOnly = {title:'扉页标题',sourceHref:'OPS/heading.xhtml',paragraphs:[],blocks:[{kind:'heading' as const,headingLevel:3 as const,text:'扉页标题',sourceOrdinal:0}]};
  installEpubHeadingSources(db,'e','hash',[titleOnly,...source]);
  const chapters=db.prepare('SELECT id,source_href FROM chapters ORDER BY order_index').all() as {id:string;source_href:string}[];
  expect(chapters.map(c=>c.source_href)).toEqual(['OPS/heading.xhtml','OPS/ch.xhtml']);
  expect(readStoredSourceBlocks(db,chapters[0].id)[0]).toMatchObject({text:'扉页标题',kind:'heading',headingLevel:3});
  expect(readStoredSourceBlocks(db,'c').filter(p=>p.kind==='paragraph').map(p=>p.id)).toEqual(['old','later']);
});
it('重复旧资源标识无法定位时拒绝补建，不能遗漏另一章', () => {
  db.prepare('INSERT INTO chapters VALUES(?,?,?,?,?)').run('duplicate','e','重复来源',1,'OPS/ch.xhtml');
  expect(()=>installEpubHeadingSources(db,'e','hash',source)).toThrow('章节来源无法精确对应');
  expect(readStoredSourceBlocks(db,'c').map(p=>p.id)).toEqual(['old','later']);
});
it('数据库来源元数据也经显式守卫核验，不把非法偏移传给阅读器', () => {
  installEpubHeadingSources(db,'e','hash',source);
  db.prepare('UPDATE reading_block_metadata SET source_ordinal=-1 WHERE paragraph_id=?').run('old');
  expect(()=>readStoredSourceBlocks(db,'c')).toThrow('来源位置无效');
});

it('第一版标题来源升级时补齐div小标题，所有既有正文与标题ID和标注保持不变',()=>{
 installEpubHeadingSources(db,'e','hash',source);
 const before=readStoredSourceBlocks(db,'c');
 db.prepare('UPDATE epub_block_versions SET version=1 WHERE edition_id=?').run('e');
 const upgraded={...source[0],legacyBlocks:source[0].blocks,legacySourceOrdinals:[0,1,null,2,3],blocks:[source[0].blocks[0],source[0].blocks[1],{kind:'paragraph' as const,text:'一 泛论逻辑',sourceOrdinal:2},{...source[0].blocks[2],sourceOrdinal:3},{...source[0].blocks[3],sourceOrdinal:4}]};
 installEpubHeadingSources(db,'e','hash',[upgraded]);
 const after=readStoredSourceBlocks(db,'c');
 expect(after.map(p=>p.text)).toEqual(['章标题','旧正文😀','一 泛论逻辑','小标题','后段']);
 expect(after.filter(p=>p.text!=='一 泛论逻辑').map(p=>p.id)).toEqual(before.map(p=>p.id));
 expect(after[2].kind).toBe('paragraph');expect(after[2].headingLevel).toBeUndefined();
 expect(db.prepare('SELECT text_hash FROM paragraphs WHERE id=?').get('old')).toEqual({text_hash:'old-hash'});
 expect(db.prepare('SELECT * FROM annotations').all()).toEqual([{id:'a',paragraph_id:'old',start_offset:3,end_offset:5}]);
 expect(hasEpubBlockVersion(db,'e','hash')).toBe(true);
 installEpubHeadingSources(db,'e','hash',[upgraded]);expect(readStoredSourceBlocks(db,'c')).toEqual(after);
});
it('第一版来源有篡改或第二版插入写入失败时不移动原有ID、次序与版本',()=>{
 installEpubHeadingSources(db,'e','hash',source);db.exec('UPDATE epub_block_versions SET version=1');
 const before=readStoredSourceBlocks(db,'c');
 const upgraded={...source[0],legacyBlocks:source[0].blocks,legacySourceOrdinals:[0,null,1,2,3],blocks:[source[0].blocks[0],{kind:'paragraph' as const,text:'独立文本',sourceOrdinal:1},...source[0].blocks.slice(1).map(b=>({...b,sourceOrdinal:b.sourceOrdinal+1}))]};
 db.exec("CREATE TRIGGER fail_upgrade BEFORE INSERT ON paragraphs BEGIN SELECT RAISE(ABORT,'补建写入失败'); END;");
 expect(()=>installEpubHeadingSources(db,'e','hash',[upgraded])).toThrow('补建写入失败');
 expect(readStoredSourceBlocks(db,'c')).toEqual(before);expect(hasEpubBlockVersion(db,'e','hash')).toBe(false);
});
