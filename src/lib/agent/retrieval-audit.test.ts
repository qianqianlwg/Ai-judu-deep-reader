import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "../db";
import { createBookRetrieval } from "../book-retrieval";
import { hydrateChatHistory } from "../chat-history";
import { applyChatEvent, decodeChatEvent, isRecord, type ChatMessage } from "../chat-stream";
import { conversationToolFromRow } from "../conversations";
import { EMBEDDING_DIMENSIONS, type embedTexts } from "../embedding-provider";
import { createQueryEmbeddingSession } from "../query-embedding";
import { readRetrievalReport, type RetrievalReport } from "../retrieval-report";
import { SseDecoder } from "../sse";
import { buildVectorBatch } from "../vector-index";
import { searchVectors } from "../vector-search";
import { createReadingTools } from "./tools";
import { insertCurrentAttemptToolRun, readThreadToolHistory, toolReplayEvents, type ToolAttemptScope } from "./tool-history";

type TestDb = ReturnType<typeof getDb> & { close(): void };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (file: string) => TestDb };
const scope: ToolAttemptScope = { threadId: "audit-thread", messageId: "audit-answer", editionId: "audit-edition", attemptId: "attempt-one" };
let db: TestDb;
let config: { apiKey: string };
const network = vi.fn(async () => { throw new Error("本测试禁止真实网络与付费 API"); });
const provider = vi.fn<typeof embedTexts>(async (_config, texts, _signal, _fetch, usage) => {
  usage?.({ promptTokens: 7 });
  return texts.map(() => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index === 0 ? 1 : 0));
});
const source = (id = "p1", edition = scope.editionId) => ({ sourceId: "book:" + edition + ":paragraph:" + id, paragraphId: id, chapterId: "c1", chapterTitle: "第一章", text: "猫喜欢晒太阳。", startOffset: 0, endOffset: 7 });
function report(kind: "normal" | "degraded" | "failed" = "normal"): RetrievalReport {
  const failed = kind === "failed", degraded = kind !== "normal";
  return {
    version: 1, requestedMode: failed ? "semantic" : "auto", effectiveMode: failed ? "none" : degraded ? "keyword" : "hybrid",
    queries: ["猫"], branches: [
      ...(!failed ? [{ query: "猫", strategy: "keyword" as const, status: "completed" as const, count: 1, durationMs: 1 }] : []),
      { query: "猫", strategy: "semantic", status: degraded ? "error" : "completed", count: degraded ? 0 : 1, durationMs: 2, ...(degraded ? { reason: "语义检索暂不可用" } : { cacheHit: false, promptTokens: 7 }) },
    ], durationMs: 3, sourceCount: failed ? 0 : 1, degraded,
  };
}
function setAttempt(attemptId: string, status = "streaming") {
  db.prepare("UPDATE chat_messages SET structured_output=?,status=? WHERE id=?").run(JSON.stringify({ _request: { attemptId } }), status, scope.messageId);
}
function persist(output: unknown, status: "completed" | "error" = "completed", attemptId = scope.attemptId, id = "provider-call") {
  insertCurrentAttemptToolRun(db, { ...scope, attemptId }, { id, name: "search_book", input: { query: "猫", apiKey: "audit-private-input", Authorization: "audit-private-header" }, output, status });
}
function replayResult() {
  const events = toolReplayEvents(db, scope);
  expect(events).toHaveLength(1);
  const decoder = new SseDecoder();
  let messages: ChatMessage[] = [{ id: scope.messageId, role: "assistant", content: "正常回复，不是工具 JSON。", status: "completed" }];
  const wire = events.map(event => "event: tool\ndata: " + JSON.stringify({ tool: event.tool }) + "\n\n").join("");
  for (const byte of new TextEncoder().encode(wire + wire)) {
    for (const frame of decoder.push(new Uint8Array([byte]))) {
      const event = decodeChatEvent(frame);
      if (!event) throw new Error("工具事件未成功解码");
      messages = applyChatEvent(messages, scope.messageId, event);
    }
  }
  const history = readThreadToolHistory(db, scope).get(scope.messageId)!;
  const hydrated = hydrateChatHistory([{ id: scope.messageId, role: "assistant", content: messages[0].content, status: "completed", ...history }])[0];
  expect(messages[0].tools).toEqual(hydrated.tools);
  expect(messages[0].tools).toHaveLength(1);
  expect(messages[0].content).toBe("正常回复，不是工具 JSON。");
  expect(JSON.stringify(history)).not.toContain("audit-private-input");
  expect(JSON.stringify(history)).not.toContain("audit-private-header");
  return { result: messages[0].tools![0].result, status: messages[0].tools![0].status, history };
}

beforeEach(async () => {
  network.mockClear(); provider.mockClear();
  vi.stubGlobal("fetch", network);
  config = { apiKey: "audit-fake-" + randomUUID() };
  // WHY：只在内存执行真实 SQL 与假 embedding，禁止 getDb()、正式 data 和真实供应商请求。
  db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE editions(id TEXT); CREATE TABLE chapters(id TEXT,edition_id TEXT,title TEXT,order_index INTEGER); CREATE TABLE paragraphs(id TEXT,chapter_id TEXT,text TEXT,order_index INTEGER); CREATE TABLE reading_threads(id TEXT PRIMARY KEY,edition_id TEXT); CREATE TABLE chat_messages(id TEXT PRIMARY KEY,thread_id TEXT,role TEXT,status TEXT,structured_output TEXT); CREATE TABLE agent_tool_runs(id TEXT PRIMARY KEY,message_id TEXT,thread_id TEXT,attempt_id TEXT,tool_name TEXT,input_json TEXT,output_json TEXT,status TEXT,created_at TEXT); INSERT INTO editions VALUES('audit-edition'),('foreign-edition'); INSERT INTO chapters VALUES('c1','audit-edition','第一章',0),('c2','audit-edition','第二章',1),('foreign-c','foreign-edition','其它版',0); INSERT INTO paragraphs VALUES('p1','c1','猫喜欢晒太阳。',0),('p2','c2','猫在第二章休息。',0),('foreign-p','foreign-c','不可展示的其它版正文。',0); INSERT INTO reading_threads VALUES('audit-thread','audit-edition'),('foreign-thread','foreign-edition'); INSERT INTO chat_messages VALUES('audit-answer','audit-thread','assistant','streaming','{}'),('foreign-answer','foreign-thread','assistant','streaming','{}');");
  setAttempt(scope.attemptId);
  await buildVectorBatch(db, scope.editionId, config, undefined, provider);
  provider.mockClear();
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(network).not.toHaveBeenCalled();
});

describe("新检索契约：真实工具结果持久回放", () => {
  it.each([
    { label: "正常", mode: "auto" as const, failVector: false, expected: "hybrid", status: "completed" as const },
    { label: "降级", mode: "auto" as const, failVector: true, expected: "keyword", status: "completed" as const },
    { label: "failed", mode: "semantic" as const, failVector: true, expected: "none", status: "error" as const },
  ])("$label：service → search_book → 审计 SQL → SSE → 刷新完整保存报告", async scenario => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failingVector = vi.fn<typeof searchVectors>().mockRejectedValue(new Error("audit-private-provider-error"));
    const retrieve = createBookRetrieval({ db, editionId: scope.editionId, config, embeddings: createQueryEmbeddingSession(config, provider), ...(scenario.failVector ? { vector: failingVector } : {}) });
    const tools = createReadingTools({ messageId: scope.messageId, selectedText: "", sources: new Map(), search: retrieve, read: async () => [], save: async () => undefined });
    const search = tools[0];
    const output: unknown = await search.invoke({ query: "猫", chapterId: "c1", mode: scenario.mode, limit: 5 });
    if (!isRecord(output)) throw new Error("新工具结果必须是对象");
    const savedReport = readRetrievalReport(output.retrieval);
    expect(savedReport).toMatchObject({ effectiveMode: scenario.expected, degraded: scenario.failVector });
    expect(output.ok).toBe(scenario.status === "completed");
    persist(output, scenario.status);
    setAttempt(scope.attemptId, "completed");
    const restored = replayResult();
    expect(restored.status).toBe(scenario.status);
    expect(restored.result).toMatchObject({ ok: output.ok, retrieval: savedReport, sources: output.sources });
    expect(JSON.stringify(restored)).not.toContain("audit-private-provider-error");
    expect(JSON.stringify(restored)).not.toContain(config.apiKey);
    if (scenario.failVector) expect(errorLog).toHaveBeenCalled();
    else expect(savedReport?.branches.find(branch => branch.strategy === "semantic")).toMatchObject({ cacheHit: false, promptTokens: 7 });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("audit-private-provider-error");
  });

  it("最多三条查询、六路报告以及 cacheHit/用量/耗时刷新后完整保留", () => {
    const base = report();
    const queries = ["猫", "动物休息", "晒太阳"];
    const retrieval: RetrievalReport = { ...base, queries, branches: queries.flatMap((query, index) => base.branches.map(branch => ({ ...branch, query, durationMs: index + 0.5, ...(branch.strategy === "semantic" ? { cacheHit: index > 0, promptTokens: index === 0 ? 7 : 0 } : {}) }))) };
    persist({ ok: true, sources: [source()], retrieval });
    expect(replayResult().result).toMatchObject({ retrieval });
  });

  it("复用 call ID 重试后当前失败报告与上次成功报告分离，不把旧检索回放成本轮", () => {
    persist({ ok: true, sources: [source()], retrieval: report() });
    setAttempt("attempt-two");
    persist({ ok: false, sources: [], retrieval: report("failed") }, "error", "attempt-two");
    setAttempt("attempt-two", "completed");
    const restored = replayResult();
    expect(restored.result).toMatchObject({ retrieval: report("failed") });
    expect(restored.history.tools).toHaveLength(1);
    expect(restored.history.historicalTools).toHaveLength(1);
    expect(restored.history.historicalTools[0]).toMatchObject({ id: "provider-call", attemptId: "attempt-one", result: { retrieval: report() } });
    expect(toolReplayEvents(db, { ...scope, editionId: "foreign-edition" })).toEqual([]);
    expect(toolReplayEvents(db, { ...scope, messageId: "foreign-answer" })).toEqual([]);
  });
});

describe("新检索报告：白名单和来源隔离", () => {
  it.each(["normal", "degraded", "failed"] as const)("%s 报告保留，外层/嵌套敏感字段及异版来源均不泄漏", kind => {
    const retrieval = report(kind);
    const output = {
      ok: kind !== "failed", retrieval, apiKey: "audit-private-output", Authorization: "audit-private-auth",
      input: { query: "audit-private-query" }, rawError: "audit-private-raw-error",
      sources: [source(), { ...source("foreign-p", "foreign-edition"), text: "audit-foreign-source" }, { ...source("p1"), sourceId: "book:audit-edition:paragraph:mismatch", text: "audit-mismatch-source" }],
      result: { apiKey: "audit-nested-secret", sources: [{ ...source("foreign-p", "foreign-edition"), text: "audit-nested-foreign" }] },
    };
    persist(output, kind === "failed" ? "error" : "completed");
    const restored = replayResult();
    expect(restored.result).toMatchObject({ retrieval, sources: [source()], displayLimited: true });
    const text = JSON.stringify(restored);
    for (const marker of ["audit-private-output", "audit-private-auth", "audit-private-query", "audit-private-raw-error", "audit-foreign-source", "audit-mismatch-source", "audit-nested-secret", "audit-nested-foreign"]) expect(text).not.toContain(marker);
  });

  it.each([
    { label: "报告未知敏感字段", malformed: { ...report(), apiKey: "report-private-marker" } },
    { label: "分支未知敏感字段", malformed: { ...report(), branches: [{ ...report().branches[0], headers: { Authorization: "report-private-marker" } }] } },
    { label: "超过查询数", malformed: { ...report(), queries: ["a", "b", "c", "report-private-marker"] } },
    { label: "超过分支数", malformed: { ...report(), branches: Array.from({ length: 7 }, () => report().branches[0]) } },
    { label: "非法耗时", malformed: { ...report(), durationMs: -1 } },
  ])("$label：拒绝报告而非将其作为通用 JSON 放行", ({ malformed }) => {
    persist({ ok: true, sources: [source()], retrieval: malformed });
    const restored = replayResult();
    expect(restored.result).not.toHaveProperty("retrieval");
    expect(restored.result).toMatchObject({ sources: [source()] });
    expect(JSON.stringify(restored)).not.toContain("report-private-marker");
  });

  it("失败且报告不合法时只显示通用错误，不下发原始输出", () => {
    persist({ ok: false, retrieval: { ...report("failed"), debug: "error-private-marker" }, text: "error-private-marker", error: "error-private-marker" }, "error");
    const restored = replayResult();
    expect(restored.result).not.toHaveProperty("retrieval");
    expect(JSON.stringify(restored)).not.toContain("error-private-marker");
    expect(restored.result).toMatchObject({ ok: false });
  });

  it("检索报告只适配 search_book；不扩宽 read_source 的 query/reason 等通用字段", () => {
    const result = conversationToolFromRow({ id: "read-call", messageId: scope.messageId, name: "read_source", status: "completed", outputJson: JSON.stringify({ ok: true, sources: [source()], retrieval: report(), query: "unlisted-private-marker", queries: ["unlisted-private-marker"], reason: "unlisted-private-marker", branches: [{ query: "unlisted-private-marker" }] }) }, scope.editionId);
    expect(result?.tool.result).toMatchObject({ sources: [source()] });
    expect(result?.tool.result).not.toHaveProperty("retrieval");
    expect(JSON.stringify(result)).not.toContain("unlisted-private-marker");
  });

  it("[回归门禁] failed 报告可回放，但不得因此放行原本被隐藏的任意失败正文", () => {
    // WHY：保留失败检索的元数据不等于信任整个失败输出；通用 text/context 可能携带上游异常内容。
    persist({ ok: false, sources: [], retrieval: report("failed"), text: "failed-private-text", context: "failed-private-context", result: { text: "failed-private-nested" } }, "error");
    const restored = replayResult();
    expect(restored.result).toMatchObject({ retrieval: report("failed") });
    for (const marker of ["failed-private-text", "failed-private-context", "failed-private-nested"]) expect(JSON.stringify(restored)).not.toContain(marker);
  });
});

describe("新服务独立审阅回归", () => {
  it("[回归门禁] 向量 await 期间段落移入另一章节，不能绕过原 chapterId 过滤", async () => {
    const vector = vi.fn<typeof searchVectors>(async (...args) => {
      const matches = await searchVectors(...args);
      db.prepare("UPDATE paragraphs SET chapter_id=? WHERE id=?").run("c2", "p1");
      return matches;
    });
    const retrieve = createBookRetrieval({ db, editionId: scope.editionId, config, vector, embeddings: createQueryEmbeddingSession(config, provider) });
    await expect(retrieve({ query: "猫", chapterId: "c1", mode: "semantic", limit: 5 })).rejects.toThrow(/正文已变化|章节|范围/u);
  });
});


describe("组合根注入后的独立服务侧边界", () => {
  it.each([
    { ok: false, status: "completed" as const },
    { ok: true, status: "error" as const },
  ])("任一失败信号均隐藏失败正文：ok=$ok/status=$status", state => {
    persist({ ok: state.ok, sources: [source()], retrieval: report("failed"), text: "failed-state-private-marker", result: { context: "failed-state-private-marker" } }, state.status);
    const restored = replayResult();
    expect(restored.result).toMatchObject({ ok: false, sources: [source()], retrieval: report("failed") });
    expect(JSON.stringify(restored)).not.toContain("failed-state-private-marker");
  });

  it.each(["auto", "keyword", "hybrid", "semantic"] as const)("语义关闭时 %s 不访问 embedding、不建立或改写索引", async mode => {
    const vector = vi.fn<typeof searchVectors>(searchVectors);
    const before = db.prepare("SELECT * FROM paragraph_embeddings ORDER BY paragraph_id").all();
    const retrieve = createBookRetrieval({ db, editionId: scope.editionId, config, semanticEnabled: false, vector, embeddings: createQueryEmbeddingSession(config, provider) });
    const result = await retrieve({ query: "猫", chapterId: "c1", mode, limit: 5 });
    expect(result.retrieval.effectiveMode).toBe(mode === "semantic" ? "none" : "keyword");
    expect(result.sources).toHaveLength(mode === "semantic" ? 0 : 1);
    if (mode !== "keyword") expect(result.retrieval.branches.find(branch => branch.strategy === "semantic")).toMatchObject({ status: "skipped", reason: "已关闭 AI 自动语义检索" });
    expect(vector).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(db.prepare("SELECT * FROM paragraph_embeddings ORDER BY paragraph_id").all()).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS count FROM embedding_build_leases").get()).toEqual({ count: 0 });
  });

  it.each(["missing-key", "incomplete-index"] as const)("%s 显式降级但不请求 embedding 或自动补建", async unavailable => {
    if (unavailable === "incomplete-index") db.prepare("DELETE FROM paragraph_embeddings WHERE paragraph_id=?").run("p1");
    const selectedConfig = unavailable === "missing-key" ? { apiKey: "" } : config;
    const vector = vi.fn<typeof searchVectors>(searchVectors);
    const before = db.prepare("SELECT COUNT(*) AS count FROM paragraph_embeddings").get();
    const retrieve = createBookRetrieval({ db, editionId: scope.editionId, config: selectedConfig, vector, embeddings: createQueryEmbeddingSession(selectedConfig, provider) });
    const result = await retrieve({ query: "猫", chapterId: "c1", mode: "auto", limit: 5 });
    expect(result.retrieval).toMatchObject({ effectiveMode: "keyword", degraded: true, sourceCount: 1 });
    expect(result.retrieval.branches.find(branch => branch.strategy === "semantic")?.status).toBe("skipped");
    expect(provider).not.toHaveBeenCalled();
    expect(vector).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) AS count FROM paragraph_embeddings").get()).toEqual(before);
  });

  it("多次 search_book 共用组合根 session 预算；缓存可复用但不能隐式重建 session 绕过预算", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const embeddings = createQueryEmbeddingSession(config, provider, 1);
    const retrieve = createBookRetrieval({ db, editionId: scope.editionId, config, embeddings });
    expect((await retrieve({ query: "猫", chapterId: "c1", limit: 5 })).retrieval.effectiveMode).toBe("hybrid");
    const limited = await retrieve({ query: "太阳", chapterId: "c1", limit: 5 });
    expect(limited.retrieval).toMatchObject({ effectiveMode: "keyword", degraded: true });
    expect(limited.retrieval.branches.find(branch => branch.strategy === "semantic")?.status).toBe("error");
    const cached = await retrieve({ query: "猫", chapterId: "c1", limit: 5 });
    expect(cached.retrieval).toMatchObject({ effectiveMode: "hybrid", degraded: false });
    expect(cached.retrieval.branches.find(branch => branch.strategy === "semantic")?.cacheHit).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalled();
  });

  it("三条查询的真实向量支路同时到达注入 provider，逆序完成仍形成六路报告", async () => {
    const finishers: (() => void)[] = [];
    const parallelProvider = vi.fn<typeof embedTexts>((_config, texts, _signal, _fetch, usage) => new Promise(resolve => {
      finishers.push(() => {
        usage?.({ promptTokens: 7 });
        resolve(texts.map(() => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index === 0 ? 1 : 0)));
      });
    }));
    const retrieve = createBookRetrieval({ db, editionId: scope.editionId, config, embeddings: createQueryEmbeddingSession(config, parallelProvider) });
    const pending = retrieve({ query: "猫", additionalQueries: ["动物休息", "晒太阳"], chapterId: "c1", mode: "hybrid", limit: 5 });
    // WHY：在释放任何一次 provider 返回前断言调用数，避免把顺序执行误测成并行。
    try { expect(parallelProvider).toHaveBeenCalledTimes(3); }
    finally { for (const finish of [...finishers].reverse()) finish(); }
    const result = await pending;
    expect(result.retrieval).toMatchObject({ queries: ["猫", "动物休息", "晒太阳"], effectiveMode: "hybrid", degraded: false, sourceCount: 1 });
    expect(result.retrieval.branches).toHaveLength(6);
    expect(result.retrieval.branches.every(branch => branch.status === "completed")).toBe(true);
    expect(result.sources.map(item => item.paragraphId)).toEqual(["p1"]);
  });

  it("同一次调用规范化去重查询，不重复消耗注入的 embedding 预算", async () => {
    const retrieve = createBookRetrieval({ db, editionId: scope.editionId, config, embeddings: createQueryEmbeddingSession(config, provider) });
    const result = await retrieve({ query: " 猫 ", additionalQueries: ["猫", "动物   休息"], chapterId: "c1", limit: 5 });
    expect(result.retrieval.queries).toEqual(["猫", "动物 休息"]);
    expect(result.retrieval.branches).toHaveLength(4);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("等待 embedding 时取消必须拒绝整次检索，不能降级成功或缓存迟到向量", async () => {
    let finish!: () => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    provider.mockImplementationOnce((_config, texts) => new Promise(resolve => {
      finish = () => resolve(texts.map(() => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index === 0 ? 1 : 0)));
      started();
    }));
    const retrieve = createBookRetrieval({ db, editionId: scope.editionId, config, embeddings: createQueryEmbeddingSession(config, provider) });
    const controller = new AbortController();
    const pending = retrieve({ query: "猫", chapterId: "c1", limit: 5, signal: controller.signal });
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await entered;
    controller.abort(); finish();
    await rejection;
    const retried = await retrieve({ query: "猫", chapterId: "c1", limit: 5 });
    expect(retried.retrieval.effectiveMode).toBe("hybrid");
    expect(retried.retrieval.branches.find(branch => branch.strategy === "semantic")?.cacheHit).toBe(false);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_tool_runs").get()).toEqual({ count: 0 });
  });

  it.each(["c2", "foreign-c"])("未限定章节时仍拒绝 await 期间移至 %s 的旧段落快照", async nextChapter => {
    const vector = vi.fn<typeof searchVectors>(async (...args) => {
      const matches = await searchVectors(...args);
      db.prepare("UPDATE paragraphs SET chapter_id=? WHERE id=?").run(nextChapter, "p1");
      return matches;
    });
    const retrieve = createBookRetrieval({ db, editionId: scope.editionId, config, vector, embeddings: createQueryEmbeddingSession(config, provider) });
    await expect(retrieve({ query: "猫", mode: "semantic", limit: 5 })).rejects.toThrow(/正文已变化|章节|范围/u);
  });
});
