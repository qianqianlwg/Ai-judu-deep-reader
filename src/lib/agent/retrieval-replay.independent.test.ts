import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hydrateChatHistory } from "../chat-history";
import { applyChatEvent, decodeChatEvent, type ChatMessage, type ToolActivity } from "../chat-stream";
import { conversationToolFromRow } from "../conversations";
import { SseDecoder } from "../sse";
import { insertCurrentAttemptToolRun, readThreadToolHistory, toolReplayEvents, type ToolAttemptScope, type ToolAuditRun, type ToolHistoryDatabase } from "./tool-history";

type TestDb = ToolHistoryDatabase & { exec(sql: string): void; close(): void };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (file: string) => TestDb };
const scope: ToolAttemptScope = { threadId: "independent-thread", messageId: "answer-1", editionId: "edition-a", attemptId: "attempt-current" };
let db: TestDb;
const network = vi.fn(async () => { throw new Error("独立验证禁止真实网络请求"); });
const source = (id: string, text: string, edition = scope.editionId) => ({ sourceId: "book:" + edition + ":paragraph:" + id, paragraphId: id, chapterId: "chapter-a", chapterTitle: "检索来源", text });
const run = (id: string, text: string): ToolAuditRun => ({ id, name: "search_book", input: { query: text, apiKey: "private-input-marker" }, output: { ok: true, sources: [source(id, text)] }, status: "completed" });
function attempt(id: string, messageId = scope.messageId, status = "streaming") {
  db.prepare("UPDATE chat_messages SET structured_output=?,status=? WHERE id=?").get(JSON.stringify({ _request: { attemptId: id } }), status, messageId);
}
function persistRaw(id: string, attemptId: string | null, messageId = scope.messageId, threadId = scope.threadId) {
  db.prepare("INSERT INTO agent_tool_runs VALUES(?,?,?,?,?,?,?,?,?)").get(id, messageId, threadId, attemptId, "search_book", "{}", JSON.stringify(run(id, id).output), "completed", "2026-09-24T00:00:00.000Z");
}
const sorted = (tools: ToolActivity[] = []) => [...tools].sort((a, b) => a.id.localeCompare(b.id));

beforeEach(() => {
  network.mockClear();
  vi.stubGlobal("fetch", network);
  // WHY：仅使用内存 SQLite；独立审计不能触碰正式 data 或依赖预存的模型密钥。
  db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE reading_threads(id TEXT PRIMARY KEY,edition_id TEXT); CREATE TABLE chat_messages(id TEXT PRIMARY KEY,thread_id TEXT,role TEXT,status TEXT,structured_output TEXT); CREATE TABLE agent_tool_runs(id TEXT PRIMARY KEY,message_id TEXT,thread_id TEXT,attempt_id TEXT,tool_name TEXT,input_json TEXT,output_json TEXT,status TEXT,created_at TEXT); INSERT INTO reading_threads VALUES('independent-thread','edition-a'),('foreign-thread','edition-b'); INSERT INTO chat_messages VALUES('answer-1','independent-thread','assistant','streaming','{}'),('answer-2','independent-thread','assistant','streaming','{}'),('foreign-answer','foreign-thread','assistant','streaming','{}');");
  attempt(scope.attemptId);
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
  expect(network).not.toHaveBeenCalled();
});

describe("独立验收：并行工具完成、SSE 回放和刷新一致性", () => {
  it("两调用逆序完成，首个正文前即可恢复来源；逐字节中文分片和重复回放不重复工具", () => {
    let live: ChatMessage[] = [{ id: scope.messageId, role: "assistant", content: "", status: "streaming", outputFormat: "text" }];
    for (const id of ["keyword-call", "vector-call"]) live = applyChatEvent(live, scope.messageId, { type: "tool", tool: { id, name: "search_book", status: "running" } });
    for (const entry of [run("vector-call", "语义来源：猫在休息。"), run("keyword-call", "关键词来源：晒太阳。")]) {
      insertCurrentAttemptToolRun(db, scope, entry);
      live = applyChatEvent(live, scope.messageId, { type: "tool", tool: { id: entry.id, name: entry.name, status: entry.status, result: entry.output } });
    }
    expect(live[0].content).toBe("");
    expect(live[0].tools).toHaveLength(2);
    expect(live[0].tools?.every(tool => tool.status === "completed")).toBe(true);
    attempt(scope.attemptId, scope.messageId, "completed");
    const history = readThreadToolHistory(db, scope).get(scope.messageId)!;
    const refreshed = hydrateChatHistory([{ id: scope.messageId, role: "assistant", content: "正常回答", status: "completed", ...history }]);
    const frames = toolReplayEvents(db, scope).map(event => "event: tool\r\ndata: " + JSON.stringify({ tool: event.tool }) + "\r\n\r\n").join("");
    let replayed: ChatMessage[] = [{ id: scope.messageId, role: "assistant", content: "正常回答", status: "completed" }];
    const decoder = new SseDecoder();
    for (const byte of new TextEncoder().encode(frames + frames)) {
      for (const frame of decoder.push(new Uint8Array([byte]))) {
        const event = decodeChatEvent(frame);
        expect(event?.type).toBe("tool");
        if (event) replayed = applyChatEvent(replayed, scope.messageId, event);
      }
    }
    expect(sorted(replayed[0].tools)).toEqual(sorted(refreshed[0].tools));
    expect(sorted(refreshed[0].tools)).toEqual(sorted(live[0].tools));
    expect(replayed[0].content).toBe("正常回答");
    expect(JSON.stringify(history)).not.toContain("private-input-marker");
  });

  it("相同 provider call ID 跨消息、跨 attempt 复用，刷新和幂等回放均不串卡", () => {
    insertCurrentAttemptToolRun(db, scope, run("shared-call", "旧来源"));
    attempt("attempt-new");
    insertCurrentAttemptToolRun(db, { ...scope, attemptId: "attempt-new" }, run("shared-call", "新来源"));
    attempt("attempt-new", "answer-2");
    insertCurrentAttemptToolRun(db, { ...scope, messageId: "answer-2", attemptId: "attempt-new" }, run("shared-call", "另一条消息来源"));
    persistRaw("unowned", null);
    persistRaw("forged-cross-thread", "attempt-new", "foreign-answer", scope.threadId);
    const history = readThreadToolHistory(db, scope).get(scope.messageId)!;
    expect(history.tools).toHaveLength(1);
    expect(history.historicalTools).toHaveLength(2);
    const restored = hydrateChatHistory([{ id: scope.messageId, role: "assistant", content: "当前回答", status: "completed", ...history }])[0];
    expect(restored.tools?.[0].id).toBe("shared-call");
    expect(JSON.stringify(restored.tools)).toContain("新来源");
    expect(JSON.stringify(restored.tools)).not.toContain("旧来源");
    expect(JSON.stringify(restored)).not.toContain("另一条消息来源");
    expect(JSON.stringify(restored)).not.toContain("forged-cross-thread");
    expect(toolReplayEvents(db, scope).map(event => event.tool)).toEqual(history.tools);
    expect(toolReplayEvents(db, { ...scope, editionId: "edition-b" })).toEqual([]);
  });

  it("搜索结果和嵌套引用都过滤异版来源及私有字段，当前与历史尝试采用同一规则", () => {
    const output = { ok: true, apiKey: "private-output-marker", sources: [source("good", "本版文字"), source("bad", "foreign-marker", "edition-b")], result: { citations: [{ ...source("nested", "nested-foreign-marker", "edition-b"), quote: "foreign-quote-marker" }], sources: [source("nested-good", "嵌套本版文字")], headers: { Authorization: "private-auth-marker" } } };
    insertCurrentAttemptToolRun(db, scope, { ...run("nested", "检索"), output });
    const current = readThreadToolHistory(db, scope).get(scope.messageId)!;
    attempt("replacement");
    const older = readThreadToolHistory(db, scope).get(scope.messageId)!;
    const serialized = JSON.stringify([current, older]);
    for (const secret of ["foreign-marker", "foreign-quote-marker", "private-input-marker", "private-output-marker", "private-auth-marker"]) expect(serialized).not.toContain(secret);
    expect(serialized).toContain("本版文字");
    expect(serialized).toContain("嵌套本版文字");
    expect(older.historicalTools[0].result).toEqual(current.tools[0].result);
  });

  it("历史截断不改写审计原文，损坏的 attempt 元数据不误归当前尝试", () => {
    const longText = "长".repeat(2500);
    insertCurrentAttemptToolRun(db, scope, run("long", longText));
    expect(readThreadToolHistory(db, scope).get(scope.messageId)?.tools[0].result).toMatchObject({ displayLimited: true, sources: [{ text: "长".repeat(2000) }] });
    for (const metadata of ["broken-json", "{}", JSON.stringify({ _request: { attemptId: " " } })]) {
      db.prepare("UPDATE chat_messages SET structured_output=? WHERE id=?").get(metadata, scope.messageId);
      expect(toolReplayEvents(db, scope)).toEqual([]);
      expect(readThreadToolHistory(db, scope).get(scope.messageId)?.historicalTools).toHaveLength(1);
    }
    const row = db.prepare("SELECT output_json FROM agent_tool_runs").get() as { output_json: string };
    expect(row.output_json).toContain(longText);
  });

  it("刷新时未完成工具转为错误，既不伪装完成也不将结果拼入正文", () => {
    const tool: ToolActivity = { id: "pending", name: "search_book", status: "running", result: { sources: [source("pending", "工具原文")] } };
    const restored = hydrateChatHistory([{ id: scope.messageId, role: "assistant", content: "已有部分回答", status: "streaming", tools: [tool], historicalTools: [{ ...tool, attemptId: "old", auditId: "audit-old" }] }])[0];
    expect(restored.status).toBe("error");
    expect(restored.tools?.[0].status).toBe("error");
    expect(restored.historicalTools?.[0].status).toBe("error");
    expect(restored.content).toBe("已有部分回答");
  });

  it.each([
    { name: "untrusted_tool", status: "completed", outputJson: JSON.stringify({ text: "secret-marker" }) },
    { name: "search_book", status: "error", outputJson: JSON.stringify({ ok: false, error: "secret-marker" }) },
    { name: "search_book", status: "completed", outputJson: "secret-marker" },
    { name: "search_book", status: "completed", outputJson: JSON.stringify({ text: "secret-marker".repeat(12000) }) },
  ])("不向回放泄露未知工具、失败详情、坏 JSON 或超大输出：$name/$status", entry => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = conversationToolFromRow({ id: "unsafe", messageId: scope.messageId, ...entry }, scope.editionId);
      expect(result).toBeDefined();
      expect(JSON.stringify(result)).not.toContain("secret-marker");
      if (entry.outputJson === "secret-marker") expect(warn).toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });
});
