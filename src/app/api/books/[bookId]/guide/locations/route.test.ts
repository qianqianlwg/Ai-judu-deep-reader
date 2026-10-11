import { beforeEach, afterEach, expect, it, vi } from "vitest";
const shared = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => shared.db }));
import { GET } from "./route";
import { guideFixture } from "@/lib/guide-test-support";
import { enqueueGuideSource } from "@/lib/guide-sources";
import { saveGuideRevision } from "@/lib/guide-store";
let f: ReturnType<typeof guideFixture>;
beforeEach(() => { f = guideFixture(); f.db.exec("ALTER TABLE editions ADD COLUMN file_name TEXT NOT NULL DEFAULT '原书.txt'"); shared.db = f.db; });
afterEach(() => f.db.close());
const get = (bookId = "b", query = "") => GET(new Request("http://localhost/api/books/" + bookId + "/guide/locations" + query), { params: Promise.resolve({ bookId }) });
it("位置接口返回版本和核对过的只读元数据，不泄露分析正文", async () => {
  f.message(); enqueueGuideSource(f.db, "m");
  saveGuideRevision(f.db, "b", 0, [{ id: "a", parentId: null, title: "主题", summary: "", sourceIds: ["m"] }], "user", "测试");
  const response = await get(), body = await response.json();
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(body).toMatchObject({ bookId: "b", version: 1, sources: [{ sourceId: "m", spans: [{ chapterTitle: "第一章" }] }] });
  expect(JSON.stringify(body)).not.toContain("已完成句读");
});
it("未知书籍、未知查询参数和跨书来源均不能读取位置", async () => {
  expect((await get("absent")).status).toBe(404);
  expect((await get("b", "?sourceId=m")).status).toBe(400);
  f.message(); enqueueGuideSource(f.db, "m");
  expect(await (await get("other")).json()).toMatchObject({ bookId: "other", sources: [] });
});
