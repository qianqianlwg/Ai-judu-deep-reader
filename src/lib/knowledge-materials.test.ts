import { expect,it,vi } from "vitest";
import { readMaterialQuery,fetchKnowledgeMaterials } from "./knowledge-materials";
it("查询必须显式限定版本或全部书籍，且统一接口只支持本地关键词",()=>{
 expect(readMaterialQuery(new URLSearchParams("scope=all&q=%E6%89%BF%E8%AE%A4"))).toMatchObject({scope:"all",editionId:null,query:"承认",retrieval:"keyword"});
 expect(()=>readMaterialQuery(new URLSearchParams("scope=current"))).toThrow("选择一本书");
 expect(()=>readMaterialQuery(new URLSearchParams("scope=current&editionId=e&retrieval=hybrid"))).toThrow();
});
it("客户端拒绝错误范围响应，避免切书时展示不属于当前书的资料",async()=>{
 const params=new URLSearchParams({scope:"current",editionId:"e1",q:"",kind:"all",retrieval:"keyword"});
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({version:1,scope:"current",editionId:"e2",query:"",items:[],counts:{source:0,excerpt:0,understanding:0,passage:0},total:0,offset:0,limit:60,warnings:[]}));
 await expect(fetchKnowledgeMaterials(params,new AbortController().signal,fetcher)).rejects.toThrow("范围与请求不一致");
});
