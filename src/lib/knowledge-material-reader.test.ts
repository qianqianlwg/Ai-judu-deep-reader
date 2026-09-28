import {createRequire} from "node:module";
import {afterEach,beforeEach,expect,it} from "vitest";
import {readKnowledgeMaterials} from "./knowledge-material-reader";
import type {MaterialQuery} from "./knowledge-materials";
type Db={exec(sql:string):void;close():void;prepare(sql:string):{get(...args:unknown[]):unknown;all(...args:unknown[]):unknown[];run(...args:unknown[]):unknown}};
const {DatabaseSync}=createRequire(import.meta.url)("node:sqlite") as {DatabaseSync:new(file:string)=>Db};
let db:Db;
beforeEach(()=>{db=new DatabaseSync(":memory:");db.exec(`CREATE TABLE books(id TEXT,title TEXT,author TEXT);CREATE TABLE editions(id TEXT,book_id TEXT,file_name TEXT,file_type TEXT,created_at TEXT);CREATE TABLE chapters(id TEXT,edition_id TEXT,title TEXT,order_index INTEGER);CREATE TABLE paragraphs(id TEXT,chapter_id TEXT,text TEXT,order_index INTEGER);CREATE TABLE reading_marks(id TEXT,edition_id TEXT,kind TEXT,note TEXT,anchors_json TEXT,updated_at TEXT);CREATE TABLE annotations(id TEXT,paragraph_id TEXT,start_offset INTEGER,end_offset INTEGER,text_hash TEXT,thread_id TEXT,summary TEXT,concepts TEXT,concept_details TEXT,message_id TEXT,created_at TEXT);CREATE TABLE reading_threads(id TEXT,edition_id TEXT);CREATE TABLE chat_messages(id TEXT,thread_id TEXT,role TEXT,structured_output TEXT,status TEXT,created_at TEXT);INSERT INTO books VALUES('b','测试书','作者');INSERT INTO editions VALUES('e','b','book.txt','.txt','2026-09-26');INSERT INTO chapters VALUES('c','e','第一章',0);INSERT INTO paragraphs VALUES('p','c','承认是互动',0);`);});
afterEach(()=>db.close());
const query=(q:string):MaterialQuery=>({scope:"current",editionId:"e",query:q,kind:"all",retrieval:"keyword",offset:0,limit:60});
it("空查询不扫描全部段落，输入短词才返回可定位的原文命中",()=>{
 const result=readKnowledgeMaterials(db as Parameters<typeof readKnowledgeMaterials>[0],query(""));
 expect(result.items.map(item=>item.kind)).toEqual(["source"]);
 const found=readKnowledgeMaterials(db as Parameters<typeof readKnowledgeMaterials>[0],query("承认"));
 expect(found.items.find(item=>item.kind==="passage")?.anchor).toMatchObject({editionId:"e",paragraphId:"p",selectedText:"承认"});
});
