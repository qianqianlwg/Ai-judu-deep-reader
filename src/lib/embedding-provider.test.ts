import {describe,it,expect,vi} from 'vitest';
import {embedTexts,validateVector,EMBEDDING_URL} from './embedding-provider';
const vector=(n:number)=>Array.from({length:1024},()=>n);
describe('SiliconFlow embedding',()=>{
 it('使用固定官方地址，按 index 重排且发送 1024 维',async()=>{const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({data:[{index:1,embedding:vector(2)},{index:0,embedding:vector(1)}]}));const result=await embedTexts({apiKey:'fake-key'},['a','b'],undefined,fetcher);expect(result[0][0]).toBe(1);expect(fetcher.mock.calls[0][0]).toBe(EMBEDDING_URL);expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({model:'Qwen/Qwen3-Embedding-8B',dimensions:1024,input:['a','b']});});
 it('拒绝乱序重复、无效维度和零向量',async()=>{expect(()=>validateVector([1])).toThrow();expect(()=>validateVector(vector(0))).toThrow();const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({data:[{index:0,embedding:vector(1)},{index:0,embedding:vector(2)}]}));await expect(embedTexts({apiKey:'fake'},['a','b'],undefined,fetcher)).rejects.toThrow('序号');});
 it('错误响应不回显密钥或正文，未配置不发请求',async()=>{const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('fake-secret',{status:401}));await expect(embedTexts({apiKey:'fake'},['a'],undefined,fetcher)).rejects.toThrow('HTTP 401');await expect(embedTexts({apiKey:''},['a'],undefined,fetcher)).rejects.toThrow('API Key');expect(fetcher).toHaveBeenCalledTimes(1);});
});
