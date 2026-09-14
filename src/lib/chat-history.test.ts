import {expect,it} from "vitest";
import {hydrateChatHistory} from "./chat-history";
it("失败元数据不会冒充句读结果，保留原user/assistant的选文锚点",()=>{
 const saved=[{id:"u",role:"user" as const,content:"请句读这一段"},{id:"a",role:"assistant" as const,content:"",status:"error" as const,structuredOutput:JSON.stringify({_request:{clientUserMessageId:"u",input:{paragraphId:"p",selectedText:"承认",selectionStart:20,selectionEnd:22}}})}];
 const messages=hydrateChatHistory(saved);expect(messages[1].analysis).toBeUndefined();expect(messages[0].anchor).toEqual(messages[1].anchor);expect(messages[0].anchor?.startOffset).toBe(20);
});
it("旧消息没有精确位置时不编造跳转",()=>{expect(hydrateChatHistory([{id:"a",role:"assistant",content:"旧消息"}])[0].anchor).toBeUndefined();});

it("新Agent历史保留正常文本和独立结构结果并恢复Token",()=>{const usage={inputTokens:20,outputTokens:10,totalTokens:30,contextTokens:30,contextWindow:8192,source:"provider"};const m=hydrateChatHistory([{id:"a",role:"assistant",content:"自然语言解释",usageJson:JSON.stringify(usage),structuredOutput:JSON.stringify({outputFormat:"text",summary:"结构摘要",breakdown:[],concepts:[],context:"",uncertainty:""})}])[0];expect(m.outputFormat).toBe("text");expect(m.content).toBe("自然语言解释");expect(m.analysis?.summary).toBe("结构摘要");expect(m.usage).toEqual(usage);});

it("刷新恢复校验后的工具卡和警告，损坏条目不污染UI",()=>{const m=hydrateChatHistory([{id:"a",role:"assistant",content:"正文",tools:[{id:"tool",name:"search_book",status:"completed",result:{ok:true,sources:[]}},{id:"bad",name:4,status:"completed"},{id:"old",name:"read_source",status:"running"}],warnings:["资料有限",false]}])[0];expect(m.tools).toHaveLength(2);expect(m.tools?.[0].result).toEqual({ok:true,sources:[]});expect(m.tools?.[1].status).toBe("error");expect(m.warnings).toEqual(["资料有限"]);});


it("旧 attempt 和归属未知工具只恢复到历史分区，不替换当前正文或工具", () => {
 const tools = [{ id: "same-call", name: "search_book", status: "completed", result: { ok: true, sources: [] } }];
 const historicalTools = [
  { ...tools[0], auditId: "old-audit", attemptId: "old-attempt" },
  { ...tools[0], auditId: "unknown-audit", attemptId: null },
  { ...tools[0], auditId: "invalid-audit" },
  { ...tools[0], auditId: "empty-audit", attemptId: " " },
 ];
 const result = hydrateChatHistory([{ id: "u", role: "user", content: "请句读这一段" }, { id: "a", role: "assistant", content: "本轮普通正文", tools, historicalTools }]);
 expect(result.map(message => message.id)).toEqual(["u", "a"]);
 expect(result[1].tools).toHaveLength(1);
 expect(result[1].historicalTools).toHaveLength(2);
 expect(result[1].historicalTools?.map(tool => tool.attemptId)).toEqual(["old-attempt", null]);
 expect(result[1].content).toBe("本轮普通正文");
 expect(result[1].analysis).toBeUndefined();
});
