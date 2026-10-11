import { expect, it } from "vitest";
import { createReadingRequest, beginReadingRequest, applyReadingRequest, restoreReadingRequest, prepareReadingEdit } from "./reading-request";
import { hydrateChatHistory } from "./chat-history";
function request(){let n=0;return createReadingRequest({sourceMode:"analysis-only",mode:"analyze",question:"分析这个标题",selectedText:"一 泛论逻辑",bookId:"book-1",editionId:"edition-1"},()=>"id-"+(++n));}
function saved(){const state=request();return {id:state.payload.clientAssistantMessageId,role:"assistant" as const,content:"解释",status:"error" as const,structuredOutput:JSON.stringify({_request:{version:1,clientUserMessageId:state.payload.clientUserMessageId,clientAssistantMessageId:state.payload.clientAssistantMessageId,input:state.payload}})};}
it("首次、失败重试保留完整材料，不产生锚点",()=>{
 const start=beginReadingRequest(request(),[]);expect(start.messages).toHaveLength(2);for(const message of start.messages){expect(message.anchor).toBeUndefined();expect(message.analysisOnlySource).toEqual({sourceMode:"analysis-only",text:"一 泛论逻辑"});}
 const retried=beginReadingRequest({...start.state,status:"error"},start.messages);expect(retried.state.payload).toEqual(start.state.payload);expect(retried.messages).toHaveLength(2);
});
it("刷新恢复与编辑沿用仅分析模式和选文",()=>{
 const state=restoreReadingRequest("id-1",saved())!;expect(state.payload.sourceMode).toBe("analysis-only");expect(state.payload.paragraphId).toBeUndefined();
 const messages=applyReadingRequest([],state),plan=prepareReadingEdit(state,messages,state.payload.clientUserMessageId,"重新解释标题");expect(plan.input).toMatchObject({sourceMode:"analysis-only",selectedText:"一 泛论逻辑"});expect(()=>createReadingRequest(plan.input)).not.toThrow();
});
it("历史恢复在两条消息显示只读选文，不标成来源损坏",()=>{
 const message=saved(),history=hydrateChatHistory([{id:"id-2",role:"user",content:"分析这个标题"},message]);for(const item of history){expect(item.analysisOnlySource?.text).toBe("一 泛论逻辑");expect(item.anchor).toBeUndefined();expect(item.sourceInvalid).toBeUndefined();}
});
it("仅分析不继承旧消息锚点",()=>{const state=request(),old={id:state.payload.clientUserMessageId,role:"user" as const,content:state.payload.question,anchor:{paragraphId:"old",startOffset:0,endOffset:2,selectedText:"旧文"}};expect(applyReadingRequest([old],state)[0].anchor).toBeUndefined();});
it("客户端与已保存请求都拒绝混入定位",()=>{
 expect(()=>createReadingRequest({...request().payload,paragraphId:"old"})).toThrow("不能携带");const record=saved();const value=JSON.parse(record.structuredOutput);value._request.input.paragraphId="old";record.structuredOutput=JSON.stringify(value);expect(()=>restoreReadingRequest("id-1",record)).toThrow("不能携带");
});
