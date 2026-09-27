import { z } from "zod";

// WHY：工具参数 schema 是纯共享模块；客户端的历史诊断不能因此装载服务端网络抓取器。
export const externalSearchSchema = z.object({ query: z.string().trim().min(2).max(160).describe("只传简短主题关键词或 DOI；不得传原文、笔记、完整对话或个人信息") }).strict();
export const readExternalSchema = z.object({ sourceId: z.string().regex(/^external:(openalex|web):[a-f0-9]{24}$/u) }).strict();
