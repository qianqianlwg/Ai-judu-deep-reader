import { describe, expect, it } from "vitest";
import { countReadingCharacters, normalizeReadingDetail, readingAnswerBudget, readingDetailPrompt, readingSelectionError } from "./reading-detail";
describe("句读详细程度与完整正文预算", () => {
  it("338字正常目标338字但无字数硬上限", () => {
    const source = "原".repeat(338); expect(readingAnswerBudget(source, "standard")).toMatchObject({ sourceCharacters: 338, targetCharacters: 338 });
    expect(readingAnswerBudget(source, "standard")).not.toHaveProperty("maxCharacters");
    expect(readingDetailPrompt("standard", source)).toContain("不作为中断生成或拒绝保存的硬上限");
  });
  it("五档与无效配置默认正常；不强迫模型凑字", () => {
    expect(normalizeReadingDetail("bad")).toBe("standard");
    expect(["gist", "concise", "standard", "detailed", "expanded"].map(detail => readingAnswerBudget("字".repeat(1000), detail).targetCharacters)).toEqual([200,500,1000,1500,2000]);
    expect(readingDetailPrompt("standard", "原".repeat(338))).toContain("完整回答");
  });
  it("统一Unicode计数并明确拒绝9和3001，允许10和3000", () => {
    expect(countReadingCharacters(" a😀中 ")).toBe(3);
    expect(readingSelectionError("字".repeat(9))).toContain("9字符");
    expect(readingSelectionError("字".repeat(10))).toBeNull();
    expect(readingSelectionError("字".repeat(3000))).toBeNull();
    expect(readingSelectionError("字".repeat(3001))).toContain("3001字符");
  });
});
