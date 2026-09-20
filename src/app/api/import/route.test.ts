import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createDatabase as CreateDatabase } from "@/lib/db";
const state = vi.hoisted(() => ({ db: undefined as ReturnType<typeof CreateDatabase> | undefined }));
vi.mock("@/lib/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: () => { if (!state.db) throw new Error("测试数据库未初始化"); return state.db; } };
});
import { createDatabase } from "@/lib/db";
import * as storage from "@/lib/data-storage";
import { hashText } from "@/lib/hash";
import { readBookResponse } from "@/lib/library";
import { POST } from "./route";
import { GET as original } from "../books/[bookId]/original/route";
import { GET as book } from "../books/[bookId]/route";
import { GET as library } from "../library/route";
import { GET as books } from "../books/route";
import { EPUB_HREF, makeEpub, makePdf } from "./fixtures";
let directory: string;
const request = (bytes: Buffer, name: string) => {
  const form = new FormData(); form.set("file", new File([new Uint8Array(bytes)], name));
  return new NextRequest("http://localhost/api/import", { method: "POST", body: form });
};
const getOriginal = (bookId: string, editionId: string) => original(new Request("http://localhost/api/books/ignored/original?editionId=" + editionId), { params: Promise.resolve({ bookId }) });
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "judu-import-test-")); vi.stubEnv("JUDU_DATA_DIR", directory);
  state.db = createDatabase(); vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  state.db?.close(); state.db = undefined; vi.restoreAllMocks(); vi.unstubAllEnvs();
  if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("judu-import-test-")) throw new Error("不安全测试清理");
  await fs.rm(directory, { recursive: true, force: true });
});
async function expectEmpty() {
  expect(state.db!.prepare("SELECT COUNT(*) AS count FROM books").get()).toEqual({ count: 0 });
  expect(state.db!.prepare("SELECT COUNT(*) AS count FROM editions").get()).toEqual({ count: 0 });
  expect(state.db!.prepare("SELECT COUNT(*) AS count FROM paragraphs").get()).toEqual({ count: 0 });
  const originals = path.join(directory, "originals");
  if ((await fs.readdir(directory)).includes("originals")) expect(await fs.readdir(originals)).toEqual([]);
}
describe("import and original retrieval integration", () => {
  it.each([
    ["book.txt", Buffer.from("第一段。\n\n第二段。"), ["第一段。", "第二段。"]],
    ["book.md", Buffer.from("# Heading\n\nMarkdown paragraph."), ["# Heading", "Markdown paragraph."]],
    ["book.epub", makeEpub(), ["First paragraph important .", "第二段， 保持原文。"]],
    ["book.pdf", makePdf(), ["First page text.", "Second page text."]],
  ] as const)("imports %s with unchanged paragraphs, raw bytes, metadata and restart persistence", async (name, bytes, paragraphs) => {
    const response = await POST(request(bytes, name)); const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result).toMatchObject({ fileName: name, hasOriginalFile: true, fileSize: bytes.length, originalHash: createHash("sha256").update(bytes).digest("hex"), readerMode: "text" });
    expect(result.chapters.flatMap((chapter: { paragraphs: { text: string }[] }) => chapter.paragraphs.map(paragraph => paragraph.text))).toEqual(paragraphs);
    expect(result.chapters[0].paragraphs[0].textHash).toBe(Buffer.from(paragraphs[0]).toString("base64url"));
    if (name.endsWith(".epub")) expect(result.chapters[0].sourceHref).toBe(EPUB_HREF);
    const row = state.db!.prepare("SELECT * FROM editions WHERE id = ?").get(result.editionId) as { file_hash: string; original_hash: string; original_file_path: string };
    expect(row.file_hash).toBe(hashText(bytes.toString("base64"))); expect(row.original_hash).toBe(result.originalHash);
    expect(row.original_file_path).toBe(`originals/${result.editionId}${path.extname(name)}`);
    expect(JSON.stringify(result)).not.toContain(directory); expect(JSON.stringify(result)).not.toContain("original_file_path"); expect(JSON.stringify(result)).not.toContain("originals/");
    state.db!.close(); state.db = createDatabase();
    const downloaded = await getOriginal(result.id, result.editionId);
    expect(downloaded.status).toBe(200); expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
    expect(downloaded.headers.get("Content-Disposition")).toBe(`attachment; filename="original${path.extname(name)}"`);
    expect(downloaded.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(downloaded.headers.get("Content-Type")).toBe(name.endsWith(".epub") ? "application/epub+zip" : "application/octet-stream");
    const content = await (await book(new Request("http://localhost/api/books/ignored?editionId=" + result.editionId), { params: Promise.resolve({ bookId: result.id }) })).json();
    const validated = readBookResponse(content, result.id, result.editionId);
    expect(validated.chapters[0].paragraphs[0].id).toBe(result.chapters[0].paragraphs[0].id);
    if (name.endsWith(".epub")) expect(validated.chapters[0].sourceHref).toBe(EPUB_HREF);
    const shelf = await (await library()).json(); const legacy = await (await books()).json();
    expect(shelf[0].editions[0]).toEqual(result.edition); expect(legacy[0].edition).toEqual(result.edition);
    expect(legacy[0].chapters).toEqual(content.chapters);
    expect(JSON.stringify([shelf, legacy, content])).not.toContain(row.original_file_path);
  });
  it("same filename and bytes get independent immutable editions, not accidental overwrite", async () => {
    const first = await (await POST(request(Buffer.from("same text"), "same.txt"))).json();
    const second = await (await POST(request(Buffer.from("same text"), "same.txt"))).json();
    expect(first.id).not.toBe(second.id); expect(first.editionId).not.toBe(second.editionId);
    expect(await fs.readdir(path.join(directory, "originals"))).toHaveLength(2);
    expect((await getOriginal(first.id, second.editionId)).status).toBe(404);
  });
  it.each([["empty.txt", Buffer.alloc(0)], ["blank.txt", Buffer.from("\r\n \n")], ["empty.epub", makeEpub(true)], ["bad.epub", Buffer.from("not a zip")], ["bad.pdf", Buffer.from("not a PDF")]])("rejects empty/malformed %s without rows or originals", async (name, bytes) => {
    const response = await POST(request(bytes, name)); expect(response.status).toBe(422); expect(await response.json()).toHaveProperty("error"); await expectEmpty();
  });
  it("rejects missing/duplicate/non-file upload and broken multipart with JSON", async () => {
    for (const kind of ["missing", "duplicate", "string", "broken"]) {
      const form = new FormData();
      if (kind === "duplicate") { form.append("file", new File(["one"], "a.txt")); form.append("file", new File(["two"], "b.txt")); }
      if (kind === "string") form.set("file", "not a file");
      const input = kind === "broken" ? new NextRequest("http://localhost/api/import", { method: "POST", body: "bad", headers: { "Content-Type": "multipart/form-data; boundary=missing" } }) : new NextRequest("http://localhost/api/import", { method: "POST", body: form });
      const response = await POST(input); expect(response.status).toBe(400); expect(await response.json()).toHaveProperty("error");
    }
    await expectEmpty();
  });
  it("rejects unsupported format and content type before creating storage", async () => {
    expect((await POST(request(Buffer.from("content"), "a.html"))).status).toBe(415);
    const response = await POST(new NextRequest("http://localhost/api/import", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }));
    expect(response.status).toBe(415); await expectEmpty();
  });
  it("rolls back all rows and removes a published original when persistence fails", async () => {
    state.db!.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON paragraphs BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
    const response = await POST(request(Buffer.from("will roll back"), "book.txt"));
    expect(response.status).toBe(500); expect(await response.json()).toHaveProperty("error"); await expectEmpty();
  });
  it("cleans originals when statement preparation fails", async () => {
    state.db!.exec("DROP TABLE chapters");
    const response = await POST(request(Buffer.from("will fail prepare"), "book.txt"));
    expect(response.status).toBe(500); await expectEmpty();
  });
  it("returns JSON and no rows when storage fails", async () => {
    vi.spyOn(storage, "storeOriginalFile").mockRejectedValueOnce(new Error("private path: " + directory));
    const response = await POST(request(Buffer.from("text"), "book.txt")); expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(directory); await expectEmpty();
  });
  it("reports cleanup failure rather than masking it or claiming success", async () => {
    state.db!.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON paragraphs BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
    vi.spyOn(storage, "removeStoredOriginalFile").mockRejectedValueOnce(new Error("cleanup denied"));
    const response = await POST(request(Buffer.from("failed text"), "book.txt")); expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("清理失败");
    expect(state.db!.prepare("SELECT COUNT(*) AS count FROM books").get()).toEqual({ count: 0 });
  });
  it("removes EPUB parser scratch data on successful and unsuccessful parsing", async () => {
    const before = (await fs.readdir(os.tmpdir())).filter(name => name.startsWith("judu-import-") && !name.startsWith("judu-import-test-"));
    await POST(request(makeEpub(), "a.epub")); await POST(request(Buffer.from("broken"), "bad.epub"));
    const after = (await fs.readdir(os.tmpdir())).filter(name => name.startsWith("judu-import-") && !name.startsWith("judu-import-test-"));
    expect(after.sort()).toEqual(before.sort());
  });
});

it("服务端有界拒绝 ZIP 炸弹及虚报大小，返回JSON且无遗留",async()=>{
 const {default:JSZip}=await import('jszip');const archive=new JSZip();archive.file('mimetype','application/epub+zip',{compression:'STORE'});archive.file('chapter.xhtml','x'.repeat(3*1024*1024),{createFolders:false});
 const bomb=await archive.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
 for(const forge of [false,true]) {
   const bytes=Buffer.from(bomb);
   if(forge)for(let at=0;at<bytes.length-46;at++)if(bytes.readUInt32LE(at)===0x02014b50&&bytes.subarray(at+46,at+46+bytes.readUInt16LE(at+28)).toString()==='chapter.xhtml') {
     bytes.writeUInt32LE(32,at+24);bytes.writeUInt32LE(32,bytes.readUInt32LE(at+42)+22);break;
   }
   const response=await POST(request(bytes,'bomb.epub'));expect(response.status).toBe(422);expect(await response.json()).toHaveProperty('error');await expectEmpty();
 }
});

it("组合ZIP comment不能令旧parser改为解压未验证归档",async()=>{
 const {default:JSZip}=await import('jszip');const archive=new JSZip();archive.file('mimetype','application/epub+zip',{compression:'STORE'});archive.file('chapter.xhtml','x'.repeat(3*1024*1024),{createFolders:false});
 const inner=await archive.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),outer=makeEpub();outer.writeUInt16LE(inner.length+1,outer.length-2);
 const response=await POST(request(Buffer.concat([outer,inner,Buffer.from([0])]),'ambiguous.epub'));
 expect(response.status).toBe(422);expect((await response.json()).error).toContain('结束记录存在歧义');await expectEmpty();
});

it("精简导入不发送正文 base64 副本，数据库哈希和原件保持不变",async()=>{
 const req=request(Buffer.from('加速不改变原文。'),'speed.txt');req.headers.set('X-Judu-Import-Response','compact');
 const response=await POST(req);expect(response.status).toBe(200);const data=await response.json();
 expect(data.chapters[0].paragraphs[0]).toEqual({id:expect.any(String),text:'加速不改变原文。'});
 expect(state.db!.prepare('SELECT text_hash FROM paragraphs WHERE id = ?').get(data.chapters[0].paragraphs[0].id)).toEqual({text_hash:hashText('加速不改变原文。')});
 expect(Buffer.from(await (await getOriginal(data.id,data.editionId)).arrayBuffer()).toString()).toBe('加速不改变原文。');
});
