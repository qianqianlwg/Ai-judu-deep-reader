import { z } from "zod";

export const retrievalModeSchema = z.enum(["auto", "keyword", "semantic", "hybrid"]);
export type RetrievalMode = z.infer<typeof retrievalModeSchema>;
export const retrievalBranchSchema = z.object({
  query: z.string().max(500), strategy: z.enum(["keyword", "semantic"]),
  status: z.enum(["completed", "skipped", "error"]), count: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(), reason: z.string().max(240).optional(),
  cacheHit: z.boolean().optional(), promptTokens: z.number().int().nonnegative().optional(),
}).strict();
export const retrievalReportSchema = z.object({
  version: z.literal(1), requestedMode: retrievalModeSchema,
  effectiveMode: z.enum(["keyword", "semantic", "hybrid", "none"]),
  queries: z.array(z.string().max(500)).max(3), branches: z.array(retrievalBranchSchema).max(6),
  durationMs: z.number().nonnegative(), sourceCount: z.number().int().nonnegative(), degraded: z.boolean(),
}).strict();
export type RetrievalReport = z.infer<typeof retrievalReportSchema>;
export type RetrievalBranch = z.infer<typeof retrievalBranchSchema>;
export function readRetrievalReport(value: unknown): RetrievalReport | undefined {
  const parsed = retrievalReportSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
