import { afterEach, describe, expect, it, vi } from "vitest";
import { createContextSummarizer } from "./context-summary";
import { emptyMemory } from "../context-memory";
const memory={...emptyMemory(),task:"理解精神现象学",constraints:["只用中文解释","只引用贺麟译本，不用摘要替代阅读"],openQuestions:["认识与绝对有什么关系"]};
const event=(value:unknown,name?:string)=>(name?"event: "+name+"\n":"")+"data: "+JSON.stringify(value)+"\n\n";
afterEach(()=>vi.unstubAllGlobals());
describe("双协议记忆整理走真实SDK工具参数",()=>{
  it.each(["openai","claude"] as const)("%s 不解析模型正文而读取compress工具参数",async provider=>{
    const args=JSON.stringify({...memory,evidence:["来源标识：fake-message-id"]});let wire="";
    if(provider==="openai")wire=event({id:"summary-1",choices:[{index:0,delta:{role:"assistant",tool_calls:[{index:0,id:"call-summary",type:"function",function:{name:"compress_reading_context",arguments:args}}]},finish_reason:"tool_calls"}]})+event({id:"summary-1",choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+"data: [DONE]\n\n";
    else wire=event({type:"message_start",message:{id:"summary-1",type:"message",role:"assistant",model:"test",content:[],usage:{input_tokens:100,output_tokens:0}}},"message_start")+event({type:"content_block_start",index:0,content_block:{type:"tool_use",id:"call-summary",name:"compress_reading_context",input:{}}},"content_block_start")+event({type:"content_block_delta",index:0,delta:{type:"input_json_delta",partial_json:args}},"content_block_delta")+event({type:"content_block_stop",index:0},"content_block_stop")+event({type:"message_delta",delta:{stop_reason:"tool_use"},usage:{output_tokens:30}},"message_delta")+event({type:"message_stop"},"message_stop");
    const fetcher=vi.fn<typeof fetch>(async()=>new Response(wire,{headers:{"content-type":"text/event-stream"}}));vi.stubGlobal("fetch",fetcher);
    const usage=vi.fn();const summarize=createContextSummarizer({provider,baseUrl:"https://provider.test/v1",apiKey:"test-only",model:"test"},usage);
    expect(await summarize({previous:emptyMemory(),messages:[{id:"u",role:"user",content:"请保留中文约定"}],targetTokens:512,inputBudgetTokens:4096,outputBudgetTokens:1024})).toEqual(memory);
    const request=JSON.parse(String(fetcher.mock.calls[0][1]?.body));expect(fetcher).toHaveBeenCalledOnce();expect(request.tools).toEqual(expect.any(Array));expect(JSON.stringify(request.tools)).toContain("compress_reading_context");expect(request.response_format).toBeUndefined();const user=request.messages.find((item:{role:string})=>item.role==="user");expect(JSON.parse(user.content).新增历史[0]).not.toHaveProperty("id");expect(request.max_tokens).toBeLessThanOrEqual(1024);expect(usage).toHaveBeenCalledWith(expect.objectContaining({source:"provider",totalTokens:130}));
  });
});

it.each(["length","missing-tool","invalid-args"])("压缩%s失败仍保留供应商已返回用量",async failure=>{
 const delta=failure==="missing-tool"?{role:"assistant",content:"没有调用工具"}:{role:"assistant",tool_calls:[{index:0,id:"failed-call",type:"function",function:{name:"compress_reading_context",arguments:JSON.stringify(failure==="invalid-args"?{task:"缺字段"}:memory)}}]};
 const wire=event({id:"usage-failure",choices:[{index:0,delta,finish_reason:failure==="length"?"length":failure==="missing-tool"?"stop":"tool_calls"}]})+event({id:"usage-failure",choices:[],usage:{prompt_tokens:1000,completion_tokens:724,total_tokens:1724,prompt_tokens_details:{cached_tokens:128}}})+"data: [DONE]\n\n";
 vi.stubGlobal("fetch",vi.fn<typeof fetch>(async()=>new Response(wire,{headers:{"content-type":"text/event-stream"}})));
 const onUsage=vi.fn();const summarize=createContextSummarizer({provider:"openai",baseUrl:"https://provider.test/v1",apiKey:"test-only",model:"test"},onUsage);
 await expect(summarize({previous:emptyMemory(),messages:[],targetTokens:512,inputBudgetTokens:4096,outputBudgetTokens:1024})).rejects.toThrow();
 expect(onUsage).toHaveBeenCalledOnce();expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({source:"provider",totalTokens:1724,cachedInputTokens:128}));
});
