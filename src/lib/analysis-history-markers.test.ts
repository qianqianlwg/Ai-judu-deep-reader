import { describe, expect, it } from "vitest";
import { analysisHistoryMarkerIds } from "./analysis-history-markers";
import type { TextAnnotation } from "./annotations";
const item = (id:string,paragraphId:string,messageId:string|undefined="m",endOffset=4):TextAnnotation=>({id,paragraphId,messageId,startOffset:0,endOffset,textHash:"h",threadId:"t",summary:"",concepts:[],createdAt:"now"});
describe("同次句读只保留终点历史入口",()=>{
 it("按来源顺序而不是保存顺序，跨段仅末尾",()=>{expect([...analysisHistoryMarkerIds([item("b","p2"),item("a","p1")],["p1","p2"])]).toEqual(["b"]);});
 it("同段拆分选择最远终点",()=>{expect([...analysisHistoryMarkerIds([item("a","p", "m",2),item("b","p","m",5)],["p"])]).toEqual(["b"]);});
 it("不同回复与不同会话不合并",()=>{expect(analysisHistoryMarkerIds([item("a","p1"),item("b","p2","m2"),{...item("c","p1"),threadId:"t2"}],["p1","p2"]).size).toBe(3);});
 it("旧数据不猜合并，手动笔记保留",()=>{expect(analysisHistoryMarkerIds([{...item("a","p1"),messageId:undefined},{...item("b","p2"),messageId:undefined},{...item("n","p1"),kind:"note"}],["p1","p2"]).size).toBe(3);});
});
