export type ShelfStore={exec(sql:string):void;prepare(sql:string):{get(...args:unknown[]):unknown;all(...args:unknown[]):unknown[];run(...args:unknown[]):unknown}};
// WHY：下架只是书架可见性，不删除 BookID/版本/文件/标注/会话/向量；独立表避免改写既有书籍数据。
export const BOOK_SHELF_SCHEMA='CREATE TABLE IF NOT EXISTS book_shelf_state (book_id TEXT PRIMARY KEY, archived_at TEXT NOT NULL)';
export const ACTIVE_BOOKS_FILTER='NOT EXISTS (SELECT 1 FROM book_shelf_state WHERE book_id=books.id)';
export function ensureBookShelf(db:ShelfStore):void {db.exec(BOOK_SHELF_SCHEMA);}
export function setBookArchived(db:ShelfStore,bookId:string,archived:boolean):boolean{
 ensureBookShelf(db);
 // WHY：同步短事务只更新本地 SQLite 元数据；不存在的 BookID 不得创建幽灵下架记录。
 db.exec('BEGIN IMMEDIATE');
 try{
  if(!db.prepare('SELECT id FROM books WHERE id=?').get(bookId)){db.exec('COMMIT');return false;}
  if(archived)db.prepare('INSERT INTO book_shelf_state(book_id,archived_at) VALUES(?,?) ON CONFLICT(book_id) DO NOTHING').run(bookId,new Date().toISOString());
  else db.prepare('DELETE FROM book_shelf_state WHERE book_id=?').run(bookId);
  db.exec('COMMIT');return true;
 }catch(error:unknown){db.exec('ROLLBACK');throw error;}
}
