import { z } from "zod";

export const searchBookSchema = z.object({
  query: z.string().trim().min(1).max(120).describe("要在当前书籍版本检索的精确关键词或短语"),
  chapterId: z.string().nullable().default(null).describe("可选章节过滤；null 表示全书"),
  limit: z.number().int().min(1).max(8).default(5),
}).strict();
export const readSourceSchema = z.object({
  sourceId: z.string().min(1).max(240),
  neighbors: z.number().int().min(0).max(2).default(1),
}).strict();
export const saveAnalysisSchema = z.object({
  readingText: z.string().trim().min(1).max(24000).describe("第一部分句读文本；长度须符合当前详细程度，并与正常回复的句读文本一致"),
  summary: z.string().trim().max(4000).default(""),
  breakdown: z.array(z.object({ label: z.string().min(1).max(100), text: z.string().min(1).max(12000) }).strict()).max(24).default([]),
  concepts: z.array(z.object({ name: z.string().trim().min(1).max(80).describe("必须逐字出现在选中文本中的概念词"), text: z.string().trim().min(1).max(2000) }).strict()).max(20).default([]),
  context: z.string().max(6000).default(""),
  uncertainty: z.string().max(2000).default(""),
  citations: z.array(z.object({ sourceId: z.string().min(1).max(240), quote: z.string().trim().min(1).max(4000) }).strict()).max(16).default([]),
}).strict();
export type AnalysisInput = z.infer<typeof saveAnalysisSchema>;
export type SearchBookInput = z.infer<typeof searchBookSchema>;
export type ReadSourceInput = z.infer<typeof readSourceSchema>;

export function readingToolSchemaText(save: boolean): string { return JSON.stringify([searchBookSchema, readSourceSchema, ...(save ? [saveAnalysisSchema] : [])].map(schema=>z.toJSONSchema(schema))); }
