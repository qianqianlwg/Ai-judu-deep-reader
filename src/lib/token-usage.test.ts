import {expect,it} from "vitest";import {estimatedUsage,accumulateUsage,isTokenUsage} from "./token-usage";
it("区分累计本轮消耗和当前上下文占用",()=>{const a=accumulateUsage(undefined,{input_tokens:100,output_tokens:20,total_tokens:120},1000);const b=accumulateUsage(a,{input_tokens:200,output_tokens:30,total_tokens:230,input_token_details:{cache_read:80}},1000);expect(b).toMatchObject({totalTokens:350,contextTokens:230,cachedInputTokens:80,source:"provider"});expect(isTokenUsage(b)).toBe(true);});
it("没有供应商用量时明确估算",()=>{expect(estimatedUsage("原文","回答",8192).source).toBe("estimated");expect(isTokenUsage({source:"provider",inputTokens:-1})).toBe(false);});

it("混合估算与真实账单不能冒充全程供应商精确统计",()=>{ const first=estimatedUsage("输入","输出",8192); expect(accumulateUsage(first,{input_tokens:100,output_tokens:20,total_tokens:120},8192).source).toBe("estimated"); });
