import { expect, it, vi } from "vitest";
import { createQueryEmbeddingSession } from "./query-embedding";
import type { embedTexts } from "./embedding-provider";
it("查询缓存复用、账号隔离和本轮调用预算", async () => {
 const provider=vi.fn<typeof embedTexts>(async (_c,_t,_s,_f,usage)=>{usage?.({promptTokens:7});return [[1,2]];});
 const config={apiKey:crypto.randomUUID()}, session=createQueryEmbeddingSession(config,provider,1);
 const first=session.createCall();await first.embed(config,["query"]);expect(first.stats.promptTokens).toBe(7);
 const second=session.createCall();await second.embed(config,["query"]);expect(second.stats.cacheHit).toBe(true);expect(provider).toHaveBeenCalledTimes(1);
 await expect(session.createCall().embed(config,["other"])).rejects.toThrow("预算");
 await createQueryEmbeddingSession({apiKey:crypto.randomUUID()},provider).createCall().embed(config,["query"]);expect(provider).toHaveBeenCalledTimes(2);
 const controller=new AbortController();controller.abort();await expect(second.embed(config,["query"],controller.signal)).rejects.toThrow();
});
it("同轮相同查询并行只发一次请求，取消后的迟到向量不进缓存", async () => {
 let resolve!: (value:number[][])=>void;
 const provider=vi.fn<typeof embedTexts>(()=>new Promise<number[][]>(r=>{resolve=r;}));
 const config={apiKey:crypto.randomUUID()},session=createQueryEmbeddingSession(config,provider,1),a=session.createCall(),b=session.createCall();
 const first=a.embed(config,['parallel']),second=b.embed(config,['parallel']);expect(provider).toHaveBeenCalledTimes(1);resolve([[1,2]]);await Promise.all([first,second]);expect(b.stats.cacheHit).toBe(true);
 const controller=new AbortController(),next=createQueryEmbeddingSession(config,provider),pending=next.createCall().embed(config,['cancelled'],controller.signal);controller.abort();resolve([[1,2]]);await expect(pending).rejects.toThrow();
 const retry=next.createCall().embed(config,['cancelled']);expect(provider).toHaveBeenCalledTimes(3);resolve([[1,2]]);await retry;
});
