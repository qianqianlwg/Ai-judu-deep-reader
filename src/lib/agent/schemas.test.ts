import { describe, expect, it } from "vitest";
import { readSourceSchema, saveAnalysisSchema, searchBookSchema, markAnswerEmphasisSchema } from "./schemas";
describe("Agent 工具 schema", () => {
  it("搜索限制查询长度与结果数量", () => { expect(searchBookSchema.parse({ query: "承认" })).toEqual({ query: "承认", chapterId: null, limit: 5 }); expect(searchBookSchema.safeParse({ query: "", limit: 99 }).success).toBe(false); });
  it("读取只能指定来源与小范围邻段", () => { expect(readSourceSchema.safeParse({ sourceId: "p1", neighbors: 3 }).success).toBe(false); });
  it("强调协议不允许前端样式、任意链接或超过四处标注", () => { expect(markAnswerEmphasisSchema.safeParse({ emphasis: { version: 1, marks: [{ kind: "term", quote: "概念", occurrence: 1, color: "red" }] } }).success).toBe(false); expect(markAnswerEmphasisSchema.safeParse({ emphasis: { version: 1, marks: Array.from({ length: 5 }, () => ({ kind: "term", quote: "概念", occurrence: 1 })) } }).success).toBe(false); });
  it("concepts is required and supports the explicit empty marker", () => { const value = { emphasis: "无", readingText: "source", summary: "", breakdown: [], concepts: "\u65e0", context: "", uncertainty: "", citations: [] }; expect(saveAnalysisSchema.safeParse(value).success).toBe(true); expect(saveAnalysisSchema.safeParse({ ...value, anchor: {}, messageId: "other" }).success).toBe(false); expect(saveAnalysisSchema.safeParse({ ...value, concepts: undefined }).success).toBe(false); expect(saveAnalysisSchema.safeParse({ ...value, concepts: [] }).success).toBe(false); expect(saveAnalysisSchema.safeParse({ ...value, concepts: [{ name: "source", text: "definition" }] }).success).toBe(true); });
});

it("标注字段必填且无只能显式提交，JSON Schema不能补默认值", () => {
  const base={readingText:"释读",concepts:"无"};
  expect(saveAnalysisSchema.safeParse(base).success).toBe(false);
  expect(saveAnalysisSchema.safeParse({...base,emphasis:"无"}).success).toBe(true);
  expect(saveAnalysisSchema.safeParse({...base,emphasis:{version:1,marks:[]}}).success).toBe(false);
  expect(markAnswerEmphasisSchema.safeParse({}).success).toBe(false);
  expect(markAnswerEmphasisSchema.safeParse({emphasis:"无"}).success).toBe(true);
  expect(markAnswerEmphasisSchema.safeParse({emphasis:{version:1,marks:[]}}).success).toBe(false);
});
