import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockSearchPostgres } = vi.hoisted(() => ({ mockSearchPostgres: vi.fn() }));
const sqliteRows = [
  { id: "p1", chapterId: "c1", chapterTitle: "第一章", text: "分工提高劳动生产力", paragraphIndex: 0 },
  { id: "p2", chapterId: "c1", chapterTitle: "第一章", text: "交换满足需要", paragraphIndex: 1 },
];

vi.mock("@/lib/postgres-search-client", () => ({ searchPostgres: mockSearchPostgres }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ prepare: () => ({ all: () => sqliteRows }) }),
}));

import { GET } from "./route";

describe("/api/search contract", () => {
  beforeEach(() => {
    mockSearchPostgres.mockReset();
    delete process.env.DATABASE_URL;
  });

  it("returns SQLite fallback results and applies chapter scope", async () => {
    const response = await GET(new NextRequest("http://localhost/api/search?q=劳动&editionId=e1&chapterId=c1"));
    expect(response.status).toBe(200);
    expect((await response.json()).results[0].paragraphId).toBe("p1");
    expect(mockSearchPostgres).not.toHaveBeenCalled();
  });

  it("uses PostgreSQL branch with embedding and metadata filters", async () => {
    process.env.DATABASE_URL = "postgres://test";
    mockSearchPostgres.mockResolvedValue([{ paragraphId: "p9", chapterId: "c2", chapterTitle: "第二章", text: "向量命中", keywordScore: 0, vectorSimilarity: 0.9, rrfScore: 0.02 }]);
    const response = await GET(new NextRequest("http://localhost/api/search?q=劳动&editionId=e1&chapterId=c2&sourceType=book&embedding=%5B0.1%2C0.2%5D"));
    expect(response.status).toBe(200);
    expect(mockSearchPostgres).toHaveBeenCalledWith({ query: "劳动", editionId: "e1", chapterId: "c2", sourceType: "book", limit: 20, embedding: [0.1, 0.2] });
    expect((await response.json()).results[0].paragraphId).toBe("p9");
  });

  it("falls back to SQLite when PostgreSQL is unavailable", async () => {
    process.env.DATABASE_URL = "postgres://test";
    mockSearchPostgres.mockRejectedValue(new Error("connection refused"));
    const response = await GET(new NextRequest("http://localhost/api/search?q=劳动&editionId=e1"));
    expect(response.status).toBe(200);
    expect((await response.json()).results[0].paragraphId).toBe("p1");
  });

  it("returns 400 for malformed embedding instead of silently falling back", async () => {
    const response = await GET(new NextRequest("http://localhost/api/search?q=劳动&editionId=e1&embedding=not-json"));
    expect(response.status).toBe(400);
    expect(mockSearchPostgres).not.toHaveBeenCalled();
  });
});
