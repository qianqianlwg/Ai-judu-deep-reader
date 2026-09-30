// WHY：导读快照与句读正文分开持久化；撤销仅回退导读，不删除阅读历史或重新消费旧句读。
export const GUIDE_SCHEMA = `
CREATE TABLE IF NOT EXISTS guide_outlines (book_id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0, current_revision INTEGER, redo_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT);
CREATE TABLE IF NOT EXISTS guide_revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, book_id TEXT NOT NULL, parent_id INTEGER, nodes_json TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, usage_json TEXT);
CREATE INDEX IF NOT EXISTS idx_guide_revisions_book ON guide_revisions(book_id,id);
CREATE TABLE IF NOT EXISTS guide_sources (message_id TEXT PRIMARY KEY, book_id TEXT NOT NULL, edition_id TEXT NOT NULL, thread_id TEXT NOT NULL, parent_message_id TEXT, anchor_json TEXT NOT NULL, chapter_title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL, completed_at TEXT);
CREATE INDEX IF NOT EXISTS idx_guide_sources_queue ON guide_sources(status,next_attempt,book_id,created_at);
`;
