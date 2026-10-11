import { originalRelativePath, type StoredOriginalExtension } from './data-storage';
import { hasEpubBlockVersion, installEpubHeadingSources, type SourceDb } from './epub-block-store';
import type { ParsedEpub } from './epub-parser';
type OriginalIdentity = {
    relativePath: string;
    size: number;
    originalHash: string;
};
export type HeadingMigrationDependencies = {
    readOriginal(identity: OriginalIdentity): Promise<Buffer>;
    parse(bytes: Buffer): Promise<ParsedEpub>;
};
export async function prepareEpubHeadingSources(db: SourceDb, editionId: string, deps: HeadingMigrationDependencies): Promise<void> {
    const row = db.prepare('SELECT file_type AS fileType,original_file_path AS relativePath,original_file_size AS size,original_hash AS originalHash FROM editions WHERE id=?').get(editionId) as {
        fileType: string;
        relativePath: string;
        size: number;
        originalHash: string | null;
    } | undefined;
    if (!row || row.fileType.replace(/^\./u, '') !== 'epub' || !row.relativePath)
        return;
    if (!row.originalHash || row.relativePath.replaceAll('\\', '/') !== originalRelativePath(editionId, '.epub' as StoredOriginalExtension))
        throw new Error('EPUB 原件身份无效，未补建标题来源');
    if (hasEpubBlockVersion(db, editionId, row.originalHash))
        return;
    const bytes = await deps.readOriginal({ ...row, originalHash: row.originalHash });
    const parsed = await deps.parse(bytes);
    installEpubHeadingSources(db, editionId, row.originalHash, parsed.chapters);
}
