import {expect,it} from "vitest";
import {hydrateChatHistory} from "./chat-history";
it("失败元数据不会冒充句读结果，保留原user/assistant的选文锚点",()=>{
 const saved=[{id:"u",role:"user" as const,content:"请句读这一段"},{id:"a",role:"assistant" as const,content:"",status:"error" as const,structuredOutput:JSON.stringify({_request:{clientUserMessageId:"u",input:{paragraphId:"p",selectedText:"承认",selectionStart:20,selectionEnd:22}}})}];
 const messages=hydrateChatHistory(saved);expect(messages[1].analysis).toBeUndefined();expect(messages[0].anchor).toEqual(messages[1].anchor);expect(messages[0].anchor?.startOffset).toBe(20);
});
it("旧消息没有精确位置时不编造跳转",()=>{expect(hydrateChatHistory([{id:"a",role:"assistant",content:"旧消息"}])[0].anchor).toBeUndefined();});
