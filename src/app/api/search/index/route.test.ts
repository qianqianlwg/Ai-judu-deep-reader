import { it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const jobs = vi.hoisted(() => ({ start: vi.fn(() => ({ state: "running", error: "" })), pause: vi.fn(() => ({ state: "pausing", error: "" })) }));
vi.mock("@/lib/vector-index-jobs", () => ({ createVectorIndexJobs: () => jobs }));
vi.mock("@/lib/vector-index", () => ({ vectorIndexStatus: () => ({ indexedChunkCount: 8, chunkCount: 10, vectorIndexed: false }) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/embedding-store", () => ({ readEmbeddingConfig: () => ({ apiKey: "fake" }) }));
import { POST, DELETE } from "./route";
it("未确认外发不可启动后台索引", async () => {
  const response = await POST(new NextRequest("http://localhost/api/search/index", { method: "POST", body: JSON.stringify({ editionId: "e" }) }));
  expect(response.status).toBe(400); expect(jobs.start).not.toHaveBeenCalled();
});
it("确认后立即启动服务端任务，不传浏览器取消信号", async () => {
  const request = new NextRequest("http://localhost/api/search/index", { method: "POST", body: JSON.stringify({ editionId: "e", consent: true }) });
  const response = await POST(request);
  expect(response.status).toBe(200);
  expect(jobs.start).toHaveBeenCalledWith({}, "e", { apiKey: "fake" });
  expect(await response.json()).toMatchObject({ job: { state: "running" }, indexedChunkCount: 8 });
});
it("暂停接口仅传版本，不再次要求外发授权", async () => {
  const response = await DELETE(new NextRequest("http://localhost/api/search/index", { method: "DELETE", body: JSON.stringify({ editionId: "e" }) }));
  expect(response.status).toBe(200); expect(jobs.pause).toHaveBeenCalledWith({}, "e");
});
