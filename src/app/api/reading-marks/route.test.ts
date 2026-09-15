import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashText } from "@/lib/hash";
const MARKS_SCHEMA = "CREATE TABLE reading_marks (id TEXT PRIMARY KEY, edition_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('highlight', 'note', 'favorite')), color TEXT NOT NULL DEFAULT 'yellow' CHECK (color IN ('yellow', 'green', 'blue', 'pink', 'orange')), note TEXT NOT NULL DEFAULT '', anchors_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX idx_reading_marks_edition_updated ON reading_marks (edition_id, updated_at, id);";
import type { getDb } from "@/lib/db";
type Db = ReturnType<typeof getDb> & { close(): void };
const state = vi.hoisted(() => ({ db: undefined as Db | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
import { DELETE, GET, POST } from "./route";
const runtime = (process as unknown as { getBuiltinModule(name: string): { DatabaseSync: new (file: string) => Db } }).getBuiltinModule("node:sqlite");
const text = "一段可读原文😀，保留原始字符。";
const anchor = (paragraphId = "p1", startOffset = 0, endOffset = text.length) => { const selectedText = text.slice(startOffset, endOffset); return { paragraphId, startOffset, endOffset, selectedText, textHash: hashText(selectedText) }; };
const post = (body: unknown) => POST(new Request("http://localhost/api/reading-marks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const get = (query = "editionId=e1") => GET(new Request("http://localhost/api/reading-marks?" + query));
const remove = (body: unknown) => DELETE(new Request("http://localhost/api/reading-marks", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
beforeEach(() => {
  state.db = new runtime.DatabaseSync(":memory:"); state.db.exec(MARKS_SCHEMA + "\n    CREATE TABLE editions (id TEXT PRIMARY KEY, book_id TEXT);\n    CREATE TABLE chapters (id TEXT PRIMARY KEY, edition_id TEXT, order_index INTEGER);\n    CREATE TABLE paragraphs (id TEXT PRIMARY KEY, chapter_id TEXT, text TEXT, text_hash TEXT, order_index INTEGER);\n    INSERT INTO editions VALUES ('e1','b1'),('e2','b1');\n    INSERT INTO chapters VALUES ('c1','e1',0),('c2','e2',0);\n    INSERT INTO paragraphs VALUES ('p1','c1','" + text + "','" + hashText(text) + "',0),('p2','c2','" + text + "','" + hashText(text) + "',0);\n  ");
  vi.spyOn(console, "warn").mockImplementation(() => undefined); vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { state.db?.close(); vi.restoreAllMocks(); });

describe("/api/reading-marks", () => {
  it("GET 版本隔离，POST 新建并返回默认黄色，DELETE 只删对应版本", async () => {
    const created = await post({ editionId: "e1", kind: "highlight", anchors: [anchor()] });
    expect(created.status).toBe(201); expect(created.headers.get("Cache-Control")).toBe("no-store");
    const mark = (await created.json()).mark;
    expect(mark).toMatchObject({ editionId: "e1", kind: "highlight", color: "yellow", note: "", anchors: [anchor()] });
    expect(await (await get()).json()).toMatchObject({ editionId: "e1", marks: [mark] });
    expect(await (await get("editionId=e2")).json()).toMatchObject({ editionId: "e2", marks: [] });
    expect((await remove({ editionId: "e2", id: mark.id })).status).toBe(404);
    expect((await remove({ editionId: "e1", id: mark.id })).status).toBe(200);
    expect(await (await get()).json()).toMatchObject({ marks: [] });
  });
  it("POST 相同 id 更新而不改变创建时间，多个标注不互相覆盖", async () => {
    const first = await (await post({ editionId: "e1", kind: "note", note: "第一次", anchors: [anchor()] })).json();
    const update = await post({ id: first.mark.id, editionId: "e1", kind: "favorite", color: "blue", anchors: [anchor("p1", 0, 2)] });
    expect(update.status).toBe(200); expect((await update.json()).mark).toMatchObject({ id: first.mark.id, kind: "favorite", color: "blue", note: "", createdAt: first.mark.createdAt });
    expect((await (await post({ editionId: "e1", kind: "highlight", anchors: [anchor()] })).json()).created).toBe(true);
    expect((await (await get()).json()).marks).toHaveLength(2);
  });
  it("错误可恢复且不泄露跨版本标注、原文或笔记", async () => {
    const invalid = await post({ editionId: "e1", kind: "note", note: "", anchors: [anchor()] });
    expect(invalid.status).toBe(400); expect(await invalid.json()).toMatchObject({ recoverable: true, code: "empty_note" });
    const stale = await post({ editionId: "e1", kind: "highlight", anchors: [{ ...anchor(), selectedText: "X".repeat(text.length), textHash: hashText("X".repeat(text.length)) }] });
    expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ recoverable: true, code: "anchor_mismatch" });
    expect((await get("editionId=")).status).toBe(400); expect((await get("editionId=e1&editionId=e2")).status).toBe(400);
    expect((await post({ editionId: "e2", kind: "highlight", anchors: [anchor("p1")] })).status).toBe(409);
    expect((await remove({ editionId: "e2", id: "not-mine" })).status).toBe(404);
    expect(await (await get()).json()).toMatchObject({ marks: [] });
    expect((await post({ editionId: "e1", kind: "highlight", anchors: [anchor()], unexpected: "x" })).status).toBe(400);
  });
  it("拒绝非 JSON、坏 JSON、跨版本更新", async () => {
    expect((await POST(new Request("http://localhost/api/reading-marks", { method: "POST", body: "{}" }))).status).toBe(415);
    expect((await POST(new Request("http://localhost/api/reading-marks", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }))).status).toBe(400);
    const created = await (await post({ editionId: "e1", kind: "note", note: "私密", anchors: [anchor()] })).json();
    expect((await post({ id: created.mark.id, editionId: "e2", kind: "note", note: "泄露", anchors: [anchor("p2")] })).status).toBe(404);
    expect((await remove({ id: created.mark.id, editionId: "e2" })).status).toBe(404);
  });
  it("通过临时回环端口实际走 GET/POST/DELETE 路由并在测试结束释放", async () => {
    const dispatch = async (request: Request) => request.method === "GET" ? GET(request) : request.method === "POST" ? POST(request) : DELETE(request);
    const server: Server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const headers = new Headers(); for (const [key, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(key, value);
      const suffix = request.method === "GET" ? (request.url?.includes("?") ? request.url.slice(request.url.indexOf("?")) : "?editionId=e1") : "";
      const result = await dispatch(new Request("http://127.0.0.1/api/reading-marks" + suffix, { method: request.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }));
      response.statusCode = result.status; result.headers.forEach((value, key) => response.setHeader(key, value)); response.end(Buffer.from(await result.arrayBuffer()));
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
    try {
      const address = server.address(); if (!address || typeof address === "string") throw new Error("临时验证端口未分配");
      console.info("reading-marks 临时 HTTP 验证端口", address.port);
      const base = "http://127.0.0.1:" + address.port + "/api/reading-marks";
      const response = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ editionId: "e1", kind: "highlight", anchors: [anchor("p1", 0, 2)] }) });
      expect(response.status).toBe(201); const mark = (await response.json()).mark;
      expect((await fetch(base + "?editionId=e1")).status).toBe(200);
      expect((await fetch(base, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ editionId: "e1", id: mark.id }) })).status).toBe(200);
      expect(address.port).toBeGreaterThan(0);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
