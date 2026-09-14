import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { rows } = vi.hoisted(() => ({ rows: [] as Record<string,unknown>[] }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ prepare: (sql:string) => ({
  run: (...args:unknown[]) => { if(sql.startsWith("INSERT")) rows.push({id:args[0],paragraph_id:args[1],start_offset:args[2],end_offset:args[3],text_hash:args[4],thread_id:args[5],summary:args[6],concepts:args[7],created_at:args[8],concept_details:args[9],message_id:args[10]}); },
  all: () => rows,
  get: (id:string) => sql.startsWith("SELECT text") ? id === "p1" ? {text:"你好世界"}:undefined : rows[0],
}) }) }));
import { GET, POST } from "./route";
const post=(body:unknown)=>POST(new NextRequest("http://localhost/api/annotations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));
describe("annotations source-bound persistence",()=>{
 beforeEach(()=>{rows.length=0;});
 it("保存概念定义和消息id，刷新后不丢失",async()=>{
  const response=await post({paragraphId:"p1",startOffset:0,endOffset:2,threadId:"t",messageId:"m",summary:"解释",concepts:["你好"],conceptDetails:[{name:"你好",text:"问候"}]});
  expect(response.status).toBe(201);const json=await(await GET(new NextRequest("http://localhost/api/annotations?editionId=e1"))).json();
  expect(json.annotations[0]).toMatchObject({messageId:"m",conceptDetails:[{name:"你好",text:"问候"}]});
 });
 it("不能伪造客户端原文绕过范围校验",async()=>{
  const response=await post({paragraphId:"p1",startOffset:0,endOffset:10,threadId:"t",paragraphText:"假的长原文".repeat(10)});expect(response.status).toBe(400);
 });
 it("不存在的段落不保存",async()=>{expect((await post({paragraphId:"missing",startOffset:0,endOffset:1})).status).toBe(404);});
});
