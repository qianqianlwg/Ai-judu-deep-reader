import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashText } from "@/lib/hash";
import { isBookKnowledge, type BookKnowledge } from "@/lib/knowledge";

type TestDatabase = {
  exec: (sql: string) => void;
  close: () => void;
  prepare: (sql: string) => { run: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[]; get: (...args: unknown[]) => unknown };
};
const holder = vi.hoisted(() => ({ db: undefined as TestDatabase | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => {
  if (!holder.db) throw new Error("测试数据库未启动");
  return holder.db;
} }));
import { GET } from "./route";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (file: string) => TestDatabase;
};
const analysis = { summary: "自我意识的承认关系", breakdown: [],
  concepts: [{ name: "自我意识", text: "主体对自身的意识。" }], context: "", uncertainty: "" };
const anchor = { paragraphId: "p1", startOffset: 1, endOffset: 5, selectedText: "自我意识" };

function addMessage(id: string, thread: string, value: unknown, status = "completed", role = "assistant") {
  holder.db?.prepare("INSERT INTO chat_messages VALUES (?, ?, ?, ?, ?, ?)").run(id, thread, role,
    value === null ? null : JSON.stringify(value), status, "2026-09-15T01:00:00Z");
}
function addAnnotation(id: string, messageId: string | null, paragraph = "p1", thread = "t1") {
  holder.db?.prepare("INSERT INTO annotations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    id, paragraph, 1, 5, hashText("自我意识"), thread, "本次标注摘要", '["自我意识"]',
    JSON.stringify([{ name: "自我意识", text: "标注中保存的解释。" }]), messageId, "2026-09-15T01:01:00Z");
}
async function read(edition = "e1", suffix = ""): Promise<BookKnowledge> {
  const response = await GET(new NextRequest("http://localhost/api/knowledge?editionId=" + encodeURIComponent(edition) + suffix));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const result: unknown = await response.json();
  if (!isBookKnowledge(result)) throw new Error("接口数据不符合知识契约");
  return result;
}

beforeEach(() => {
  // WHY：用内存 SQLite 执行真实 JOIN/JSON SQL，不连接用户数据库、不迁移实际 schema。
  holder.db = new DatabaseSync(":memory:");
  holder.db.exec(
    `CREATE TABLE editions (id TEXT PRIMARY KEY);
    CREATE TABLE chapters (id TEXT PRIMARY KEY, edition_id TEXT, title TEXT);
    CREATE TABLE paragraphs (id TEXT PRIMARY KEY, chapter_id TEXT, text TEXT);
    CREATE TABLE reading_threads (id TEXT PRIMARY KEY, edition_id TEXT, selected_text TEXT, paragraph_id TEXT);
    CREATE TABLE chat_messages (id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, structured_output TEXT, status TEXT, created_at TEXT);
    CREATE TABLE annotations (id TEXT PRIMARY KEY, paragraph_id TEXT, start_offset INTEGER, end_offset INTEGER,
      text_hash TEXT, thread_id TEXT, summary TEXT, concepts TEXT, concept_details TEXT DEFAULT '[]', message_id TEXT, created_at TEXT);
    INSERT INTO editions VALUES ('e1'), ('e2');
    INSERT INTO chapters VALUES ('c1','e1','自我意识'), ('c2','e2','另一版本章节');
    INSERT INTO paragraphs VALUES ('p1','c1','甲自我意识乙'), ('p2','c2','另一版本秘密原文');
    INSERT INTO reading_threads VALUES ('t1','e1','错误的线程最后选文','p1'),
      ('t2','e1','不能用来猜测来源','p1'), ('foreign','e2','别书','p2');`,
  );
  addMessage("m1", "t1", { ...analysis, anchor });
  addMessage("m2", "t2", analysis);
  addMessage("foreign-m", "foreign", { ...analysis, summary: "别书句读不应出现" });
});
afterEach(() => { holder.db?.close(); holder.db = undefined; vi.restoreAllMocks(); });

describe("GET /api/knowledge · 内存 SQLite 集成", () => {
  it("全书读取多个会话并防止跨版本，忽略当前 threadId 限制", async () => {
    const data = await read("e1", "&threadId=t1");
    expect(data.records.map((item) => item.messageId)).toEqual(["m1", "m2"]);
    expect(data.records[0].anchor).toMatchObject({ ...anchor, editionId: "e1", chapterId: "c1" });
    expect(data.records[1]).toMatchObject({ excerpt: "", anchor: null });
    expect(JSON.stringify(data)).not.toContain("另一版本秘密原文");
    expect((await read("e2")).records.map((item) => item.messageId)).toEqual(["foreign-m"]);
  });

  it("显式关联消息去重，LEFT JOIN 保留未关联消息的旧标注和定义", async () => {
    addAnnotation("linked", "m1");
    addAnnotation("legacy", null);
    const data = await read();
    expect(data.records).toHaveLength(3);
    expect(data.records.find((item) => item.messageId === "m1")?.annotationId).toBe("linked");
    expect(data.records.find((item) => item.annotationId === "legacy")).toMatchObject({ messageId: null, excerpt: "自我意识" });
    expect(data.concepts[0].definitions.map((item) => item.text)).toContain("标注中保存的解释。");
  });

  it("普通聊天、伪结构化聊天、失败和用户消息不成为句读", async () => {
    addMessage("chat", "t1", null);
    addMessage("chat-kind", "t1", { ...analysis, kind: "chat" });
    addMessage("failed", "t1", analysis, "error");
    addMessage("user", "t1", analysis, "completed", "user");
    addMessage("streaming", "t1", analysis, "streaming");
    expect((await read()).records).toHaveLength(2);
  });

  it("错误 JSON 不会让 SQLite json_extract 抛错导致全书读取失败", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    holder.db?.prepare("INSERT INTO chat_messages VALUES (?, ?, ?, ?, ?, ?)").run(
      "broken", "t1", "assistant", "{broken", "completed", "2026-09-15T01:00:00Z");
    expect((await read()).records).toHaveLength(2);
    expect(console.warn).toHaveBeenCalled();
  });

  it("消息声明的来源跨版本时保留历史记录但禁用跳转", async () => {
    addMessage("bad-source", "t1", { ...analysis, anchor: { ...anchor, paragraphId: "p2" } });
    const record = (await read()).records.find((item) => item.messageId === "bad-source");
    expect(record).toMatchObject({ anchor: null, chapterTitle: null });
  });

  it("旧标注没有有效会话仍能看卡片和原文，不提供虚假对话入口", async () => {
    addAnnotation("pending", null, "p1", "pending");
    expect((await read()).records.find((item) => item.annotationId === "pending"))
      .toMatchObject({ threadId: null, messageId: null, anchor });
  });

  it("跨线程消息外键和失败消息不会被标注伪装成成功句读", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    addAnnotation("bad-link", "foreign-m");
    addMessage("bad-message", "t1", analysis, "error");
    addAnnotation("failed-link", "bad-message");
    expect((await read()).records).toHaveLength(2);
  });

  it.each(["", "?editionId=", "?editionId=" + "a".repeat(201)])("拒绝缺少或无效版本参数：%s", async (query) => {
    expect((await GET(new NextRequest("http://localhost/api/knowledge" + query))).status).toBe(400);
  });

  it("不存在版本和注入式参数均不返回其他书的数据", async () => {
    for (const edition of ["missing", "' OR 1=1 --"]) {
      expect((await GET(new NextRequest("http://localhost/api/knowledge?editionId=" + encodeURIComponent(edition)))).status).toBe(404);
    }
  });

  it("数据库失败提供可恢复错误，同时记录异常", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    holder.db?.exec("DROP TABLE annotations");
    const response = await GET(new NextRequest("http://localhost/api/knowledge?editionId=e1"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "知识卡片暂时无法读取，请重试。" });
    expect(console.error).toHaveBeenCalled();
  });
});
