import { expect, it } from "vitest";
import type { getDb } from "../db";
import { attachSavedToolContext } from "./history-context";
type TestDb = ReturnType<typeof getDb> & {close():void};
const sqlite=(process as unknown as {getBuiltinModule(name:string):{DatabaseSync:new(file:string)=>TestDb}}).getBuiltinModule("node:sqlite");
it("追问从同会话的已保存快照恢复仅分析材料，不伪造段落位置",()=>{
 // WHY：同步SQLite仅用于真实事务/读取协议验收，不访问网络和正式数据库。
 const db=new sqlite.DatabaseSync(":memory:");db.exec("CREATE TABLE chat_messages(id TEXT,thread_id TEXT,role TEXT,status TEXT,content TEXT,structured_output TEXT)");
 const insert=db.prepare("INSERT INTO chat_messages VALUES(?,?,'assistant','completed',?,?)");insert.run("m","thread","解释",JSON.stringify({_request:{input:{sourceMode:"analysis-only",selectedText:"<h1>标题文字</h1>",chapterId:null,paragraphId:null,selectionStart:null,selectionEnd:null}}}));
 try{const adapter=db,history=[{id:"m",role:"assistant" as const,content:"解释"}],restored=attachSavedToolContext(adapter,"thread",history);
 expect(restored[0].content).toContain("标题文字");expect(restored[0].content).toContain("无核验位置");expect(restored[0].content).not.toContain("paragraphId");expect(attachSavedToolContext(adapter,"other-thread",history)).toEqual(history);
 }finally{db.close();}
});
