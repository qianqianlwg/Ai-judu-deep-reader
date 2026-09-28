import { describe, expect, it } from "vitest";
import { pageConceptHighlights } from "./page-concept-highlights";
const concepts = [{name:"理性",text:"定义"},{name:"经验",text:"定义"}];
const slice = (paragraphId:string,text:string) => ({paragraphId,text,annotations:[],bookConcepts:concepts,showConcepts:true});
describe("概念按当前页去重",()=>{
 it("跨段落同词仅首处，不同词独立，下一页重新计数",()=>{
  const page=pageConceptHighlights([slice("p1","理性理性经验"),slice("p2","经验理性")]);
  expect([...page.get("p1")!]).toEqual([0,4]);expect([...page.get("p2")!]).toEqual([]);
  expect([...pageConceptHighlights([slice("p2","经验理性")]).get("p2")!]).toEqual([0,2]);
 });
 it("分页从段中开始不被上一页概念占位",()=>{
  const full="理性之后理性";
  const page=pageConceptHighlights([{...slice("p",full.slice(4)),sourceText:full,sourceStartOffset:4}]);
  expect([...page.get("p")!]).toEqual([4]);
 });
 it("标注边界切分首词时保留整个首词，后续重复仍去掉",()=>{
  const annotations=[{id:"a",paragraphId:"p",startOffset:1,endOffset:3,textHash:"h",threadId:"t",summary:"",concepts:[],createdAt:"now"}];
  const page=pageConceptHighlights([{...slice("p","理性理性"),annotations}]);
  expect([...page.get("p")!]).toEqual([0,1]);
 });
 it("关闭概念不输出黄标",()=>{expect([...pageConceptHighlights([{...slice("p","理性"),showConcepts:false}]).get("p")!]).toEqual([]);});
});
