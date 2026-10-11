import { originalRelativePath } from './data-storage';
import { bookNavigation, readBookNavigation, type BookNavigationItem } from './book-navigation';
import type { LibraryChapter } from './library';
import type { SourceDb } from './epub-block-store';
import type { HeadingMigrationDependencies } from './epub-heading-migration';
export const EPUB_NAVIGATION_SCHEMA = `CREATE TABLE IF NOT EXISTS epub_navigation_cache (edition_id TEXT PRIMARY KEY, original_hash TEXT NOT NULL, version INTEGER NOT NULL, navigation_json TEXT NOT NULL);`;
export function saveBookNavigation(db: SourceDb, editionId: string, hash: string, navigation: BookNavigationItem[]): void {
  db.prepare('INSERT INTO epub_navigation_cache VALUES(?,?,1,?) ON CONFLICT(edition_id) DO UPDATE SET original_hash=excluded.original_hash,version=excluded.version,navigation_json=excluded.navigation_json').run(editionId, hash, JSON.stringify(navigation));
}
export async function readEditionNavigation(db: SourceDb, editionId: string, chapters: LibraryChapter[], deps: HeadingMigrationDependencies): Promise<BookNavigationItem[] | undefined> {
  const edition = db.prepare('SELECT file_type AS fileType,original_file_path AS relativePath,original_file_size AS size,original_hash AS originalHash FROM editions WHERE id=?').get(editionId) as {fileType:string;relativePath:string;size:number;originalHash:string|null}|undefined;
  if (!edition || edition.fileType.replace(/^\./u, '') !== 'epub' || !edition.relativePath || !edition.originalHash) return undefined;
  if(edition.relativePath.replaceAll('\\','/')!==originalRelativePath(editionId,'.epub'))throw new Error('目录原件身份与版本不匹配');
  // WHY：目录是原件派生缓存，独立增量建表不修改章节、段落、会话或标注；缓存损坏必须报错，不能伪装成空目录。
  db.exec(EPUB_NAVIGATION_SCHEMA);
  const cached = db.prepare('SELECT navigation_json AS json FROM epub_navigation_cache WHERE edition_id=? AND original_hash=? AND version=1').get(editionId, edition.originalHash) as {json:string}|undefined;
  if (cached) return readBookNavigation(JSON.parse(cached.json) as unknown);
  const bytes = await deps.readOriginal({ ...edition, originalHash: edition.originalHash });
  const parsed = await deps.parse(bytes);
  const navigation = bookNavigation(parsed.navigation ?? [], chapters, parsed.chapters);
  saveBookNavigation(db, editionId, edition.originalHash, navigation);
  return navigation;
}
