import { describe, expect, it } from "vitest";
import { readSourceSchema, saveAnalysisSchema, searchBookSchema } from "./schemas";
describe("Agent 工具 schema", () => {
  it("搜索限制查询长度与结果数量", () => { expect(searchBookSchema.parse({ query: "承认" })).toEqual({ query: "承认", chapterId: null, limit: 5 }); expect(searchBookSchema.safeParse({ query: "", limit: 99 }).success).toBe(false); });
  it("读取只能指定来源与小范围邻段", () => { expect(readSourceSchema.safeParse({ sourceId: "p1", neighbors: 3 }).success).toBe(false); });
  it("模型不能在保存参数中注入消息或原文锚点", () => { const value = { readingText: "原文啊", summary: "解释", breakdown: [], concepts: [], context: "", uncertainty: "", citations: [] }; expect(saveAnalysisSchema.safeParse(value).success).toBe(true); expect(saveAnalysisSchema.safeParse({ ...value, anchor: {}, messageId: "other" }).success).toBe(false); });
});
