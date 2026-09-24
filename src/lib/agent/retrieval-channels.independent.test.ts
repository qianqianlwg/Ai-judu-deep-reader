import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "../db";
import { createBookRetrieval } from "../book-retrieval";
import { hydrateChatHistory } from "../chat-history";
import { applyChatEvent, decodeChatEvent, isRecord, type ChatMessage } from "../chat-stream";
import { EMBEDDING_DIMENSIONS, type embedTexts } from "../embedding-provider";
import { createQueryEmbeddingSession } from "../query-embedding";
import { SseDecoder } from "../sse";
import { buildVectorBatch, type EmbedBatch } from "../vector-index";
import type { searchVectors } from "../vector-search";
import { createBookSources } from "./book-sources";
import { createReadingTools } from "./tools";
import { insertCurrentAttemptToolRun, readThreadToolHistory, toolReplayEvents, type ToolAttemptScope } from "./tool-history";

type TestDb = ReturnType<typeof getDb> & { close(): void };
type Channel = "keyword" | "semantic";
type Mode = "keyword" | "semantic" | "hybrid";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (file: string) => TestDb };
const scope: ToolAttemptScope = { threadId: "channels-thread", messageId: "channels-answer", editionId: "channels-edition", attemptId: "channels-attempt" };
const texts = {
  lexical: "needle occurs only lexically.",
  semantic: "A concept explained without the literal token.",
  overlap: "needle belongs to the overlapping passage.",
  foreign: "needle is a private passage in another edition.",
};
const vector = (first: number, second = 0) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index === 0 ? first : index === 1 ? second : 0);
const corpusEmbedding: EmbedBatch = async (_config, values) => values.map(text => {
  if (text === texts.lexical) return vector(0, 1);
  if (text === texts.overlap) return vector(0.8, 0.6);
  if (text === texts.semantic || text === texts.foreign) return vector(1);
  throw new Error("独立测试遇到未定义的正文，不允许回退真实 embedding");
});
const queryProvider = vi.fn<typeof embedTexts>(async (_config, values, _signal, _fetch, usage) => {
  usage?.({ promptTokens: 3 });
  return values.map(() => vector(1));
});
const network = vi.fn(async () => { throw new Error("channels 独立验证禁止真实网络及付费 API"); });
let db: TestDb;
let config: { apiKey: string };

function retrieve(options: { vector?: typeof searchVectors; semanticEnabled?: boolean } = {}) {
  return createBookRetrieval({ db, editionId: scope.editionId, config, embeddings: createQueryEmbeddingSession(config, queryProvider), ...options });
}
function sourceObjects(output: unknown): Record<string, unknown>[] {
  if (!isRecord(output) || !Array.isArray(output.sources) || !output.sources.every(isRecord)) throw new Error("工具输出必须包含结构化 sources");
  return output.sources;
}
function expectChannels(sources: readonly unknown[], expected: Record<string, Channel[]>) {
  const actual: Record<string, Channel[]> = {};
  for (const item of sources) {
    if (!isRecord(item) || typeof item.paragraphId !== "string" || !Array.isArray(item.channels)
      || !item.channels.every((channel): channel is Channel => channel === "keyword" || channel === "semantic")) throw new Error("新检索来源缺少有效 channels");
    expect(new Set(item.channels).size).toBe(item.channels.length);
    expect(actual).not.toHaveProperty(item.paragraphId);
    actual[item.paragraphId] = [...item.channels].sort();
  }
  expect(actual).toEqual(Object.fromEntries(Object.entries(expected).map(([id, channels]) => [id, [...channels].sort()])));
}
function tools() {
  const repository = createBookSources(db, scope.editionId);
  return createReadingTools({ messageId: scope.messageId, selectedText: "", sources: repository.registered, search: retrieve(), read: repository.read, save: async () => undefined });
}
function persist(output: unknown, name = "search_book", id = "search-call", startedAt = "2026-09-24T00:00:00.000Z") {
  insertCurrentAttemptToolRun(db, scope, { id, name, startedAt, input: { query: "needle", apiKey: "channels-private-input" }, output, status: "completed" });
}
function replayAndHydrate() {
  const history = readThreadToolHistory(db, scope).get(scope.messageId);
  if (!history) throw new Error("工具审计没有进入当前消息历史");
  const restored = hydrateChatHistory([{ id: scope.messageId, role: "assistant", content: "正常回答保持独立。", status: "completed", ...history }])[0];
  let replayed: ChatMessage[] = [{ id: scope.messageId, role: "assistant", content: "正常回答保持独立。", status: "completed" }];
  const wire = toolReplayEvents(db, scope).map(event => "event: tool\ndata: " + JSON.stringify({ tool: event.tool }) + "\n\n").join("");
  const decoder = new SseDecoder();
  for (const byte of new TextEncoder().encode(wire + wire)) {
    for (const frame of decoder.push(new Uint8Array([byte]))) {
      const event = decodeChatEvent(frame);
      if (!event) throw new Error("工具 SSE 解码失败");
      replayed = applyChatEvent(replayed, scope.messageId, event);
    }
  }
  expect(replayed[0].tools).toEqual(restored.tools);
  expect(replayed[0].content).toBe("正常回答保持独立。");
  expect(JSON.stringify(restored)).not.toContain("channels-private-input");
  return { history, restored };
}

beforeEach(async () => {
  queryProvider.mockClear(); network.mockClear();
  vi.stubGlobal("fetch", network);
  config = { apiKey: "channels-fake-" + randomUUID() };
  // WHY：真实 SQLite、余弦检索和融合保留，只替换 embedding；正交向量确保关键词独占来源确实没有语义命中。
  db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE editions(id TEXT); CREATE TABLE chapters(id TEXT,edition_id TEXT,title TEXT,order_index INTEGER); CREATE TABLE paragraphs(id TEXT,chapter_id TEXT,text TEXT,order_index INTEGER); CREATE TABLE reading_threads(id TEXT PRIMARY KEY,edition_id TEXT); CREATE TABLE chat_messages(id TEXT PRIMARY KEY,thread_id TEXT,role TEXT,status TEXT,structured_output TEXT); CREATE TABLE agent_tool_runs(id TEXT PRIMARY KEY,message_id TEXT,thread_id TEXT,attempt_id TEXT,tool_name TEXT,input_json TEXT,output_json TEXT,status TEXT,created_at TEXT); INSERT INTO editions VALUES('channels-edition'),('foreign-edition'); INSERT INTO chapters VALUES('c1','channels-edition','当前章',0),('foreign-c','foreign-edition','外版章',0); INSERT INTO reading_threads VALUES('channels-thread','channels-edition'); INSERT INTO chat_messages VALUES('channels-answer','channels-thread','assistant','streaming','{}');");
  db.prepare("UPDATE chat_messages SET structured_output=? WHERE id=?").run(JSON.stringify({ _request: { attemptId: scope.attemptId } }), scope.messageId);
  for (const [id, text, order] of [["p-keyword", texts.lexical, 0], ["p-semantic", texts.semantic, 1], ["p-both", texts.overlap, 2]] as const) db.prepare("INSERT INTO paragraphs VALUES(?,?,?,?)").run(id, "c1", text, order);
  db.prepare("INSERT INTO paragraphs VALUES(?,?,?,?)").run("p-foreign", "foreign-c", texts.foreign, 0);
  await buildVectorBatch(db, scope.editionId, config, undefined, corpusEmbedding);
  await buildVectorBatch(db, "foreign-edition", config, undefined, corpusEmbedding);
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  expect(network).not.toHaveBeenCalled();
});

const expectedByMode: Record<Mode, Record<string, Channel[]>> = {
  keyword: { "p-keyword": ["keyword"], "p-both": ["keyword"] },
  semantic: { "p-semantic": ["semantic"], "p-both": ["semantic"] },
  hybrid: { "p-keyword": ["keyword"], "p-semantic": ["semantic"], "p-both": ["keyword", "semantic"] },
};

describe("真实检索服务按实际命中记录来源渠道", () => {
  it.each(["keyword", "semantic", "hybrid"] as const)("%s：不根据全局模式或正文包含关键词猜测单条来源渠道", async mode => {
    const result = await retrieve()({ query: "needle", mode, chapterId: "c1", limit: 8 });
    expectChannels(result.sources, expectedByMode[mode]);
    expect(result.retrieval.effectiveMode).toBe(mode);
    expect(result.sources.map(item => item.paragraphId)).not.toContain("p-foreign");
    expect(queryProvider).toHaveBeenCalledTimes(mode === "keyword" ? 0 : 1);
    for (const item of result.sources) expect(item.sourceId).toBe("book:" + scope.editionId + ":paragraph:" + item.paragraphId);
  });

  it("补充查询使同段跨查询命中两路时合并渠道，但不重复来源和渠道", async () => {
    const result = await retrieve()({ query: "needle", additionalQueries: ["concept", "needle"], mode: "hybrid", limit: 8 });
    expectChannels(result.sources, { "p-keyword": ["keyword"], "p-semantic": ["keyword", "semantic"], "p-both": ["keyword", "semantic"] });
    expect(result.retrieval.queries).toEqual(["needle", "concept"]);
    expect(result.retrieval.branches).toHaveLength(4);
    expect(queryProvider).toHaveBeenCalledTimes(2);
  });

  it("最终 limit 截断不丢失已融合来源的双路归属", async () => {
    const result = await retrieve()({ query: "needle", mode: "hybrid", limit: 1 });
    expectChannels(result.sources, { "p-both": ["keyword", "semantic"] });
    expect(result.retrieval.sourceCount).toBe(1);
    expect(result.results).toHaveLength(1);
  });

  it("语义支路报错降级后，关键词结果不得冒充双路来源", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failingVector = vi.fn<typeof searchVectors>().mockRejectedValue(new Error("channels-private-provider-error"));
    const result = await retrieve({ vector: failingVector })({ query: "needle", mode: "hybrid", limit: 8 });
    expectChannels(result.sources, expectedByMode.keyword);
    expect(result.retrieval).toMatchObject({ effectiveMode: "keyword", degraded: true });
    expect(JSON.stringify(result)).not.toContain("channels-private-provider-error");
    expect(errorLog).toHaveBeenCalled();
    expect(queryProvider).not.toHaveBeenCalled();
  });

  it("禁用语义时 auto 只标实际关键词渠道，不因已有向量索引标 semantic", async () => {
    const result = await retrieve({ semanticEnabled: false })({ query: "needle", mode: "auto", limit: 8 });
    expectChannels(result.sources, expectedByMode.keyword);
    expect(result.retrieval).toMatchObject({ effectiveMode: "keyword", degraded: true });
    expect(queryProvider).not.toHaveBeenCalled();
  });
});

describe("channels 经真实工具和历史回放保持原义", () => {
  it.each(["keyword", "semantic", "hybrid"] as const)("%s：工具 → 审计 SQLite → SSE → 刷新不丢 channels", async mode => {
    const readingTools = tools();
    const output: unknown = await readingTools[0].invoke({ query: "needle", mode, limit: 8 });
    expectChannels(sourceObjects(output), expectedByMode[mode]);
    persist(output);
    const { history, restored } = replayAndHydrate();
    expect(history.tools).toHaveLength(1);
    expect(history.tools[0].result).toEqual(output);
    expectChannels(sourceObjects(restored.tools![0].result), expectedByMode[mode]);
  });

  it.each([false, true])("旧来源无 channels 时不猜渠道，即使附带全局 hybrid 报告：%s", async includeReport => {
    const current = await retrieve()({ query: "needle", mode: "hybrid", limit: 8 });
    const legacy = current.sources.map(item => Object.fromEntries(Object.entries(item).filter(([key]) => key !== "channels")));
    persist({ ok: true, sources: legacy, ...(includeReport ? { retrieval: current.retrieval } : {}) });
    const { restored } = replayAndHydrate();
    const sources = sourceObjects(restored.tools![0].result);
    expect(sources).toHaveLength(3);
    for (const item of sources) expect(item).not.toHaveProperty("channels");
  });

  it("read_source 独立保留工具类型，新读出的邻段不能继承 search_book 渠道", async () => {
    const readingTools = tools();
    const searched: unknown = await readingTools[0].invoke({ query: "needle", mode: "keyword", limit: 1 });
    expectChannels(sourceObjects(searched), { "p-keyword": ["keyword"] });
    persist(searched);
    const read: unknown = await readingTools[1].invoke({ sourceId: "book:" + scope.editionId + ":paragraph:p-keyword", neighbors: 2 });
    persist(read, "read_source", "read-call", "2026-09-24T00:00:00.001Z");
    const { restored } = replayAndHydrate();
    expect(restored.tools?.map(tool => tool.name)).toEqual(["search_book", "read_source"]);
    const readResult = restored.tools![1].result;
    expect(readResult).not.toHaveProperty("retrieval");
    const newlyRead = sourceObjects(readResult).find(item => item.paragraphId === "p-semantic");
    expect(newlyRead).toBeDefined();
    expect(newlyRead).not.toHaveProperty("channels");
    expectChannels(sourceObjects(restored.tools![0].result), { "p-keyword": ["keyword"] });
  });

  it("保留合法 channels 不放宽跨版本来源或其它敏感字段边界", async () => {
    const result = await retrieve()({ query: "needle", mode: "hybrid", limit: 8 });
    persist({ ok: true, retrieval: result.retrieval, apiKey: "channels-private-output", sources: [
      ...result.sources.map(item => ({ ...item, apiKey: "channels-private-nested" })),
      { sourceId: "book:foreign-edition:paragraph:p-foreign", paragraphId: "p-foreign", chapterId: "foreign-c", chapterTitle: "外版章", text: "channels-foreign-secret", channels: ["keyword", "semantic"] },
    ] });
    const { restored } = replayAndHydrate();
    expectChannels(sourceObjects(restored.tools![0].result), expectedByMode.hybrid);
    for (const marker of ["channels-private-output", "channels-private-nested", "channels-foreign-secret"]) expect(JSON.stringify(restored)).not.toContain(marker);
  });
});
