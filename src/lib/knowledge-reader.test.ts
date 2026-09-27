import { createRequire } from "node:module";
import { afterEach, expect, it } from "vitest";
import { readStoredBookKnowledge } from "./knowledge-reader";
type Db={exec(sql:string):void;close():void;prepare(sql:string):{get(...args:unknown[]):unknown;all(...args:unknown[]):unknown[];run(...args:unknown[]):unknown}};
const {DatabaseSync}=createRequire(import.meta.url)("node:sqlite") as {DatabaseSync:new(file:string)=>Db};
let db:Db|undefined;
afterEach(()=>db?.close());
it("从两个会话投影本版本句读，明确拒绝另一版本来源",()=>{
 db=new DatabaseSync(":memory:");db.exec(`CREATE TABLE editions(id TEXT,book_id TEXT);CREATE TABLE chapters(id TEXT,edition_id TEXT,title TEXT,order_index INTEGER);CREATE TABLE paragraphs(id TEXT,chapter_id TEXT,text TEXT,order_index INTEGER);CREATE TABLE annotations(id TEXT,paragraph_id TEXT,start_offset INTEGER,end_offset INTEGER,text_hash TEXT,thread_id TEXT,summary TEXT,concepts TEXT,concept_details TEXT,message_id TEXT,created_at TEXT);CREATE TABLE reading_threads(id TEXT,edition_id TEXT);CREATE TABLE chat_messages(id TEXT,thread_id TEXT,role TEXT,structured_output TEXT,status TEXT,created_at TEXT);INSERT INTO editions VALUES('e1','b1'),('e2','b2');INSERT INTO chapters VALUES('c1','e1','章',0),('c2','e2','章',0);INSERT INTO paragraphs VALUES('p1','c1','原文承认',0),('p2','c2','另一版本',0);INSERT INTO reading_threads VALUES('t1','e1'),('t2','e2');`);
 const analysis=(paragraphId:string,selectedText:string)=>JSON.stringify({summary:"句读总结",breakdown:[],concepts:[],context:"",uncertainty:"",anchor:{paragraphId,startOffset:2,endOffset:4,selectedText}});
 db.exec("INSERT INTO chat_messages VALUES('m1','t1','assistant','"+analysis("p1","承认").replaceAll("'","''")+"','completed','2026-09-26');");
 db.exec("INSERT INTO chat_messages VALUES('m2','t2','assistant','"+analysis("p2","版本").replaceAll("'","''")+"','completed','2026-09-26');");
 const first=readStoredBookKnowledge(db as Parameters<typeof readStoredBookKnowledge>[0],"e1");expect(first.records).toHaveLength(1);expect(first.records[0].anchor).toMatchObject({editionId:"e1",paragraphId:"p1"});
 expect(readStoredBookKnowledge(db as Parameters<typeof readStoredBookKnowledge>[0],"e2").records).toHaveLength(1);
});
