import { z } from "zod";
import { answerEmphasisSchema } from "../answer-emphasis";
import { externalSources, type ExternalPermissions } from "./external-permissions";
import { externalSearchSchema, readExternalSchema } from "./external-tool-schemas";

export const searchBookSchema = z.object({
  query: z.string().trim().min(1).max(500).describe("主要检索问题或精确关键词；自然语言适合语义检索"),
  additionalQueries: z.array(z.string().trim().min(1).max(500)).max(2).optional().describe("最多两个补充关键词或改写，与主查询并行检索；避免无意义重复"),
  mode: z.enum(["auto", "keyword", "semantic", "hybrid"]).optional().describe("默认 auto：索引可用时并行关键词与语义；精确引文用 keyword，语义问题用 auto"),
  chapterId: z.string().nullable().default(null).describe("可选章节过滤；null 表示全书"),
  limit: z.number().int().min(1).max(8).default(5),
}).strict();
export const readSourceSchema = z.object({
  sourceId: z.string().min(1).max(240),
  neighbors: z.number().int().min(0).max(2).default(1),
}).strict();
export const saveAnalysisSchema = z.object({
  readingText: z.string().trim().min(1).max(24000).describe("完整句读文本；与已输出的可见释读一致，长度档位是目标而非硬限制"),
  summary: z.string().trim().max(4000).default(""),
  breakdown: z.array(z.object({ label: z.string().min(1).max(100), text: z.string().min(1).max(12000) }).strict()).max(24).default([]),
  concepts: z.array(z.object({ name: z.string().trim().min(1).max(80).describe("必须逐字出现在选中文本中的概念词"), text: z.string().trim().min(1).max(2000) }).strict()).max(20).default([]),
  context: z.string().max(6000).default(""),
  uncertainty: z.string().max(2000).default(""),
  citations: z.array(z.object({ sourceId: z.string().min(1).max(240), quote: z.string().trim().min(1).max(4000) }).strict()).max(16).default([]),
  emphasis: answerEmphasisSchema.default({ version: 1, marks: [] }),
}).strict();
export const markAnswerEmphasisSchema = answerEmphasisSchema;
export type AnalysisInput = z.infer<typeof saveAnalysisSchema>;
export type SearchBookInput = z.infer<typeof searchBookSchema>;
export type ReadSourceInput = z.infer<typeof readSourceSchema>;

export function readingToolSchemaText(save: boolean, external?: ExternalPermissions): string { return JSON.stringify([searchBookSchema, readSourceSchema, ...(!save ? [markAnswerEmphasisSchema] : []), ...(save ? [saveAnalysisSchema] : []), ...externalSources.filter(source => external?.[source]).map(() => externalSearchSchema), ...(external?.web || external?.openalex ? [readExternalSchema] : [])].map(schema=>z.toJSONSchema(schema))); }
