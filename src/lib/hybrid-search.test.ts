import { describe, expect, it } from "vitest";
import { hybridSearch, reciprocalRank, type HybridSearchCandidate } from "./hybrid-search";

const candidates: HybridSearchCandidate[] = [
  { id: "p1", text: "分工提高劳动生产力", keywordScore: 0.95, vectorSimilarity: 0.2, metadata: { bookId: "b1", chapterId: "c1" } },
  { id: "p2", text: "劳动生产力随分工增长", keywordScore: 0.7, vectorSimilarity: 0.98, metadata: { bookId: "b1", chapterId: "c1" } },
  { id: "p3", text: "交换满足需要", keywordScore: 0.2, vectorSimilarity: 0.8, metadata: { bookId: "b1", chapterId: "c2" } },
  { id: "p4", text: "其他版本的分工解释", keywordScore: 0.99, vectorSimilarity: 0.1, metadata: { bookId: "b2", chapterId: "c1" } },
];

describe("hybrid search", () => {
  it("combines keyword and vector ranks with RRF", () => {
    const results = hybridSearch(candidates, { rrfK: 0, limit: 4 });
    expect(results.map((result) => result.id)).toEqual(["p2", "p4", "p1", "p3"]);
    expect(results.find((result) => result.id === "p2")).toMatchObject({ keywordRank: 3, vectorRank: 1 });
    expect(results.find((result) => result.id === "p4")).toMatchObject({ keywordRank: 1, vectorRank: 4 });
  });

  it("filters metadata before ranking and limiting", () => {
    const results = hybridSearch(candidates, { filter: { bookId: "b1", chapterId: "c1" }, limit: 10 });
    expect(results.map((result) => result.id)).toEqual(["p2", "p1"]);
    expect(results.every((result) => result.metadata.bookId === "b1")).toBe(true);
  });

  it("supports independent weights and stable tie breaking", () => {
    const results = hybridSearch(candidates.slice(0, 3), { keywordWeight: 0, vectorWeight: 1, rrfK: 0 });
    expect(results.map((result) => result.id)).toEqual(["p2", "p3", "p1"]);
  });

  it("rejects invalid RRF and weight settings", () => {
    expect(() => reciprocalRank(0)).toThrow("RRF 排名");
    expect(() => hybridSearch(candidates, { keywordWeight: 0, vectorWeight: 0 })).toThrow("权重");
    expect(() => hybridSearch(candidates, { limit: 0 })).toThrow("正整数");
  });
});
