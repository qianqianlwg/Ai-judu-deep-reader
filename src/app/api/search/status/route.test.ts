import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/embedding-store", () => ({ readEmbeddingConfig: () => ({ apiKey: "fake" }) }));
vi.mock("@/lib/vector-index", () => ({ vectorIndexStatus: () => ({ chunkCount: 12, indexedChunkCount: 4, vectorIndexed: false }) }));
vi.mock("@/lib/vector-index-jobs", () => ({ createVectorIndexJobs: () => ({ status: () => ({ state: "running", error: "" }) }) }));
import { GET } from "./route";
it("离开页面后状态接口仍提供后台任务与已落库进度", async () => {
  const response = await GET(new NextRequest("http://localhost/api/search/status?editionId=e"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ indexedChunkCount: 4, configured: true, job: { state: "running" } });
});
