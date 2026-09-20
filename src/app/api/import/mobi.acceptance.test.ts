import { mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createDatabase as CreateDatabase } from "@/lib/db";
import { makeMobiFixture } from "@/lib/mobi-fixture";
const state = vi.hoisted(() => ({ db: undefined as ReturnType<typeof CreateDatabase> | undefined }));
vi.mock("@/lib/db", async original => { const actual = await original<typeof import("@/lib/db")>(); return { ...actual, getDb: () => { if (!state.db) throw new Error("测试数据库未初始化"); return state.db; } }; });
import { createDatabase } from "@/lib/db";
import { POST } from "./route";

describe("MOBI文本导入与AZW格式门禁", () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "judu-mobi-test-")); vi.stubEnv("JUDU_DATA_DIR", directory); state.db = createDatabase(); vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(async () => { state.db?.close(); state.db = undefined; vi.restoreAllMocks(); vi.unstubAllEnvs(); const resolved = path.resolve(directory); if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("judu-mobi-test-")) throw new Error("不安全测试清理"); await rm(resolved, { recursive: true, force: true }); });

  it("开放无DRM MOBI的文本导入并保留原件", async () => {
    const bytes = makeMobiFixture(); const form = new FormData(); form.set("file", new File([new Uint8Array(bytes)], "book.mobi"));
    const response = await POST(new NextRequest("http://localhost/api/import", { method: "POST", body: form }));
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result.fileType ?? result.edition?.fileType).toBe(".mobi");
    expect(result.chapters.flatMap((chapter: { paragraphs: { text: string }[] }) => chapter.paragraphs.map(paragraph => paragraph.text))).toEqual(["第一段。", "第二段😀。"]);
    expect(state.db!.prepare("SELECT COUNT(*) AS n FROM books").get()).toEqual({ n: 1 });
    expect(await readdir(path.join(directory, "originals"))).toHaveLength(1);
  }, 20000);

  it.each(["book.azw", "book.azw3"])("%s仍明确返回415，不把AZW改后缀冒充已开放MOBI", async fileName => {
    const form = new FormData(); form.set("file", new File([new Uint8Array(makeMobiFixture())], fileName));
    const response = await POST(new NextRequest("http://localhost/api/import", { method: "POST", body: form }));
    expect(response.status).toBe(415); expect((await response.json()).error).toContain("尚未开放导入");
    for (const table of ["books", "editions", "chapters", "paragraphs"]) expect(state.db!.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    expect(await readdir(directory)).not.toContain("originals");
  });
});