import { describe, expect, it } from "vitest";
import { analysisHistoryMarkerIds, analysisHistoryMarkerPositions } from "./analysis-history-markers";
import type { TextAnnotation } from "./annotations";
const item = (id:string,paragraphId:string,messageId:string|undefined="m",endOffset=4):TextAnnotation=>({id,paragraphId,messageId,startOffset:0,endOffset,textHash:"h",threadId:"t",summary:"",concepts:[],createdAt:"now"});
describe("同次句读只保留终点历史入口",()=>{
 it("按来源顺序而不是保存顺序，跨段仅末尾",()=>{expect([...analysisHistoryMarkerIds([item("b","p2"),item("a","p1")],["p1","p2"])]).toEqual(["b"]);});
 it("同段拆分选择最远终点",()=>{expect([...analysisHistoryMarkerIds([item("a","p", "m",2),item("b","p","m",5)],["p"])]).toEqual(["b"]);});
 it("不同回复与不同会话不合并",()=>{expect(analysisHistoryMarkerIds([item("a","p1"),item("b","p2","m2"),{...item("c","p1"),threadId:"t2"}],["p1","p2"]).size).toBe(3);});
 it("旧数据不猜合并，手动笔记保留",()=>{expect(analysisHistoryMarkerIds([{...item("a","p1"),messageId:undefined},{...item("b","p2"),messageId:undefined},{...item("n","p1"),kind:"note"}],["p1","p2"]).size).toBe(3);});
});


it("分页只为同次句读的真正终点占位，同一终点不重复占位", () => {
  const paragraphs = [{ id: "p1", text: "第一段原文。" }, { id: "p2", text: "第二段原文。" }];
  const annotations = [item("a", "p1"), item("b", "p2"), item("c", "p2", "other-message"), { ...item("highlight", "p1"), kind: "highlight" as const }];
  expect([...analysisHistoryMarkerPositions(annotations, paragraphs)]).toEqual([["p2", [4]]]);
});
it("没有历史入口或入口段落不存在时不添加占位", () => {
  expect(analysisHistoryMarkerPositions([item("a", "missing")], [{ id: "p1", text: "正文" }]).size).toBe(0);
  expect(analysisHistoryMarkerPositions([], [{ id: "p1", text: "正文" }]).size).toBe(0);
});
