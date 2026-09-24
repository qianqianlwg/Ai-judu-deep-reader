import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "../db";
import { EMBEDDING_DIMENSIONS, EMBEDDING_PROFILE } from "../embedding-provider";
import { buildVectorBatch, type EmbedBatch } from "../vector-index";
import { searchVectors } from "../vector-search";
import { createBookSources } from "./book-sources";
import { createBookRetrieval } from "../book-retrieval";
import { createQueryEmbeddingSession } from "../query-embedding";
import type { SearchBookInput } from "./schemas";
import { createReadingTools, type BookSource, type ReadingToolDependencies } from "./tools";

type TestDb = ReturnType<typeof getDb> & { close(): void };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (file: string) => TestDb };
let db: TestDb;
const config = { apiKey: "independent-fake-key" };
const vector = () => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index === 0 ? 1 : 0);
const fakeEmbedding: EmbedBatch = async (_config, texts) => texts.map(vector);
const network = vi.fn(async () => { throw new Error("独立验证禁止真实网络请求"); });
const longText = "左证据甲" + "中".repeat(9000) + "右证据乙";
const selectedText = "检索词是本段主题。";
const sourceId = (id: string, edition = "edition-a") => "book:" + edition + ":paragraph:" + id;
function fixture() {
  const repository = createBookSources(db, "edition-a");
  const offlineConfig = { apiKey: "" };
  const retrieve = createBookRetrieval({ db, editionId: "edition-a", config: offlineConfig, embeddings: createQueryEmbeddingSession(offlineConfig) });
  const searchSources = async (input: SearchBookInput) => (await retrieve({ ...input, mode: "keyword" })).sources;
  const save = vi.fn(async () => undefined);
  const dependencies: ReadingToolDependencies = { messageId: "answer-current", selectedText, sources: repository.registered, search: retrieve, read: repository.read, save };
  const tools = createReadingTools(dependencies);
  return { repository, dependencies, save, searchSources, search: tools[0], read: tools[1], saveAnalysis: tools[2] };
}
function analysis(citations: { sourceId: string; quote: string }[]) {
  return { readingText: "说明检索词的含义。", summary: "", breakdown: [], concepts: [], context: "", uncertainty: "", citations };
}

beforeEach(() => {
  network.mockClear();
  vi.stubGlobal("fetch", network);
  // WHY：真实 SQL 在内存数据库验证；向量全部注入固定假值，不能调用收费模型或污染主书库。
  db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE editions(id TEXT); CREATE TABLE chapters(id TEXT,edition_id TEXT,title TEXT,order_index INTEGER); CREATE TABLE paragraphs(id TEXT,chapter_id TEXT,text TEXT,order_index INTEGER); INSERT INTO editions VALUES('edition-a'),('edition-b'); INSERT INTO chapters VALUES('chapter-a','edition-a','甲章',0),('chapter-next','edition-a','乙章',1),('chapter-foreign','edition-b','外版章',0); INSERT INTO paragraphs VALUES('p1','chapter-a','检索词是本段主题。',0),('p2','chapter-a','检索词的同章邻段。',1),('p3','chapter-next','检索词的另一章。',0),('foreign-p','chapter-foreign','检索词的外版秘密。',0);");
  db.prepare("INSERT INTO paragraphs VALUES(?,?,?,?)").run("long-p", "chapter-a", longText, 20);
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
  expect(network).not.toHaveBeenCalled();
});

describe("独立验收：来源注册、真实引文与版本隔离", () => {
  it("SQL 元字符按普通关键词处理，章节过滤不能覆盖版本范围", async () => {
    const { repository, searchSources } = fixture();
    expect(await searchSources({ query: "' OR 1=1 --", chapterId: null, limit: 8 })).toEqual([]);
    expect(await searchSources({ query: "检索词", chapterId: "chapter-foreign", limit: 8 })).toEqual([]);
    const own = await searchSources({ query: "检索词", chapterId: "chapter-next", limit: 8 });
    expect(own.map(item => item.paragraphId)).toEqual(["p3"]);
    expect(own[0].sourceId).toBe(sourceId("p3"));
    expect(repository.registered.size).toBe(0);
  });

  it("候选未返回不能读，同章邻段只有实际 read_source 返回后才成为可引用证据", async () => {
    const tools = fixture();
    await tools.search.invoke({ query: "检索词", chapterId: "chapter-a", limit: 1 });
    expect([...tools.repository.registered.keys()]).toEqual([sourceId("p1")]);
    expect(await tools.read.invoke({ sourceId: sourceId("p2"), neighbors: 0 })).toMatchObject({ ok: false, code: "unknown_source" });
    expect(await tools.saveAnalysis.invoke(analysis([{ sourceId: sourceId("p2"), quote: "同章邻段" }]))).toMatchObject({ ok: false, code: "invalid_citation" });
    await tools.read.invoke({ sourceId: sourceId("p1"), neighbors: 2 });
    expect([...tools.repository.registered.keys()].sort()).toEqual([sourceId("p1"), sourceId("p2")]);
    expect(await tools.saveAnalysis.invoke(analysis([{ sourceId: sourceId("p2"), quote: "同章邻段" }]))).toMatchObject({ ok: true, saved: true });
    expect(tools.save).toHaveBeenCalledTimes(1);
    expect(tools.save).toHaveBeenCalledWith(expect.objectContaining({ citations: [expect.objectContaining({ sourceId: sourceId("p2"), paragraphId: "p2", messageId: "answer-current" })] }));
  });

  it("同书不同请求不共享证据；猜测同版 ID、外版 ID、把外版 ID 重贴本版前缀均失败", async () => {
    const first = fixture();
    await first.search.invoke({ query: "检索词", limit: 1 });
    const retry = fixture();
    for (const id of [sourceId("p1"), sourceId("foreign-p", "edition-b"), sourceId("foreign-p")]) {
      expect(await retry.read.invoke({ sourceId: id, neighbors: 2 })).toMatchObject({ ok: false, code: "unknown_source" });
      expect(await retry.saveAnalysis.invoke(analysis([{ sourceId: id, quote: "检索词" }]))).toMatchObject({ ok: false, code: "invalid_citation" });
    }
    expect(retry.repository.registered.size).toBe(0);
    expect(retry.save).not.toHaveBeenCalled();
    expect(first.repository.registered.size).toBe(1);
  });

  it("同段两个搜索逆序完成均保留真实片段，但不能跨片段拼出引文", async () => {
    const { repository, dependencies, save, searchSources } = fixture();
    const left = await searchSources({ query: "左证据甲", chapterId: null, limit: 1 });
    const right = await searchSources({ query: "右证据乙", chapterId: null, limit: 1 });
    let releaseLeft!: (sources: BookSource[]) => void;
    let releaseRight!: (sources: BookSource[]) => void;
    const leftPending = new Promise<BookSource[]>(resolve => { releaseLeft = resolve; });
    const rightPending = new Promise<BookSource[]>(resolve => { releaseRight = resolve; });
    const calls = createReadingTools({ ...dependencies, search: input => input.query === "左证据甲" ? leftPending : rightPending });
    const search = calls[0];
    const saveAnalysis = calls[2];
    const a = search.invoke({ query: "左证据甲" });
    const b = search.invoke({ query: "右证据乙" });
    releaseRight(right); await b;
    releaseLeft(left); await a;
    expect(repository.registered.get(sourceId("long-p"))?.excerpts).toEqual(expect.arrayContaining([left[0].text, right[0].text]));
    expect(await saveAnalysis.invoke(analysis([{ sourceId: sourceId("long-p"), quote: "左证据甲" }, { sourceId: sourceId("long-p"), quote: "右证据乙" }]))).toMatchObject({ ok: true });
    expect(await saveAnalysis.invoke(analysis([{ sourceId: sourceId("long-p"), quote: "左证据甲右证据乙" }]))).toMatchObject({ ok: false, code: "invalid_citation" });
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("独立验收：本地向量来源边界（固定假 embedding）", () => {
  it("外版向量伪挂本版、旧模型 profile 污染及其它章节都不能混入结果", async () => {
    await buildVectorBatch(db, "edition-a", config, undefined, fakeEmbedding);
    await buildVectorBatch(db, "edition-a", config, undefined, fakeEmbedding);
    await buildVectorBatch(db, "edition-b", config, undefined, fakeEmbedding);
    db.exec("INSERT INTO paragraph_embeddings SELECT 'edition-a',paragraph_id,chunk_start,chunk_end,text_hash,profile,vector_json FROM paragraph_embeddings WHERE edition_id='edition-b'; INSERT INTO paragraph_embeddings SELECT edition_id,paragraph_id,chunk_start,chunk_end,text_hash,'old-profile','malformed-vector' FROM paragraph_embeddings WHERE edition_id='edition-a';");
    const embed = vi.fn(fakeEmbedding);
    const results = await searchVectors(db, config, { editionId: "edition-a", query: "休息", chapterId: "chapter-a", limit: 8, hybrid: true }, embed);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(hit => hit.chapterId === "chapter-a" && hit.sourceId === sourceId(hit.paragraphId))).toBe(true);
    expect(JSON.stringify(results)).not.toContain("foreign-p");
    expect(new Set(results.map(hit => hit.paragraphId)).size).toBe(results.length);
    const texts = new Map([["p1", selectedText], ["p2", "检索词的同章邻段。"], ["long-p", longText]]);
    for (const hit of results) expect(texts.get(hit.paragraphId)?.slice(hit.startOffset, hit.endOffset)).toBe(hit.matchedText);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it("没有本书完整索引时先拒绝，不把任何查询送入 embedding", async () => {
    const embed = vi.fn(fakeEmbedding);
    await expect(searchVectors(db, config, { editionId: "edition-a", query: "语义", limit: 5, hybrid: true }, embed)).rejects.toThrow("未完成");
    expect(embed).not.toHaveBeenCalled();
  });

  it("正文更新造成 hash 过期时不能复用旧向量，也不发起付费查询", async () => {
    await buildVectorBatch(db, "edition-a", config, undefined, fakeEmbedding);
    await buildVectorBatch(db, "edition-a", config, undefined, fakeEmbedding);
    db.prepare("UPDATE paragraphs SET text=? WHERE id='p1'").run("改写后的本段主题。");
    const embed = vi.fn(fakeEmbedding);
    await expect(searchVectors(db, config, { editionId: "edition-a", query: "语义", limit: 5, hybrid: true }, embed)).rejects.toThrow("未完成");
    expect(embed).not.toHaveBeenCalled();
    expect(db.prepare("SELECT profile FROM paragraph_embeddings WHERE paragraph_id='p1'").get()).toEqual({ profile: EMBEDDING_PROFILE });
  });
});
