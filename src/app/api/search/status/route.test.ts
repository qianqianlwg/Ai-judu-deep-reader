import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { mockStatus } = vi.hoisted(() => ({ mockStatus: vi.fn() }));
vi.mock("@/lib/postgres-search-client", () => ({ getPostgresSearchIndexStatus: mockStatus }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ prepare: () => ({ get: () => ({ paragraphCount: 12 }) }) }) }));
import { GET } from "./route";
describe("/api/search/status", () => {
  it("reports SQLite status without claiming vector index", async () => { delete process.env.DATABASE_URL; const response = await GET(new NextRequest("http://localhost/api/search/status?editionId=e1")); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ backend: "sqlite", paragraphCount: 12, indexedCount: 0, vectorIndexed: false }); });
  it("reports actual PostgreSQL vector coverage", async () => { process.env.DATABASE_URL = "postgres://test"; mockStatus.mockResolvedValue({ paragraphCount: 12, indexedCount: 9 }); const response = await GET(new NextRequest("http://localhost/api/search/status?editionId=e1")); expect(await response.json()).toMatchObject({ backend: "postgres", paragraphCount: 12, indexedCount: 9, vectorIndexed: true }); delete process.env.DATABASE_URL; });
});
