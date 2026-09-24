import { expect, it, vi } from 'vitest';import {NextRequest} from 'next/server';
vi.mock('@/lib/db',()=>({getDb:()=>({})}));vi.mock('@/lib/embedding-store',()=>({readEmbeddingConfig:()=>({apiKey:'private'})}));vi.mock('@/lib/vector-index',()=>({vectorIndexStatus:()=>({backend:'sqlite',indexedCount:12,paragraphCount:12,vectorIndexed:true})}));
import {GET} from './route';
it('所有状态入口统一本地向量覆盖，绝不返回密钥',async()=>{for(const suffix of ['', '&engine=local-vector']){const response=await GET(new NextRequest('http://localhost/api/search/status?editionId=e'+suffix));expect(await response.json()).toEqual({backend:'sqlite',indexedCount:12,paragraphCount:12,vectorIndexed:true,configured:true});}expect((await GET(new NextRequest('http://localhost/api/search/status'))).status).toBe(400);});
