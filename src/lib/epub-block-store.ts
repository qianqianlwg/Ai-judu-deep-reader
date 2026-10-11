import {retainsLegacyWholePage} from './epub-legacy-whole-page';
import {createHash} from 'node:crypto';
import type {createDatabase} from './db';
import type {LibraryParagraph} from './library';
import type {ParsedChapter} from './epub-parser';
import {EPUB_SUPPLEMENTAL_BLOCK_PREFIX,readSourceBlockMetadata,type ParsedSourceBlock} from './source-block';
import {hashText} from './hash';
export type SourceDb=Pick<ReturnType<typeof createDatabase>,'prepare'|'exec'>;
export const EPUB_BLOCK_VERSION=2;
export const EPUB_BLOCK_SCHEMA=`CREATE TABLE IF NOT EXISTS reading_block_metadata (
 paragraph_id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('heading','paragraph')),heading_level INTEGER,source_ordinal INTEGER NOT NULL,
 CHECK((kind='heading' AND heading_level BETWEEN 1 AND 6) OR (kind='paragraph' AND heading_level IS NULL)));
 CREATE TABLE IF NOT EXISTS epub_block_versions (edition_id TEXT PRIMARY KEY,original_hash TEXT NOT NULL,version INTEGER NOT NULL);`;
// WHY：新独立文本块使用版本化身份，避免插入位置与上一版按次序生成的标题 ID 碰撞；已有块始终复用旧 ID。
const stableId=(editionId:string,chapterId:string,ordinal:number,identity='')=>EPUB_SUPPLEMENTAL_BLOCK_PREFIX+createHash('sha256').update(JSON.stringify([editionId,chapterId,'text-containers-v2',ordinal,identity])).digest('hex').slice(0,40);
export function saveBlockMetadata(db:SourceDb,id:string,block:ParsedSourceBlock):void{
 db.prepare('INSERT INTO reading_block_metadata (paragraph_id,kind,heading_level,source_ordinal) VALUES (?,?,?,?) ON CONFLICT(paragraph_id) DO UPDATE SET kind=excluded.kind,heading_level=excluded.heading_level,source_ordinal=excluded.source_ordinal').run(id,block.kind,block.headingLevel??null,block.sourceOrdinal);
}
export function readStoredSourceBlocks(db:SourceDb,chapterId:string):LibraryParagraph[]{
 const table=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reading_block_metadata'").get();
 if(!table)return db.prepare('SELECT id,text FROM paragraphs WHERE chapter_id=? ORDER BY order_index,id').all(chapterId) as LibraryParagraph[];
 const rows=db.prepare('SELECT p.id,p.text,m.kind,m.heading_level AS headingLevel,m.source_ordinal AS sourceOrdinal FROM paragraphs p LEFT JOIN reading_block_metadata m ON m.paragraph_id=p.id WHERE p.chapter_id=? ORDER BY p.order_index,p.id').all(chapterId) as {id:string;text:string;kind:string|null;headingLevel:number|null;sourceOrdinal:number|null}[];
 return rows.map(row=>({id:row.id,text:row.text,...(row.kind===null?{}:readSourceBlockMetadata({kind:row.kind,headingLevel:row.headingLevel??undefined,sourceOrdinal:row.sourceOrdinal??undefined}))}));
}
function epubBlockVersion(db:SourceDb,editionId:string,originalHash:string):number{
 const row=db.prepare('SELECT version FROM epub_block_versions WHERE edition_id=? AND original_hash=?').get(editionId,originalHash) as {version:number}|undefined;
 return row?.version??0;
}
export function hasEpubBlockVersion(db:SourceDb,editionId:string,originalHash:string):boolean{return epubBlockVersion(db,editionId,originalHash)===EPUB_BLOCK_VERSION;}
export function recordEpubBlockVersion(db:SourceDb,editionId:string,originalHash:string):void{
 db.prepare('INSERT INTO epub_block_versions (edition_id,original_hash,version) VALUES (?,?,?) ON CONFLICT(edition_id) DO UPDATE SET original_hash=excluded.original_hash,version=excluded.version').run(editionId,originalHash,EPUB_BLOCK_VERSION);
}
export function installEpubHeadingSources(db:SourceDb,editionId:string,originalHash:string,chapters:readonly ParsedChapter[]):void{
 const version=epubBlockVersion(db,editionId,originalHash);
 if(version===EPUB_BLOCK_VERSION)return;
 if(version!==0&&version!==1)throw new Error('不支持的原文内容块版本，未覆盖现有来源');
 const existing=db.prepare('SELECT id,title,source_href AS sourceHref FROM chapters WHERE edition_id=? ORDER BY order_index,id').all(editionId) as {id:string;title:string;sourceHref:string|null}[];
 const parsedByHref=new Map(chapters.map(chapter=>[chapter.sourceHref,chapter]));
 if(parsedByHref.size!==chapters.length||new Set(existing.map(chapter=>chapter.sourceHref)).size!==existing.length||existing.some(chapter=>!chapter.sourceHref||!parsedByHref.has(chapter.sourceHref)))throw new Error('原书章节来源无法精确对应，未补建标题来源');
 const plans=chapters.map((parsed,chapterIndex)=>{
  const previous=existing.find(chapter=>chapter.sourceHref===parsed.sourceHref);
  const id=previous?.id??stableId(editionId,parsed.sourceHref,-1);
  const rows=previous?readStoredSourceBlocks(db,id):[];
  const legacyBlocks=parsed.legacyBlocks??parsed.blocks;
  const legacyOrdinals=parsed.legacySourceOrdinals??parsed.blocks.map(block=>block.sourceOrdinal);
  if(legacyOrdinals.length!==parsed.blocks.length)throw new Error('原书内容块投影不完整，未猜测来源');
  const hasVersionOne=version===1&&Boolean(previous);
  if(hasVersionOne){
   if(rows.length!==legacyBlocks.length||rows.some((row,index)=>{const block=legacyBlocks[index];return row.text!==block.text||row.kind!==block.kind||row.headingLevel!==block.headingLevel||row.sourceOrdinal!==block.sourceOrdinal;}))throw new Error('原书第一版标题或正文与已保存来源不一致，未覆盖任何内容或标注');
  }else if(rows.length!==parsed.paragraphs.length||rows.some((row,index)=>row.kind==='heading'||row.text!==parsed.paragraphs[index]))throw new Error('原书正文与已保存内容不一致，未覆盖任何原文或标注');
  if(retainsLegacyWholePage(rows,parsed))return {id,previous,parsed,chapterIndex,blocks:[],retainedLegacyId:rows[0].id};
  const rowsByOrdinal=new Map(rows.map(row=>[row.sourceOrdinal,row]));
  const usedIds=new Set<string>();
  let cursor=0;
  const blocks=parsed.blocks.map((block,index)=>{
   const oldOrdinal=legacyOrdinals[index];
   let old:LibraryParagraph|undefined;
   if(hasVersionOne&&oldOrdinal!==null){old=rowsByOrdinal.get(oldOrdinal);if(!old)throw new Error('第一版内容块未能精确对应，未猜测原文身份');}
   else if(!hasVersionOne&&oldOrdinal!==null&&block.kind==='paragraph'){
    if(rows[cursor]?.text===block.text)old=rows[cursor++];
    else if(block.text!==parsed.title)throw new Error('缺失正文块不能冒充新增标题');
   }
   if(old){if(old.text!==block.text||usedIds.has(old.id))throw new Error('原文来源未能一一逐字对应');usedIds.add(old.id);}
   return {id:old?.id??stableId(editionId,id,block.sourceOrdinal,JSON.stringify([block.kind,block.headingLevel??null,block.text])),old:Boolean(old),block};
  });
  if(usedIds.size!==rows.length)throw new Error('正文来源覆盖不完整，未补建标题来源');
  return {id,previous,parsed,chapterIndex,blocks};
 });
 // WHY：文件解析与全部逐字计划核验结束后才持同步写锁；更新次序、元数据、缺失文本和版本在同一事务提交，不跨 await。
 db.exec('BEGIN IMMEDIATE');
 try{
  if(hasEpubBlockVersion(db,editionId,originalHash)){db.exec('COMMIT');return;}
  for(const plan of plans){
   if(!plan.previous)db.prepare('INSERT INTO chapters (id,edition_id,title,order_index,source_href) VALUES (?,?,?,?,?)').run(plan.id,editionId,plan.parsed.title,plan.chapterIndex,plan.parsed.sourceHref);
   else db.prepare('UPDATE chapters SET order_index=? WHERE id=?').run(plan.chapterIndex,plan.id);
   // WHY：旧整页块保留正文、ID、哈希与偏移；不冒充新容器 ordinal，原版仍以整页逐字映射。
   if(plan.retainedLegacyId)db.prepare('DELETE FROM reading_block_metadata WHERE paragraph_id=?').run(plan.retainedLegacyId);
   plan.blocks.forEach(({id,old,block},index)=>{
    if(old)db.prepare('UPDATE paragraphs SET order_index=? WHERE id=?').run(index,id);
    else db.prepare('INSERT INTO paragraphs (id,chapter_id,text,text_hash,order_index) VALUES (?,?,?,?,?)').run(id,plan.id,block.text,hashText(block.text),index);
    saveBlockMetadata(db,id,block);
   });
  }
  recordEpubBlockVersion(db,editionId,originalHash);db.exec('COMMIT');
 }catch(cause:unknown){try{db.exec('ROLLBACK');}catch(rollback:unknown){throw new AggregateError([cause,rollback],'标题补建及回滚失败');}throw cause;}
}
