import { z } from "zod";
import { isKnowledgeAnchor } from "./knowledge";

export const materialKindSchema = z.enum(["source", "excerpt", "understanding", "passage"]);
export const sourceSchema = z.object({
  bookId: z.string().min(1), editionId: z.string().min(1), bookTitle: z.string(), author: z.string(),
  fileName: z.string(), fileType: z.string(), createdAt: z.string(), paragraphCount: z.number().int().nonnegative(),
});
export const materialSchema = z.object({
  id: z.string().min(1), kind: materialKindSchema, origin: z.enum(["original", "user", "ai"]),
  title: z.string(), body: z.string(), quote: z.string(), createdAt: z.string(), source: sourceSchema,
  chapterTitle: z.string().nullable(), anchor: z.custom<import("./knowledge").KnowledgeAnchor>(isKnowledgeAnchor).nullable(),
  locationReason: z.string().nullable(), concepts: z.array(z.object({ name: z.string(), text: z.string() })),
  conversation: z.object({ threadId: z.string().min(1), messageId: z.string().nullable() }).nullable(),
}).superRefine((item, ctx) => {
  if (item.anchor && item.anchor.editionId !== item.source.editionId) ctx.addIssue({code:"custom", message:"来源锚点跨版本"});
  if (item.kind === "passage" && !item.anchor) ctx.addIssue({code:"custom", message:"原文命中缺少可核对来源"});
  if (item.kind === "excerpt" && item.origin !== "user" || item.kind === "understanding" && item.origin !== "ai") ctx.addIssue({code:"custom",message:"材料身份不符"});
  if (item.kind === "source" && item.origin !== "original" || item.kind === "passage" && item.origin !== "original") ctx.addIssue({code:"custom",message:"原始资料类型不符"});
});
export const materialsResponseSchema = z.object({
  version: z.literal(1), scope: z.enum(["current", "all"]), editionId: z.string().nullable(), query: z.string(),
  items: z.array(materialSchema), counts: z.object({source:z.number().int().nonnegative(),excerpt:z.number().int().nonnegative(),understanding:z.number().int().nonnegative(),passage:z.number().int().nonnegative()}),
  total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), limit: z.number().int().positive(), warnings:z.array(z.string()),
});
export type KnowledgeSource = z.infer<typeof sourceSchema>;
export type KnowledgeMaterial = z.infer<typeof materialSchema>;
export type MaterialKind = z.infer<typeof materialKindSchema>;
export type MaterialsResponse = z.infer<typeof materialsResponseSchema>;
export type MaterialQuery = {scope:"current"|"all";editionId:string|null;query:string;kind:MaterialKind|"all";offset:number;limit:number;retrieval:"keyword"};
export function readMaterialQuery(params:URLSearchParams):MaterialQuery {
  const parsed=z.object({scope:z.enum(["current","all"]),editionId:z.string().min(1).max(200).nullable(),query:z.string().max(500),kind:materialKindSchema.or(z.literal("all")),offset:z.coerce.number().int().min(0).max(100000),limit:z.coerce.number().int().min(1).max(100),retrieval:z.literal("keyword")}).parse({
    scope:params.get("scope")??"current",editionId:params.get("editionId")?.trim()||null,query:(params.get("q")??"").trim(),kind:params.get("kind")??"all",offset:params.get("offset")??0,limit:params.get("limit")??40,retrieval:params.get("retrieval")??"keyword",
  });
  if(parsed.scope==="current"&&!parsed.editionId)throw new Error("请先选择一本书，或切换到全部书籍");
  // WHY：本阶段跨书查询保持本地，不因扩大范围而自动外发多本书的查询或正文。
  return parsed;
}
export async function fetchKnowledgeMaterials(params:URLSearchParams,signal:AbortSignal,request:typeof fetch=fetch):Promise<MaterialsResponse>{
  const response=await request("/api/knowledge/materials?"+params,{cache:"no-store",signal});
  const data:unknown=await response.json();
  if(!response.ok){const error=z.object({error:z.string()}).safeParse(data);throw new Error(error.success?error.data.error:"知识库读取失败，请重试");}
  const result=materialsResponseSchema.parse(data);
  if(result.scope!==params.get("scope")||result.editionId!==(params.get("scope")==="current"?params.get("editionId"):null)||result.query!==(params.get("q")??"")||result.items.some(item=>result.scope==="current"&&item.source.editionId!==result.editionId))throw new Error("知识库返回的范围与请求不一致");
  return result;
}
