import { afterEach, beforeEach, expect, it, vi } from "vitest";
const shared = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => shared.db }));
import { GET, POST } from "./route";
import { guideFixture } from "@/lib/guide-test-support";
let f: ReturnType<typeof guideFixture>;
beforeEach(() => { f = guideFixture(); shared.db = f.db; }); afterEach(() => f.db.close());
const context = (bookId = "b") => ({ params: Promise.resolve({ bookId }) });
const post = (body: unknown, bookId = "b") => POST(new Request("http://localhost/api/books/" + bookId + "/guide", { method: "POST", body: JSON.stringify(body) }), context(bookId));
it("读取空导读，编辑、撤销、重做经真实数据库保存", async () => {
  expect(await (await GET(new Request("http://localhost/api/books/b/guide"), context())).json()).toMatchObject({ nodes: [], version: 0 });
  const node = { id: "a", parentId: null, title: "我的理解", summary: "可以被AI修改", sourceIds: [] };
  expect(await (await post({ action: "change", version: 0, change: { type: "create", node } })).json()).toMatchObject({ nodes: [node], version: 1 });
  expect(await (await post({ action: "undo", version: 1 })).json()).toMatchObject({ nodes: [], canRedo: true });
  expect(await (await post({ action: "redo", version: 2 })).json()).toMatchObject({ nodes: [node] });
});
it("冲突、伪造来源、未知字段、跨书来源被拒绝", async () => { expect((await post({ action: "undo", version: 4 })).status).toBe(409); expect((await post({ action: "retry", version: 0, unexpected: true })).status).toBe(400); expect((await post({ action: "retry", version: 0 }, "absent")).status).toBe(404); expect((await post({ action: "change", version: 0, change: { type: "create", node: { id: "a", parentId: null, title: "伪造", summary: "", sourceIds: ["m"] } } })).status).toBe(400); });
it("历史导入幂等而且只是已句读选文，不整理整书", async () => { f.message(); expect(await (await post({ action: "import-history", version: 0 })).json()).toMatchObject({ pending: 1, historicalCount: 0 }); expect(await (await post({ action: "import-history", version: 0 })).json()).toMatchObject({ pending: 1 }); const same = await GET(new Request("http://localhost/api/books/b/guide?sourceId=m"), context()); expect(await same.json()).toMatchObject({ sources: [{ anchor: f.anchor }] }); const other = await GET(new Request("http://localhost/api/books/other/guide?sourceId=m"), context("other")); expect(await other.json()).toEqual({ sources: [] }); });
