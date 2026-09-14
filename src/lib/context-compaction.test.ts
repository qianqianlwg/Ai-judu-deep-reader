import { describe, expect, it } from "vitest";
import { compactContext, estimateTokens, validateCompactedContext } from "./context-compaction";

describe("context compaction", () => {
  it("does not compact within the budget", () => {
    const result = compactContext([{ role: "user", content: "??", id: "m1" }]);
    expect(result.compacted).toBe(false);
    expect(result.messages).toHaveLength(1);
    expect(result.sourceMessageIds).toEqual(["m1"]);
    expect(result.version).toBe(0);
  });
  it("creates structured state and a source id chain when compacting", () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({ role: (index % 2 ? "assistant" : "user") as "user" | "assistant", content: index % 2 ? `conclusion ${index} `.repeat(1000) : `must preserve paragraphId=p${index} evidence `.repeat(1000), id: `m${index}` }));
    const result = compactContext(messages, { maxInputTokens: 4096, maxOutputTokens: 1024, compressionStrategy: "balanced" });
    expect(result.compacted).toBe(true);
    expect(result.summary).toContain("structured context state");
    expect(result.state.constraints.length).toBeGreaterThan(0);
    expect(result.sourceMessageIds.every((id) => id.startsWith("m"))).toBe(true);
    expect(result.version).toBe(1);
    expect(result.previousVersion).toBeNull();
    expect(validateCompactedContext(result)).toBe(true);
  });
  it("chains versions without claiming an external compaction API", () => {
    const messages = [{ role: "user" as const, content: "must preserve decision ".repeat(500), id: "m1" }, { role: "assistant" as const, content: "conclusion: continue", id: "m2" }];
    const first = compactContext(messages, { maxInputTokens: 10, maxOutputTokens: 10, compressionStrategy: "balanced" });
    const second = compactContext([...messages, { role: "user", content: "conclusion: continue??", id: "m3" }], { maxInputTokens: 10, maxOutputTokens: 10, compressionStrategy: "balanced" }, "", first);
    expect(second.version).toBe(2);
    expect(second.previousVersion).toBe(1);
    expect(second.checksum).not.toBe(first.checksum);
  });
  it("estimates empty input safely", () => { expect(estimateTokens("")).toBe(1); });
  it("rejects malformed snapshots", () => { expect(validateCompactedContext({ summary: "x" })).toBe(false); });
});
