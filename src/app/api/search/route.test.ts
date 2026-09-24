import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const {search}=vi.hoisted(()=>({search:vi.fn()}));
vi.mock('@/lib/db',()=>({getDb:()=>({})}));vi.mock('@/lib/embedding-store',()=>({readEmbeddingConfig:()=>({apiKey:''})}));vi.mock('@/lib/book-retrieval',()=>({createBookRetrieval:()=>search}));
import { GET } from './route';
beforeEach(()=>search.mockResolvedValue({results:[],retrieval:{effectiveMode:'keyword',branches:[],degraded:false}}));
it('共享检索服务绑定版本章节，忽略旧 DATABASE_URL',async()=>{vi.stubEnv('DATABASE_URL','postgres://unused');const response=await GET(new NextRequest('http://localhost/api/search?q=劳动&editionId=e&chapterId=c&retrieval=hybrid'));expect(response.status).toBe(200);expect(search).toHaveBeenCalledWith(expect.objectContaining({query:'劳动',chapterId:'c',mode:'hybrid'}));vi.unstubAllEnvs();});
it('拒绝旧 embedding 和非正文来源及非法方式',async()=>{for(const suffix of ['&embedding=[1]','&sourceType=external','&retrieval=bad'])expect((await GET(new NextRequest('http://localhost/api/search?q=劳动&editionId=e'+suffix))).status).toBe(400);});
it('显式语义不可用是503，混合可返回带降级说明的关键词',async()=>{search.mockResolvedValue({results:[],retrieval:{effectiveMode:'none',branches:[{reason:'索引未完成'}]}});expect((await GET(new NextRequest('http://localhost/api/search?q=劳动&editionId=e&retrieval=semantic'))).status).toBe(503);});
