import { describe, expect, it, vi } from "vitest";
import type { getDb } from "../db";
import { attachSavedToolContext } from "./history-context";
const value={summary:"解释",breakdown:[],concepts:[{name:"认识",text:"认识活动"}],context:"导论",uncertainty:"",citations:[{sourceId:"book:e:paragraph:p",paragraphId:"p",quote:"认识"}],_request:{private:"不应发送"}};
describe("下一轮可读取已保存工具结果",()=>{
  it("附加结构字段但不复制私有元数据",()=>{const get=vi.fn(()=>({structured_output:JSON.stringify(value)}));const db={prepare:()=>({get})} as unknown as ReturnType<typeof getDb>;const result=attachSavedToolContext(db,"t",[{id:"a",role:"assistant",content:"已解释"}]);expect(result[0].content).toContain("认识活动");expect(result[0].content).toContain("book:e:paragraph:p");expect(result[0].content).not.toContain("private");expect(get).toHaveBeenCalledWith("a","t");});
  it("无ID和普通聊天记录不做正文JSON解析或误当工具结果",()=>{const get=vi.fn(()=>({structured_output:JSON.stringify({_request:{}})}));const db={prepare:()=>({get})} as unknown as ReturnType<typeof getDb>;const history=[{id:"a",role:"assistant" as const,content:'{"随便":"普通内容"}'}];expect(attachSavedToolContext(db,"t",history)).toEqual(history);expect(attachSavedToolContext(db,"t",[{role:"user",content:"原问题"}])).toEqual([{role:"user",content:"原问题"}]);});
});
