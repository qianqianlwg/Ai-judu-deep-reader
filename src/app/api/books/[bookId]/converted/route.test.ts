import { mkdtemp, readFile, rm, chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createDatabase as CreateDatabase } from "@/lib/db";
const state = vi.hoisted(() => ({ db: undefined as ReturnType<typeof CreateDatabase> | undefined }));
vi.mock("@/lib/db", async original => { const actual = await original<typeof import("@/lib/db")>(); return { ...actual, getDb: () => { if (!state.db) throw new Error("测试数据库不存在"); return state.db; } }; });
import { createDatabase } from "@/lib/db";
import { importUmdEdition } from "@/lib/umd-import";
import { makeUmdFixture } from "@/lib/umd-fixture";
import { readBookResponse, readLibraryResponse } from "@/lib/library";
import { GET } from "./route";
import { GET as originalGet } from "../original/route";
import { GET as bookGet } from "../route";
import { GET as libraryGet } from "../../../library/route";
import { GET as booksGet } from "../../route";
let directory: string, book: Awaited<ReturnType<typeof importUmdEdition>>, source: Buffer;
const request = (bookId: string = book.id, query = "?editionId=" + book.editionId) => GET(new Request("http://localhost/api/books/ignored/converted" + query), { params: Promise.resolve({ bookId }) });
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "judu-converted-route-")); vi.stubEnv("JUDU_DATA_DIR", directory); state.db = createDatabase(); vi.spyOn(console, "error").mockImplementation(() => {});
  source = await readFile("src/lib/fixtures/umd/flyfish-book.umd"); book = await importUmdEdition({ db: state.db, dataDir: directory }, '文件 "引号".umd', source);
});
afterEach(async () => { state.db?.close(); state.db = undefined; vi.restoreAllMocks(); vi.unstubAllEnvs(); if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("judu-converted-route-")) throw new Error("清理越界"); await rm(directory, { recursive: true, force: true }); });

describe("同一UMD版本的原件和派生EPUB API闭环", () => {
  it("两个端点返回各自字节/哈希，原件没有被EPUB替代且都是安全附件", async () => {
    const converted = await request(), original = await originalGet(new Request("http://localhost/api/books/x/original?editionId=" + book.editionId), { params: Promise.resolve({ bookId: book.id }) });
    const a = Buffer.from(await original.arrayBuffer()), b = Buffer.from(await converted.arrayBuffer());
    expect(original.status).toBe(200); expect(converted.status).toBe(200); expect(a).toEqual(source); expect(b.subarray(0, 2).toString()).toBe("PK"); expect(b.equals(a)).toBe(false);
    expect(createHash("sha256").update(a).digest("hex")).toBe(book.edition.originalHash);
    expect(createHash("sha256").update(b).digest("hex")).toBe(book.edition.conversion.fileHash);
    expect(converted.headers.get("content-type")).toBe("application/epub+zip"); expect(original.headers.get("content-type")).toBe("application/octet-stream");
    expect(original.headers.get("content-disposition")).toBe('attachment; filename="original.umd"'); expect(converted.headers.get("content-disposition")).toBe('attachment; filename="converted.epub"');
    for (const response of [original, converted]) { expect(response.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'; frame-ancestors 'none'"); expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("x-content-type-options")).toBe("nosniff"); }
  });
  it("所有书库读取入口保留转换信息和精读正文，但不泄露存储路径或私有映射", async () => {
    const library = await (await libraryGet()).json(), books = await (await booksGet()).json();
    const response = await bookGet(new Request("http://localhost/api/books/x?editionId=" + book.editionId), { params: Promise.resolve({ bookId: book.id }) });
    const json = await response.json(), parsed = readBookResponse(json, book.id, book.editionId);
    expect(readLibraryResponse(library)[0].editions?.[0].conversion).toEqual(book.edition.conversion);
    expect(books[0].edition.conversion).toEqual(book.edition.conversion); expect(parsed.edition?.conversion).toEqual(book.edition.conversion);
    expect(parsed.chapters).toEqual(book.chapters); expect(parsed.edition?.originalHash).not.toBe(parsed.edition?.conversion?.fileHash);
    const serialized = JSON.stringify([library, books, json]); expect(serialized).not.toContain("originals/"); expect(serialized).not.toContain("derived/"); expect(serialized).not.toContain("source_map_json"); expect(serialized).not.toContain("startByte");
  });
  it("他书ID不能读取当前转换版，旧版本没有转换记录不回落", async () => {
    const other = await importUmdEdition({ db: state.db!, dataDir: directory }, "other.umd", makeUmdFixture());
    expect((await request(other.id, "?editionId=" + book.editionId)).status).toBe(404);
    state.db!.exec("INSERT INTO books VALUES ('old-book','旧书','作者','old'); INSERT INTO editions (id,book_id,file_name,file_type,file_hash,created_at) VALUES ('old-edition','old-book','old.epub','.epub','old','old')");
    expect((await request("old-book", "?editionId=old-edition")).status).toBe(404); expect((await request("missing")).status).toBe(404);
  });
  it.each(["", "?editionId=", "?editionId=one&editionId=two", "?editionId=one&file=../../private", "?editionId=bad/path"])("非法query%s拒绝", async query => expect((await request(book.id, query)).status).toBe(400));
  it.each(["originals", "derived"])("%s文件损坏时不给出看似有效的转换版", async role => {
    const filename = path.join(directory, role, book.editionId + (role === "originals" ? ".umd" : ".epub"));
    await chmod(filename, 0o600); const bytes = await readFile(filename); bytes[bytes.length - 1] ^= 1; await writeFile(filename, bytes);
    const response = await request(); expect(response.status).toBe(409); expect((await response.json()).code).toBe("CORRUPT_FILE");
  });
  it.each(["originals", "derived"])("%s文件丢失不重建或偷偷改用另一份文件", async role => {
    await rm(path.join(directory, role, book.editionId + (role === "originals" ? ".umd" : ".epub")));
    const response = await request(); expect(response.status).toBe(404); expect((await response.json()).code).toBe("MISSING_FILE");
  });
  it("原件元数据被改绑另一文件时明确拒绝", async () => {
    state.db!.prepare("UPDATE editions SET original_file_path=? WHERE id=?").run("originals/other.umd", book.editionId);
    const response = await request(); expect(response.status).toBe(409); expect((await response.json()).code).toBe("CORRUPT_CONVERSION");
  });
  it("数据库来源映射损坏不能伪装为旧版本", async () => {
    state.db!.prepare("UPDATE edition_conversions SET source_map_json=? WHERE edition_id=?").run(JSON.stringify({ version: 1, chapters: [{ href: "OPS/chapter-0001.xhtml", startByte: 2, endByte: 8 }] }), book.editionId);
    const response = await request(); expect(response.status).toBe(409); expect((await response.json()).code).toBe("CORRUPT_CONVERSION");
  });
});
