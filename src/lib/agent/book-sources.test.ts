import { afterEach, describe, expect, it } from "vitest";
import type { getDb } from "../db";
import { createBookSources } from "./book-sources";
type Db = ReturnType<typeof getDb> & { close(): void };
const runtime = (process as unknown as { getBuiltinModule(name: string): { DatabaseSync: new (file: string) => Db } }).getBuiltinModule("node:sqlite");
const databases: Db[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = new runtime.DatabaseSync(":memory:"); databases.push(db);
  db.exec("CREATE TABLE chapters(id TEXT,edition_id TEXT,title TEXT,order_index INTEGER); CREATE TABLE paragraphs(id TEXT,chapter_id TEXT,text TEXT,order_index INTEGER); INSERT INTO chapters VALUES('c1','e1','导论',0),('c2','e2','其他版',0); INSERT INTO paragraphs VALUES('p1','c1','认识的前提',0),('p2','c1','认识活动',1),('p3','c1','认识的结果',2),('other','c2','认识的其他译文',0);");
  db.prepare("INSERT INTO paragraphs VALUES(?,?,?,?)").run("long", "c1", "前".repeat(15000) + "后部选文" + "后".repeat(3000), 50);
  return createBookSources(db, "e1");
}
describe("本轮书籍来源边界", () => {
  it("初始上下文只含当前段和邻段，不再塞全书前200段", () => { const repo = fixture(); const sources = repo.initial("p1"); expect(sources.map(s => s.paragraphId)).toEqual(["p1", "p2"]); expect(repo.registered.size).toBe(2); });
  it("未返回给模型的来源不能直接读", async () => { const repo = fixture(); await expect(repo.read({ sourceId: "book:e2:paragraph:other", neighbors: 1 })).rejects.toThrow("未登记"); });
  it("登记后可读取邻段，越界章节不会混入", async () => { const repo = fixture(); repo.initial("p2"); const result = await repo.read({ sourceId: "book:e1:paragraph:p2", neighbors: 2 }); expect(result).toHaveLength(3); expect(result.every(s => s.chapterId === "c1")).toBe(true); });
  it("长段后部选文保持在可引用片段中，读邻段不丢失该片段", async () => { const repo = fixture(); const initial = repo.initial("long", 15000); expect(initial[0].text).toContain("后部选文"); const expanded = await repo.read({ sourceId: initial[0].sourceId, neighbors: 0 }); expect(expanded[0].text).toBe(initial[0].text); });

});
