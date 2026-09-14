import { isAnalysis, isRecord, type ChatMessage, type MessageAnchor } from "./chat-stream";
export type StoredChatMessage = { id: string; role: "user" | "assistant"; content: string; structuredOutput?: string | null; status?: "streaming" | "completed" | "error" };
function readAnchor(value:unknown): MessageAnchor | undefined {
 if(!isRecord(value)||typeof value.paragraphId!=="string"||typeof value.selectedText!=="string"||!Number.isSafeInteger(value.startOffset)||!Number.isSafeInteger(value.endOffset))return;
 const startOffset=value.startOffset as number,endOffset=value.endOffset as number;
 if(startOffset<0||endOffset<=startOffset||value.selectedText.length!==endOffset-startOffset)return;
 return {paragraphId:value.paragraphId,startOffset,endOffset,selectedText:value.selectedText};
}
export function hydrateChatHistory(saved:StoredChatMessage[]):ChatMessage[]{
 const sourceByUser=new Map<string,MessageAnchor>();
 const result=saved.map((message):ChatMessage=>{
  let value:unknown;
  if(message.structuredOutput){try{value=JSON.parse(message.structuredOutput);}catch(error:unknown){console.error("恢复消息结构失败",error);}}
  const analysis=isAnalysis(value)?value:undefined;
  let anchor=isRecord(value)?readAnchor(value.anchor):undefined;
  if(isRecord(value)&&isRecord(value._request)){
   const meta=value._request;
   if(!anchor&&isRecord(meta.input))anchor=readAnchor({paragraphId:meta.input.paragraphId,selectedText:meta.input.selectedText,startOffset:meta.input.selectionStart,endOffset:meta.input.selectionEnd});
   if(anchor&&typeof meta.clientUserMessageId==="string")sourceByUser.set(meta.clientUserMessageId,anchor);
  }
  // WHY：旧线程的最后选文不等于每一条消息的选文；缺少消息级位置时保持未知，禁止误跳。
  return {id:message.id,role:message.role,content:message.content,analysis,anchor,kind:analysis?"analysis":"chat",status:message.status==="streaming"?"error":message.status};
 });
 return result.map(message=>message.role==="user"?{...message,anchor:sourceByUser.get(message.id??"")}:message);
}
