import {beforeEach,afterEach,expect,it} from 'vitest';
import type {getDb} from './db';import {SOURCE_EMPHASIS_SCHEMA,saveSourceEmphasis,readSourceEmphasis} from './source-enhancement-store';
type Db=ReturnType<typeof getDb>;const runtime=(process as unknown as {getBuiltinModule(n:string):{DatabaseSync:new(p:string)=>Db}}).getBuiltinModule('node:sqlite');let db:Db;
beforeEach(()=>{db=new runtime.DatabaseSync(':memory:');db.exec(SOURCE_EMPHASIS_SCHEMA+"CREATE TABLE chapters(id TEXT,edition_id TEXT);CREATE TABLE paragraphs(id TEXT,chapter_id TEXT,text TEXT);INSERT INTO chapters VALUES('c','e');INSERT INTO paragraphs VALUES('p','c','权责关系需要明确。');");});afterEach(()=>db.close());
const mark={paragraphId:'p',startOffset:0,endOffset:4,quote:'权责关系',kind:'term' as const};
it('持久化与重读，错版/过期文本拒绝，不改原文',()=>{saveSourceEmphasis(db,'e',[mark]);expect(readSourceEmphasis(db,'e')).toEqual([mark]);expect(readSourceEmphasis(db,'other')).toEqual([]);expect(()=>saveSourceEmphasis(db,'other',[mark])).toThrow('不一致');db.exec("UPDATE paragraphs SET text='已变化'");expect(readSourceEmphasis(db,'e')).toEqual([]);});
it('同处重新生成替换旧重点，事务回滚可保持原值',()=>{saveSourceEmphasis(db,'e',[mark]);db.exec('BEGIN');saveSourceEmphasis(db,'e',[{...mark,endOffset:2,quote:'权责'}]);db.exec('ROLLBACK');expect(readSourceEmphasis(db,'e')).toEqual([mark]);});
