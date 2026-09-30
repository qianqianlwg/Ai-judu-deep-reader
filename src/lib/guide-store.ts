import type { getDb } from "./db";
import { GuideError, validateGuide, type GuideNode, type GuideState } from "./guide";
export type GuideDb = Pick<ReturnType<typeof getDb>, "exec" | "prepare">;
type Head = { version: number; current_revision: number | null; redo_json: string; updated_at: string | null };
type Revision = { id: number; parent_id: number | null; nodes_json: string; actor: "user" | "ai"; reason: string; created_at: string };
// WHY：SQLite 短事务保护版本检查与快照写入；模型网络请求不得持有此同步事务。
export function guideTransaction<T>(db: GuideDb, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const value = action(); db.exec("COMMIT"); return value; }
  catch (error: unknown) { db.exec("ROLLBACK"); throw error; }
}
export function guideHead(db: GuideDb, bookId: string): Head {
  return db.prepare("SELECT version,current_revision,redo_json,updated_at FROM guide_outlines WHERE book_id=?").get(bookId) as Head | undefined ?? { version: 0, current_revision: null, redo_json: "[]", updated_at: null };
}
export function guideNodes(db: GuideDb, revisionId: number | null): GuideNode[] {
  if (revisionId === null) return [];
  const row = db.prepare("SELECT nodes_json FROM guide_revisions WHERE id=?").get(revisionId) as { nodes_json: string } | undefined;
  if (!row) throw new Error("导读版本快照丢失");
  return validateGuide(JSON.parse(row.nodes_json));
}
export function guideSourceIds(db: GuideDb, bookId: string): Set<string> {
  return new Set((db.prepare("SELECT message_id FROM guide_sources WHERE book_id=?").all(bookId) as { message_id: string }[]).map(row => row.message_id));
}
export function requireGuideVersion(db: GuideDb, bookId: string, version: number): Head {
  const book = db.prepare("SELECT id FROM books WHERE id=?").get(bookId);
  if (!book) throw new GuideError("这本书不存在", 404);
  const head = guideHead(db, bookId);
  if (head.version !== version) throw new GuideError("导读刚有新的改动，已刷新到最新版本；请检查后再保存", 409);
  db.prepare("INSERT OR IGNORE INTO guide_outlines(book_id) VALUES(?)").run(bookId);
  return head;
}
export function saveGuideRevision(db: GuideDb, bookId: string, version: number, nodes: GuideNode[], actor: "user" | "ai", reason: string, usage?: unknown): void {
  const head = requireGuideVersion(db, bookId, version);
  const valid = validateGuide(nodes, guideSourceIds(db, bookId)), now = new Date().toISOString();
  db.prepare("INSERT INTO guide_revisions(book_id,parent_id,nodes_json,actor,reason,created_at,usage_json) VALUES(?,?,?,?,?,?,?)").run(bookId, head.current_revision, JSON.stringify(valid), actor, reason, now, usage ? JSON.stringify(usage) : null);
  const row = db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number };
  db.prepare("UPDATE guide_outlines SET version=version+1,current_revision=?,redo_json='[]',updated_at=? WHERE book_id=?").run(row.id, now, bookId);
}
export function navigateGuideHistory(db: GuideDb, bookId: string, version: number, direction: "undo" | "redo"): void {
  const head = requireGuideVersion(db, bookId, version), redo = JSON.parse(head.redo_json) as number[];
  let current = head.current_revision;
  if (direction === "undo") {
    if (current === null) throw new GuideError("没有可以撤销的改动");
    const row = db.prepare("SELECT parent_id FROM guide_revisions WHERE id=? AND book_id=?").get(current, bookId) as { parent_id: number | null };
    redo.unshift(current); current = row.parent_id;
  } else { const next = redo.shift(); if (!next) throw new GuideError("没有可以重做的改动"); current = next; }
  db.prepare("UPDATE guide_outlines SET version=version+1,current_revision=?,redo_json=?,updated_at=? WHERE book_id=?").run(current, JSON.stringify(redo), new Date().toISOString(), bookId);
}
export function restoreGuideRevision(db: GuideDb, bookId: string, version: number, revisionId: number): void {
  const row = db.prepare("SELECT nodes_json FROM guide_revisions WHERE id=? AND book_id=?").get(revisionId, bookId) as { nodes_json: string } | undefined;
  if (!row) throw new GuideError("历史版本不存在", 404);
  saveGuideRevision(db, bookId, version, JSON.parse(row.nodes_json), "user", "恢复历史版本");
}
export function readGuideState(db: GuideDb, bookId: string): GuideState {
  const book = db.prepare("SELECT title FROM books WHERE id=?").get(bookId) as { title: string } | undefined;
  if (!book) throw new GuideError("这本书不存在", 404);
  const head = guideHead(db, bookId);
  const rows = db.prepare("SELECT id,parent_id,actor,reason,created_at FROM guide_revisions WHERE book_id=? ORDER BY id DESC LIMIT 60").all(bookId) as Revision[];
  const statuses = db.prepare("SELECT status,count(*) AS n FROM guide_sources WHERE book_id=? GROUP BY status").all(bookId) as { status: string; n: number }[];
  const count = (status: string) => statuses.find(row => row.status === status)?.n ?? 0;
  const error = db.prepare("SELECT error FROM guide_sources WHERE book_id=? AND status='failed' ORDER BY created_at DESC LIMIT 1").get(bookId) as { error: string } | undefined;
  return { bookId, title: book.title, version: head.version, nodes: guideNodes(db, head.current_revision), canUndo: head.current_revision !== null, canRedo: (JSON.parse(head.redo_json) as number[]).length > 0,
    revisions: rows.map(row => ({ id: row.id, actor: row.actor, reason: row.reason, createdAt: row.created_at, current: row.id === head.current_revision })), pending: count("pending") + count("processing"), failed: count("failed"), processed: count("completed"), lastError: error?.error ?? null, updatedAt: head.updated_at, historicalCount: 0 };
}
