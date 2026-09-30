import type {getDb} from './db';
import {sourceEmphasisSchema,type SourceEmphasis} from './source-enhancement';
type Db=ReturnType<typeof getDb>;
export const SOURCE_EMPHASIS_SCHEMA=`CREATE TABLE IF NOT EXISTS source_emphasis (edition_id TEXT NOT NULL, paragraph_id TEXT NOT NULL, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, kind TEXT NOT NULL, quote TEXT NOT NULL, PRIMARY KEY(edition_id,paragraph_id,start_offset,end_offset,kind));`;
// WHY：同步写入由调用方事务统一装配；原文、重点和生成结果必须绑定同一版本，不接收模型指定的版本。
export function saveSourceEmphasis(db:Db,editionId:string,marks:readonly SourceEmphasis[]):void{
 for(const input of marks){const m=sourceEmphasisSchema.parse(input),row=db.prepare('SELECT p.text FROM paragraphs p JOIN chapters c ON c.id=p.chapter_id WHERE p.id=? AND c.edition_id=?').get(m.paragraphId,editionId) as {text:string}|undefined;if(!row||row.text.slice(m.startOffset,m.endOffset)!==m.quote)throw new Error('重点与当前版本原文不一致');
 db.prepare('DELETE FROM source_emphasis WHERE edition_id=? AND paragraph_id=? AND start_offset<? AND end_offset>?').run(editionId,m.paragraphId,m.endOffset,m.startOffset);
 db.prepare('INSERT INTO source_emphasis VALUES(?,?,?,?,?,?)').run(editionId,m.paragraphId,m.startOffset,m.endOffset,m.kind,m.quote);
 }
}
export function readSourceEmphasis(db:Db,editionId:string):SourceEmphasis[]{
 const rows=db.prepare('SELECT s.paragraph_id AS paragraphId,s.start_offset AS startOffset,s.end_offset AS endOffset,s.kind,s.quote,p.text FROM source_emphasis s JOIN paragraphs p ON p.id=s.paragraph_id JOIN chapters c ON c.id=p.chapter_id WHERE s.edition_id=? AND c.edition_id=? ORDER BY s.paragraph_id,s.start_offset').all(editionId,editionId) as (SourceEmphasis&{text:string})[];
 return rows.flatMap(({text,...m})=>sourceEmphasisSchema.safeParse(m).success&&text.slice(m.startOffset,m.endOffset)===m.quote?[m]:[]);
}
