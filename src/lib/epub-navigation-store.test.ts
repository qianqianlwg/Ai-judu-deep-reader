import {createRequire} from 'node:module';
import {expect,it,vi} from 'vitest';
import {EPUB_NAVIGATION_SCHEMA,readEditionNavigation} from './epub-navigation-store';
import type {SourceDb} from './epub-block-store';
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite') as {DatabaseSync:new(path:string)=>SourceDb&{close():void}};
it('旧版读取原书目录只新增派生缓存，不改章节段落ID和文本，后续不重复解析',async()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec(EPUB_NAVIGATION_SCHEMA+"CREATE TABLE editions(id TEXT,file_type TEXT,original_file_path TEXT,original_file_size INTEGER,original_hash TEXT);INSERT INTO editions VALUES('e','.epub','originals/e.epub',1,'hash');");
 const chapters=[{id:'c',title:'未命名章节1',sourceHref:'ch.xhtml',paragraphs:[{id:'p',text:'原文',sourceOrdinal:0}]}];
 const deps={readOriginal:vi.fn().mockResolvedValue(Buffer.from('x')),parse:vi.fn().mockResolvedValue({title:'书',author:'作者',chapters:[{title:'真实章名',sourceHref:'ch.xhtml',paragraphs:['原文'],blocks:[]}],navigation:[{label:'真实章名',href:'ch.xhtml',children:[]}]})};
 const nav=await readEditionNavigation(db,'e',chapters,deps);expect(nav?.[0]).toMatchObject({label:'真实章名',chapterId:'c',paragraphId:'p'});expect(chapters[0].title).toBe('未命名章节1');
 expect(await readEditionNavigation(db,'e',chapters,deps)).toEqual(nav);expect(deps.parse).toHaveBeenCalledOnce();
 }finally{db.close();}
});
it('非EPUB和无原件历史不做IO，损坏缓存报错不当空目录',async()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec(EPUB_NAVIGATION_SCHEMA+"CREATE TABLE editions(id TEXT,file_type TEXT,original_file_path TEXT,original_file_size INTEGER,original_hash TEXT);INSERT INTO editions VALUES('old','.epub','',0,NULL),('e','.epub','originals/e.epub',1,'hash');INSERT INTO epub_navigation_cache VALUES('e','hash',1,'not-json');");
 const deps={readOriginal:vi.fn(),parse:vi.fn()};expect(await readEditionNavigation(db,'old',[],deps)).toBeUndefined();await expect(readEditionNavigation(db,'e',[],deps)).rejects.toThrow();expect(deps.readOriginal).not.toHaveBeenCalled();
 }finally{db.close();}
});
