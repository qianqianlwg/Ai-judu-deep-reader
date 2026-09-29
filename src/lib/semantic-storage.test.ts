import {beforeEach,afterEach,describe,expect,it} from 'vitest';
import type {getDb} from './db';
import {commitSemanticUnit,resolveChapterSelection} from './semantic-storage';
import {resolveSemanticPlan} from './semantic-reading';
type Db=ReturnType<typeof getDb>;
const runtime=(process as unknown as {getBuiltinModule(name:string):{DatabaseSync:new(file:string)=>Db}}).getBuiltinModule('node:sqlite');
let db:Db;
const source='前言这是十字原文用来句读后文';
const scope={threadId:'t',editionId:'edition-1',bookId:'book-1',parentId:'parent',attemptId:'a',model:'test'};
beforeEach(()=>{db=new runtime.DatabaseSync(':memory:');db.exec(String.raw`
    CREATE TABLE ai_provider_configs (id TEXT PRIMARY KEY, provider TEXT, base_url TEXT, api_key TEXT, model TEXT);
    INSERT INTO ai_provider_configs VALUES ('default', 'openai', 'https://provider.test', 'test-key', 'test-model');
    CREATE TABLE reading_threads (id TEXT PRIMARY KEY, book_id TEXT, edition_id TEXT NOT NULL, chapter_id TEXT, paragraph_id TEXT, selected_text TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE chat_messages (id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, content TEXT NOT NULL, raw_content TEXT, structured_output TEXT, status TEXT, model_name TEXT, prompt_version TEXT, created_at TEXT, usage_json TEXT);
    CREATE TABLE agent_tool_runs (id TEXT PRIMARY KEY, message_id TEXT, thread_id TEXT, attempt_id TEXT, tool_name TEXT, input_json TEXT, output_json TEXT, status TEXT, created_at TEXT);
    CREATE TABLE context_snapshots (id TEXT PRIMARY KEY, thread_id TEXT, book_id TEXT, edition_id TEXT, summary TEXT, recent_messages TEXT, token_count INTEGER, version INTEGER, created_at TEXT, checkpoint_json TEXT);
    CREATE TABLE chapters (id TEXT PRIMARY KEY, edition_id TEXT, title TEXT, order_index INTEGER);
    CREATE TABLE paragraphs (id TEXT PRIMARY KEY, chapter_id TEXT, text TEXT, order_index INTEGER);
    INSERT INTO chapters VALUES ('chapter-1', 'edition-1', '导论', 0), ('chapter-2', 'edition-2', '另一版', 0);
    INSERT INTO paragraphs VALUES ('p1', 'chapter-1', '前言这是十字原文用来句读后文', 0), ('p2', 'chapter-2', '前言这是十字原文用来句读后文', 0);

 CREATE TABLE editions(id TEXT PRIMARY KEY,book_id TEXT,file_type TEXT);
 INSERT INTO editions VALUES('edition-1','book-1','.epub'),('edition-2','book-2','.epub');
 CREATE TABLE annotations(id TEXT PRIMARY KEY,paragraph_id TEXT,start_offset INTEGER,end_offset INTEGER,text_hash TEXT,thread_id TEXT,summary TEXT,concepts TEXT,created_at TEXT,concept_details TEXT,message_id TEXT);
`);db.prepare("INSERT INTO chat_messages(id,thread_id,role,content,structured_output,status) VALUES('parent','t','assistant','',?,'streaming')").run(JSON.stringify({_request:{attemptId:'a'}}));});
afterEach(()=>db.close());
function unit(){const u=resolveSemanticPlan({units:[{label:'释读',action:'read',reason:'',fragments:[{paragraphId:'p1',text:source}]}]},[{paragraphId:'p1',startOffset:0,endOffset:source.length,selectedText:source}],()=> 'unit')[0];return {...u,status:'completed' as const,content:'解释',analysis:{summary:'',readingText:'解释',breakdown:[],concepts:[],context:'',uncertainty:''}};}
describe('语义结果原子存储',()=>{
 it('子结果及标注独立保存，重复提交不重复标注',()=>{commitSemanticUnit(db,scope,unit(),()=>{});commitSemanticUnit(db,scope,unit(),()=>{});expect(db.prepare('SELECT count(*) AS n FROM annotations').get()).toEqual({n:1});expect(db.prepare("SELECT status FROM chat_messages WHERE id='unit'").get()).toEqual({status:'completed'});});
 it('父进度写入失败，子结果及标注回滚',()=>{expect(()=>commitSemanticUnit(db,scope,unit(),()=>{throw new Error('失败');})).toThrow('失败');expect(db.prepare("SELECT id FROM chat_messages WHERE id='unit'").get()).toBeUndefined();expect(db.prepare('SELECT count(*) AS n FROM annotations').get()).toEqual({n:0});});
 it('旧 attempt 或原文被修改不能写入',()=>{expect(()=>commitSemanticUnit(db,{...scope,attemptId:'old'},unit(),()=>{})).toThrow('替代');db.prepare("UPDATE paragraphs SET text='内容已变化' WHERE id='p1'").run();expect(()=>commitSemanticUnit(db,scope,unit(),()=>{})).toThrow('原文');});
 it('章节绑定版本且 PDF 不伪装成节',()=>{expect(resolveChapterSelection(db,'edition-1','book-1','chapter-1').selectedText).toBe(source);expect(()=>resolveChapterSelection(db,'edition-1','book-1','chapter-2')).toThrow();db.prepare("UPDATE editions SET file_type='.pdf' WHERE id='edition-1'").run();expect(()=>resolveChapterSelection(db,'edition-1','book-1','chapter-1')).toThrow('结构');});
});
