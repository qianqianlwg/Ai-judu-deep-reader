import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createDatabase as CreateDatabase } from "@/lib/db";
const state = vi.hoisted(() => ({ db: undefined as ReturnType<typeof CreateDatabase> | undefined }));
vi.mock("@/lib/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: () => { if (!state.db) throw new Error("测试数据库未初始化"); return state.db; } };
});
import { createDatabase } from "@/lib/db";
import { storeOriginalFile } from "@/lib/data-storage";
import { GET } from "./route";
let directory: string;
let stored: Awaited<ReturnType<typeof storeOriginalFile>>;
const get = (bookId = "book-a", query = "?editionId=edition-a") => GET(new Request("http://localhost/api/books/ignored/original" + query), { params: Promise.resolve({ bookId }) });
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "judu-original-route-")); vi.stubEnv("JUDU_DATA_DIR", directory); state.db = createDatabase();
  vi.spyOn(console, "error").mockImplementation(() => {});
  stored = await storeOriginalFile({ dataDir: directory, editionId: "edition-a", extension: ".epub", buffer: Buffer.from("immutable bytes") });
  state.db.exec("INSERT INTO books VALUES ('book-a','a','author','now'),('book-b','b','author','now');");
  const insert = state.db.prepare("INSERT INTO editions (id,book_id,file_name,file_type,file_hash,original_file_path,original_file_size,original_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)");
  insert.run("edition-a", "book-a", "untrusted\r\nInjected: bad.epub", ".epub", "legacy-hash", stored.relativePath, stored.size, stored.originalHash, "now");
  insert.run("legacy", "book-a", "legacy.epub", ".epub", "legacy-hash", "", 0, null, "old");
  insert.run("edition-b", "book-b", "b.epub", ".epub", "legacy-hash", stored.relativePath, stored.size, stored.originalHash, "now");
});
afterEach(async () => {
  state.db?.close(); state.db = undefined; vi.restoreAllMocks(); vi.unstubAllEnvs();
  if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("judu-original-route-")) throw new Error("不安全测试清理");
  await fs.rm(directory, { recursive: true, force: true });
});
describe("original download version and storage boundaries", () => {
  it("only serves exact original bytes with inert attachment headers", async () => {
    const response = await get(); expect(response.status).toBe(200);
    expect(await response.text()).toBe("immutable bytes"); expect(response.headers.get("Content-Length")).toBe("15");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="original.epub"');
    expect(response.headers.get("Content-Type")).toBe("application/epub+zip"); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff"); expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(response.headers.has("Injected")).toBe(false);
  });
  it.each(["", "?editionId=", "?editionId=edition-a&editionId=edition-a", "?other=x&editionId=edition-a", "?editionId=../evil", "?editionId=bad%0Aid", "?editionId=bad%5Cid"])("rejects missing/ambiguous/malicious queries: %s", async query => {
    const response = await get("book-a", query); expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: "INVALID_EDITION", error: expect.any(String) });
  });
  it.each([["book-b", "edition-a"], ["book-a", "edition-b"], ["book-a", "missing"], ["missing", "edition-a"], ["../escape", "edition-a"]])("does not leak foreign/missing book-version %s/%s", async (id, editionId) => {
    const response = await get(id, "?editionId=" + editionId); expect(response.status).toBe(404); expect(await response.json()).toHaveProperty("error");
  });
  it("rejects editions whose owning book has disappeared", async () => {
    state.db!.exec("DELETE FROM books WHERE id='book-a'"); expect((await get()).status).toBe(404);
  });
  it("returns a clear legacy explanation instead of filesystem paths", async () => {
    const response = await get("book-a", "?editionId=legacy"); expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "ORIGINAL_NOT_AVAILABLE", error: expect.stringContaining("现有文本和标注仍可使用") });
  });
  it("returns clear missing and corrupt file JSON", async () => {
    await fs.chmod(stored.absolutePath, 0o600); await fs.writeFile(stored.absolutePath, "tampered bytes!");
    const corrupt = await get(); expect(corrupt.status).toBe(409); expect(await corrupt.json()).toMatchObject({ code: "CORRUPT_FILE" });
    await fs.rm(stored.absolutePath); const missing = await get(); expect(missing.status).toBe(404); expect(await missing.json()).toMatchObject({ code: "MISSING_FILE" });
  });
  it.each(["../secret.txt", "C:\\secret.epub", "originals/edition-b.epub", "originals/edition-a.epub/../secret", "originals/edition-a.html"])("refuses poisoned DB paths: %s", async relativePath => {
    state.db!.prepare("UPDATE editions SET original_file_path=? WHERE id='edition-a'").run(relativePath);
    const response = await get(); expect(response.status).toBe(409); const body = await response.json();
    expect(body.code).toBe("CORRUPT_FILE"); expect(JSON.stringify(body)).not.toContain(relativePath);
  });
  it("rejects stored originals redirected through a junction", async () => {
    await fs.rm(stored.absolutePath); await fs.rmdir(path.join(directory, "originals"));
    const elsewhere = path.join(directory, "elsewhere"); await fs.mkdir(elsewhere); await fs.writeFile(path.join(elsewhere, "edition-a.epub"), "immutable bytes");
    await fs.symlink(elsewhere, path.join(directory, "originals"), "junction");
    const response = await get(); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "UNSAFE_PATH" });
  });
  it("does not invent raw hashes for partially migrated metadata", async () => {
    state.db!.exec("UPDATE editions SET original_hash=NULL WHERE id='edition-a'");
    const response = await get(); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "CORRUPT_FILE" });
  });
  it("returns path-free JSON on unexpected database errors", async () => {
    state.db!.exec("DROP TABLE books"); const response = await get(); expect(response.status).toBe(500);
    const body = await response.json(); expect(body.code).toBe("ORIGINAL_READ_FAILED"); expect(JSON.stringify(body)).not.toContain(directory);
  });
});
