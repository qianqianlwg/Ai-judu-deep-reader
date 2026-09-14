import { isTokenUsage, type TokenUsage } from "./token-usage";
import { isAnalysis, isRecord, type ChatMessage, type HistoricalToolActivity, type MessageAnchor, type ToolActivity } from "./chat-stream";
export type StoredChatMessage = { id: string; role: "user" | "assistant"; content: string; usage?: TokenUsage; tools?: unknown; historicalTools?: unknown; warnings?: unknown; usageJson?: string | null; structuredOutput?: string | null; status?: "streaming" | "completed" | "error" };
function readAnchor(value:unknown): MessageAnchor | undefined {
 if(!isRecord(value)||typeof value.paragraphId!=="string"||typeof value.selectedText!=="string"||!Number.isSafeInteger(value.startOffset)||!Number.isSafeInteger(value.endOffset))return;
 const startOffset=value.startOffset as number,endOffset=value.endOffset as number;
 if(startOffset<0||endOffset<=startOffset||value.selectedText.length!==endOffset-startOffset)return;
 return {paragraphId:value.paragraphId,startOffset,endOffset,selectedText:value.selectedText};
}
function readHistoricalTools(value: unknown): HistoricalToolActivity[] {
 if (!Array.isArray(value)) return [];
 return value.flatMap(item => {
  if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.auditId !== "string" || (item.attemptId !== null && (typeof item.attemptId !== "string" || !item.attemptId.trim())) || (item.status !== "running" && item.status !== "completed" && item.status !== "error")) return [];
  return [{ id: item.id, name: item.name, auditId: item.auditId, attemptId: item.attemptId, status: item.status === "running" ? "error" as const : item.status, result: item.result }];
 });
}
export function hydrateChatHistory(saved:StoredChatMessage[]):ChatMessage[]{
 const sourceByUser=new Map<string,MessageAnchor>();
 const result=saved.map((message):ChatMessage=>{
  let value:unknown;
  if(message.structuredOutput){try{value=JSON.parse(message.structuredOutput);}catch(error:unknown){console.error("恢复消息结构失败",error);}}
  const analysis=isAnalysis(value)?value:undefined;
  let usage = isTokenUsage(message.usage) ? message.usage : undefined;
  const tools: ToolActivity[] = Array.isArray(message.tools) ? message.tools.flatMap(item => isRecord(item) && typeof item.id === "string" && typeof item.name === "string" && (item.status === "completed" || item.status === "error" || item.status === "running") ? [{ id: item.id, name: item.name, status: item.status === "running" ? "error" : item.status, result: item.result }] : []) : [];
  const historicalTools = readHistoricalTools(message.historicalTools);
  const warnings = Array.isArray(message.warnings) ? message.warnings.filter((item): item is string => typeof item === "string") : [];
  if (!usage && message.usageJson) { try { const parsed: unknown = JSON.parse(message.usageJson); if (isTokenUsage(parsed)) usage = parsed; } catch (error: unknown) { console.error("恢复 Token 统计失败", error); } }
  const outputFormat = isRecord(value) && value.outputFormat === "text" ? "text" : analysis ? "legacy-json" : "text";
  let anchor=isRecord(value)?readAnchor(value.anchor):undefined;
  if(isRecord(value)&&isRecord(value._request)){
   const meta=value._request;
   if(!anchor&&isRecord(meta.input))anchor=readAnchor({paragraphId:meta.input.paragraphId,selectedText:meta.input.selectedText,startOffset:meta.input.selectionStart,endOffset:meta.input.selectionEnd});
   if(anchor&&typeof meta.clientUserMessageId==="string")sourceByUser.set(meta.clientUserMessageId,anchor);
  }
  // WHY：旧线程的最后选文不等于每一条消息的选文；缺少消息级位置时保持未知，禁止误跳。
  return {id:message.id,role:message.role,content:message.content,analysis,anchor,usage,outputFormat,tools,historicalTools,warnings,kind:analysis?"analysis":"chat",status:message.status==="streaming"?"error":message.status};
 });
 return result.map(message=>message.role==="user"?{...message,anchor:sourceByUser.get(message.id??"")}:message);
}
