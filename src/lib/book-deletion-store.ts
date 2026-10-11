import {z} from 'zod';
import {ensureBookShelf,type ShelfStore} from './book-shelf';
import {originalRelativePath,derivedRelativePath,type StoredOriginalExtension} from './data-storage';
import {EMBEDDING_BATCH_LEASE_MS} from './embedding-provider';
const id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const extension=z.enum(['.epub','.pdf','.mobi','.txt','.md','.fb2','.fbz','.cbz','.umd']);
const fileSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('original'),editionId:id,extension,path:z.string()}),
 z.object({kind:z.literal('derived'),editionId:id,path:z.string()}),
 z.object({kind:z.literal('cover'),hash:z.string().regex(/^[a-f0-9]{64}$/u),path:z.string()})
]);
export type BookDeletionFile=z.infer<typeof fileSchema>;
export type BookDeletionPlan={bookId:string;editionIds:string[];files:BookDeletionFile[]};
export class BookDeletionError extends Error{constructor(readonly status:number,message:string){super(message);}}
export const BOOK_DELETION_SCHEMA='CREATE TABLE IF NOT EXISTS book_deletion_jobs (book_id TEXT PRIMARY KEY, files_json TEXT NOT NULL, created_at TEXT NOT NULL)';
const cte=`WITH target_book AS (SELECT id FROM books WHERE id=?),target_editions AS (SELECT id FROM editions WHERE book_id IN target_book),target_chapters AS (SELECT id FROM chapters WHERE edition_id IN target_editions),target_paragraphs AS (SELECT id FROM paragraphs WHERE chapter_id IN target_chapters),target_threads AS (SELECT id FROM reading_threads WHERE book_id IN target_book OR edition_id IN target_editions),target_messages AS (SELECT id FROM chat_messages WHERE thread_id IN target_threads) `;
const edition='edition_id IN target_editions',book='book_id IN target_book',paragraph='paragraph_id IN target_paragraphs',thread='thread_id IN target_threads',message='message_id IN target_messages';
// WHY：按真实外键身份逐表清理，不能按书名或JSON关键词删除，不能误删同名书、全局设置或其他书的历史。
const tables:readonly (readonly [string,string])[]=[
 ['agent_tool_runs',`${thread} OR ${message}`],['guide_sources',`${book} OR ${edition} OR ${thread} OR ${message}`],
 ['context_snapshots',`${book} OR ${edition} OR ${thread}`],['annotations',`${paragraph} OR ${thread}`],
 ['reading_block_metadata',paragraph],['analyses',`${edition} OR chapter_id IN target_chapters OR ${paragraph}`],
 ['reading_marks',edition],['source_emphasis',edition],['paragraph_embeddings',edition],
 ['embedding_build_leases',edition],['embedding_index_jobs',edition],['epub_block_versions',edition],['epub_navigation_cache',edition],
 ['legacy_thread_id_migrations',edition],['edition_conversions',edition],
 ['guide_outlines',book],['guide_revisions',book],['book_display_titles',book],['book_shelf_state',book],
 ['chat_messages','id IN target_messages'],['reading_threads','id IN target_threads'],
 ['paragraphs','id IN target_paragraphs'],['chapters','id IN target_chapters'],['editions','id IN target_editions'],['books','id IN target_book']
];
function tableNames(db:ShelfStore):Set<string>{return new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map(row=>row.name));}
export function validateDeletionFile(file:BookDeletionFile):void{
 const expected=file.kind==='original'?originalRelativePath(file.editionId,file.extension as StoredOriginalExtension):file.kind==='derived'?derivedRelativePath(file.editionId):'covers-v1/'+file.hash+'.webp';
 if(file.path!==expected)throw new BookDeletionError(409,'删除文件的路径与书籍身份不匹配，未继续删除');
}
function assertKnownSchema(db:ShelfStore,present:Set<string>):void{
 const known=new Set([...tables.map(([name])=>name),'book_deletion_jobs']);
 for(const name of present){if(known.has(name)||name.startsWith('sqlite_'))continue;
  if(!/^[a-z][a-z0-9_]*$/u.test(name))throw new BookDeletionError(409,'书库包含未知数据表，未开始永久删除');
  const columns=db.prepare('PRAGMA table_info("'+name+'")').all() as {name:string}[];
  if(columns.some(c=>['book_id','edition_id','chapter_id','paragraph_id','thread_id','message_id'].includes(c.name)))throw new BookDeletionError(409,'书库包含尚未支持清理的关联数据表，未开始永久删除');
 }
}
export function assertBookDeletable(db:ShelfStore,bookId:string):void{
 id.parse(bookId);ensureBookShelf(db);
 if(!db.prepare('SELECT id FROM books WHERE id=?').get(bookId))throw new BookDeletionError(404,'书籍不存在，可能已经删除');
 if(!db.prepare('SELECT book_id FROM book_shelf_state WHERE book_id=?').get(bookId))throw new BookDeletionError(409,'请先下架书籍，再永久删除');
 const present=tableNames(db);assertKnownSchema(db,present);const now=Date.now();
 if(present.has('chat_messages')&&present.has('reading_threads')){
  const active=db.prepare(cte+"SELECT structured_output AS payload FROM chat_messages WHERE thread_id IN target_threads AND status='streaming'").all(bookId) as {payload:string|null}[];
  for(const row of active){let payload:unknown;try{payload=row.payload?JSON.parse(row.payload):null;}catch(cause:unknown){console.warn('读取待删除书籍的生成租约失败',cause);throw new BookDeletionError(409,'本书存在无法确认状态的生成任务，请等待任务结束');}
   const request=payload&&typeof payload==='object'&&'_request'in payload?payload._request:null;
   const lease=request&&typeof request==='object'&&'leaseUntil'in request?request.leaseUntil:null;
   if(typeof lease!=='number'||lease>now)throw new BookDeletionError(409,'本书仍在生成回答，请停止或等待完成后删除');
  }
 }
 if(present.has('guide_sources')&&db.prepare(cte+"SELECT 1 FROM guide_sources WHERE book_id IN target_book AND status='processing' AND (lease_until IS NULL OR lease_until>?) LIMIT 1").get(bookId,now))throw new BookDeletionError(409,'本书导读正在整理，请等待完成后删除');
 if(present.has('embedding_build_leases')&&db.prepare(cte+'SELECT 1 FROM embedding_build_leases WHERE edition_id IN target_editions AND expires_at>? LIMIT 1').get(bookId,now))throw new BookDeletionError(409,'本书正在建立索引，请等待完成后删除');
 if(present.has('embedding_index_jobs')&&db.prepare(cte+"SELECT 1 FROM embedding_index_jobs WHERE edition_id IN target_editions AND status IN ('running','pausing') AND updated_at>? LIMIT 1").get(bookId,now-EMBEDDING_BATCH_LEASE_MS))throw new BookDeletionError(409,'本书索引任务仍在运行，请暂停并等待请求结束后删除');
}
export function prepareBookDeletion(db:ShelfStore,bookId:string):BookDeletionPlan{
 assertBookDeletable(db,bookId);db.exec(BOOK_DELETION_SCHEMA);
 const editions=db.prepare('SELECT id,file_type AS extension,original_file_path AS path,original_hash AS hash FROM editions WHERE book_id=?').all(bookId) as {id:string;extension:string;path:string;hash:string|null}[];
 let files:BookDeletionFile[]=[];
 const saved=db.prepare('SELECT files_json AS json FROM book_deletion_jobs WHERE book_id=?').get(bookId) as {json:string}|undefined;
 if(saved){files=z.array(fileSchema).parse(JSON.parse(saved.json) as unknown);}
 else{
  for(const row of editions){if(row.path){files.push({kind:'original',editionId:row.id,extension:extension.parse(row.extension.startsWith('.')?row.extension.toLowerCase():'.'+row.extension.toLowerCase()),path:row.path.replaceAll('\\','/')});}if(row.hash){files.push({kind:'cover',hash:row.hash,path:'covers-v1/'+row.hash+'.webp'});}}
  if(tableNames(db).has('edition_conversions'))for(const row of db.prepare('SELECT edition_id AS editionId,file_path AS path FROM edition_conversions WHERE edition_id IN(SELECT id FROM editions WHERE book_id=?)').all(bookId) as {editionId:string;path:string}[])files.push({kind:'derived',editionId:row.editionId,path:row.path.replaceAll('\\','/')});
 }
 const owned=new Set(editions.map(row=>row.id)),ownedHashes=new Set(editions.map(row=>row.hash));
 files.forEach(file=>{fileSchema.parse(file);validateDeletionFile(file);if(file.kind==='cover'&&!ownedHashes.has(file.hash))throw new BookDeletionError(409,'删除封面不属于当前书籍，未继续删除');if(file.kind!=='cover'&&!owned.has(file.editionId))throw new BookDeletionError(409,'删除文件不属于当前书籍，未继续删除');});
 files=[...new Map(files.map(file=>[file.path,file])).values()];
 // WHY：文件IO不跨SQLite事务；持久化不可逆删除意图，使部分失败或重启后可以重试，且禁止恢复已经开始删除的书籍。
 db.prepare('INSERT INTO book_deletion_jobs(book_id,files_json,created_at) VALUES(?,?,?) ON CONFLICT(book_id) DO NOTHING').run(bookId,JSON.stringify(files),new Date().toISOString());
 return {bookId,editionIds:[...owned],files};
}
export function coverSharedWithOtherBook(db:ShelfStore,bookId:string,hash:string):boolean{
 return Boolean(db.prepare('SELECT 1 FROM editions WHERE book_id<>? AND original_hash=? LIMIT 1').get(bookId,hash));
}
export function finishBookDeletion(db:ShelfStore,bookId:string):void{
 // WHY：文件已处理后用同步短事务原子删除全部关联记录；失败保留意图和下架记录，不能把部分清理伪装为成功。
 db.exec('BEGIN IMMEDIATE');try{assertBookDeletable(db,bookId);const present=tableNames(db);
  for(const [name,where]of tables)if(present.has(name))db.prepare(cte+'DELETE FROM "'+name+'" WHERE '+where).run(bookId);
  db.prepare('DELETE FROM book_deletion_jobs WHERE book_id=?').run(bookId);db.exec('COMMIT');
 }catch(error:unknown){try{db.exec('ROLLBACK');}catch(rollback:unknown){throw new AggregateError([error,rollback],'书籍删除事务及回滚失败');}throw error;}
}
