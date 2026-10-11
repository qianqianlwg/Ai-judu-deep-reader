import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
import { prepareEpubHeadingSources } from './epub-heading-migration';
import { EPUB_BLOCK_SCHEMA, type SourceDb } from './epub-block-store';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
    DatabaseSync: new (path: string) => SourceDb & {
        close(): void;
    };
};
it('非EPUB、无原件旧版本和已补建版本不做IO', async () => { const db = new DatabaseSync(':memory:'); try {
    db.exec(EPUB_BLOCK_SCHEMA + "CREATE TABLE editions(id TEXT,file_type TEXT,original_file_path TEXT,original_file_size INTEGER,original_hash TEXT);INSERT INTO editions VALUES('no-original','.epub','',0,NULL),('e','.epub','originals/e.epub',2,'hash');INSERT INTO epub_block_versions VALUES('e','hash',2)");
    const deps = { readOriginal: vi.fn(), parse: vi.fn() };
    await prepareEpubHeadingSources(db, 'no-original', deps);
    await prepareEpubHeadingSources(db, 'e', deps);
    expect(deps.readOriginal).not.toHaveBeenCalled();
    expect(deps.parse).not.toHaveBeenCalled();
}
finally {
    db.close();
} });
it('拒绝别版原件路径且向上抛IO失败，不伪造补建成功', async () => { const db = new DatabaseSync(':memory:'); try {
    db.exec(EPUB_BLOCK_SCHEMA + "CREATE TABLE editions(id TEXT,file_type TEXT,original_file_path TEXT,original_file_size INTEGER,original_hash TEXT);INSERT INTO editions VALUES('e','.epub','originals/other.epub',2,'hash');");
    const deps = { readOriginal: vi.fn().mockRejectedValue(new Error('原件损坏')), parse: vi.fn() };
    await expect(prepareEpubHeadingSources(db, 'e', deps)).rejects.toThrow('身份无效');
    expect(deps.readOriginal).not.toHaveBeenCalled();
    db.exec("UPDATE editions SET original_file_path='originals/e.epub'");
    await expect(prepareEpubHeadingSources(db, 'e', deps)).rejects.toThrow('原件损坏');
    expect(deps.parse).not.toHaveBeenCalled();
}
finally {
    db.close();
} });
