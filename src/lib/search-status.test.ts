import { describe, expect, it } from "vitest";
import { buildSearchIndexStatus } from "./search-status";
describe("search index status", () => {
  it("reports vector coverage", () => { expect(buildSearchIndexStatus({ backend: "postgres", editionId: "e1", paragraphCount: 10, indexedCount: 10, note: "ok" }).vectorIndexed).toBe(true); });
  it("does not claim vector indexing for SQLite", () => { expect(buildSearchIndexStatus({ backend: "sqlite", editionId: "e1", paragraphCount: 10, indexedCount: 0, note: "fallback" }).vectorIndexed).toBe(false); });
});
