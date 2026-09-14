import { describe, expect, it } from "vitest";
import { buildPostgresSearchQuery } from "./postgres-search";

describe("PostgreSQL hybrid search", () => {
  it("uses tsvector candidates and RRF without vector", () => {
    const query = buildPostgresSearchQuery({ query: "劳动", editionId: "e1", limit: 10 });
    expect(query.text).toContain("search_document @@ plainto_tsquery");
    expect(query.text).toContain("rrfScore");
    expect(query.text).toContain("row_number() OVER");
    expect(query.values).toEqual(["劳动", "e1", 50, 60, 10]);
  });

  it("merges keyword and pgvector candidates with metadata filters", () => {
    const query = buildPostgresSearchQuery({ query: "劳动", editionId: "e1", chapterId: "c2", sourceType: "book", limit: 5, embedding: [0.1, 0.2] });
    expect(query.text).toContain("FULL OUTER JOIN");
    expect(query.text).toContain("<=>");
    expect(query.text).toContain('p.chapter_id = $3');
    expect(query.text).toContain('p.source_type = $4');
    expect(query.values).toEqual(["劳动", "e1", "c2", "book", 25, "[0.1,0.2]", "e1", "c2", "book", 25, 60, 5]);
  });

  it("rejects invalid embeddings", () => {
    expect(() => buildPostgresSearchQuery({ query: "x", editionId: "e1", limit: 1, embedding: [Number.NaN] })).toThrow("有限数字");
  });
});
