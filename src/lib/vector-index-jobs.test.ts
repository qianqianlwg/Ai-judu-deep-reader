import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createVectorIndexJobs } from "./vector-index-jobs";
import { buildVectorBatch, vectorIndexStatus } from "./vector-index";
import type { EmbeddingStore } from "./embedding-store";

type TestDb = EmbeddingStore & { close(): void };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => TestDb };
let db: TestDb;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE editions(id TEXT);CREATE TABLE chapters(id TEXT,edition_id TEXT,title TEXT,order_index INTEGER);CREATE TABLE paragraphs(id TEXT,chapter_id TEXT,order_index INTEGER,text TEXT);INSERT INTO editions VALUES('e');INSERT INTO chapters VALUES('c','e','章',0);INSERT INTO paragraphs VALUES('p','c',0,'正文')");
});
afterEach(() => db.close());
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
it("启动立即返回；服务端可在客户端离开后完成，不再绑定请求取消信号", async () => {
  const batch = deferred<{ vectorIndexed: boolean; chunkCount: number }>();
  const build = vi.fn().mockReturnValue(batch.promise);
  const jobs = createVectorIndexJobs(build);
  expect(jobs.start(db, "e", { apiKey: "fake" }).state).toBe("running");
  expect(jobs.start(db, "e", { apiKey: "fake" }).state).toBe("running");
  expect(build).toHaveBeenCalledTimes(1);
  batch.resolve({ vectorIndexed: true, chunkCount: 1 });
  await vi.waitFor(() => expect(jobs.status(db, "e").state).toBe("completed"));
});
it("暂停只等当前批次结束，下一次需再次确认才继续", async () => {
  const batch = deferred<{ vectorIndexed: boolean; chunkCount: number }>();
  const build = vi.fn().mockReturnValue(batch.promise);
  const jobs = createVectorIndexJobs(build);
  jobs.start(db, "e", { apiKey: "fake" });
  expect(jobs.pause(db, "e").state).toBe("pausing");
  batch.resolve({ vectorIndexed: false, chunkCount: 2 });
  await vi.waitFor(() => expect(jobs.status(db, "e").state).toBe("paused"));
  expect(build).toHaveBeenCalledTimes(1);
});
it("服务重启后超时任务可恢复，旧批次不能覆盖新任务", async () => {
  const first = deferred<{ vectorIndexed: boolean; chunkCount: number }>();
  const second = deferred<{ vectorIndexed: boolean; chunkCount: number }>();
  const build = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const jobs = createVectorIndexJobs(build);
  jobs.start(db, "e", { apiKey: "fake" });
  db.prepare("UPDATE embedding_index_jobs SET updated_at=0 WHERE edition_id='e'").run();
  expect(jobs.status(db, "e").state).toBe("interrupted");
  jobs.start(db, "e", { apiKey: "fake" });
  first.resolve({ vectorIndexed: true, chunkCount: 1 });
  await Promise.resolve();
  expect(jobs.status(db, "e").state).toBe("running");
  second.resolve({ vectorIndexed: true, chunkCount: 1 });
  await vi.waitFor(() => expect(jobs.status(db, "e").state).toBe("completed"));
});

it("连续批次逐次落库，切页后可从状态接口看见完成进度", async () => {
  for (let i = 1; i < 10; i++) db.prepare("INSERT INTO paragraphs VALUES(?, 'c', ?, '正文')").run("p" + i, i);
  const embed = vi.fn(async (_config: { apiKey: string }, texts: readonly string[]) => texts.map(() => Array.from({ length: 1024 }, () => 1)));
  const jobs = createVectorIndexJobs((store, editionId, config) => buildVectorBatch(store, editionId, config, undefined, embed));
  jobs.start(db, "e", { apiKey: "fake" });
  await vi.waitFor(() => expect(jobs.status(db, "e").state).toBe("completed"));
  expect(vectorIndexStatus(db, "e")).toMatchObject({ indexedChunkCount: 10, vectorIndexed: true });
  expect(embed).toHaveBeenCalledTimes(2);
});
