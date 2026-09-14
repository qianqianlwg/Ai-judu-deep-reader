import { describe, expect, it } from "vitest";
import { sourceIdForParagraph, validateCitations } from "./citation-validation";

describe("citation validation", () => {
  it("只接受属于当前版本且引用确实存在的来源", () => {
    const sourceId = sourceIdForParagraph("edition-1", "p-1");
    const result = validateCitations([
      { sourceId, paragraphId: "p-1", quote: "真实原文" },
      { sourceId: "forged", paragraphId: "p-1", quote: "真实原文" },
      { sourceId, paragraphId: "p-1", quote: "模型编造" },
    ], [{ sourceId, paragraphId: "p-1", text: "这是真实原文所在段落。" }], "message-1");
    expect(result).toEqual([{ sourceId, paragraphId: "p-1", quote: "真实原文", messageId: "message-1" }]);
  });

  it("去重并拒绝 sourceId 与 paragraphId 不一致", () => {
    const sourceId = sourceIdForParagraph("edition-1", "p-1");
    const candidate = { sourceId, paragraphId: "p-1", quote: "原文" };
    expect(validateCitations([candidate, candidate, { ...candidate, paragraphId: "p-2" }], [{ sourceId, paragraphId: "p-1", text: "原文" }], "m")).toHaveLength(1);
  });
});
