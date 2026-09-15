import { describe, expect, it } from "vitest";
import { countReadingCharacters, isReadingTextLengthValid, normalizeReadingDetail, readingAnswerBudget, readingDetailPrompt, readingSelectionError } from "./reading-detail";
describe("句读详细程度与完整正文预算", () => {
  it("338字标准目标507字；1500字正文不能伪装成合格句读", () => {
    const source = "原".repeat(338); expect(readingAnswerBudget(source, "standard")).toMatchObject({ sourceCharacters: 338, targetCharacters: 507, maxCharacters: 609 });
    expect(isReadingTextLengthValid(source, "释".repeat(507), "standard")).toBe(true);
    expect(isReadingTextLengthValid(source, "释".repeat(1500), "standard")).toBe(false);
  });
  it("三档与无效配置默认标准；不强迫模型凑字", () => {
    expect(normalizeReadingDetail("bad")).toBe("standard");
    expect(["concise", "standard", "detailed"].map(detail => readingAnswerBudget("字".repeat(100), detail).targetCharacters)).toEqual([120,150,200]);
    expect(readingDetailPrompt("standard", "原".repeat(338))).toContain("全部段落");
  });
  it("统一Unicode计数并明确拒绝9和1001，允许10和1000", () => {
    expect(countReadingCharacters(" a😀中 ")).toBe(3);
    expect(readingSelectionError("字".repeat(9))).toContain("9字");
    expect(readingSelectionError("字".repeat(10))).toBeNull();
    expect(readingSelectionError("字".repeat(1000))).toBeNull();
    expect(readingSelectionError("字".repeat(1001))).toContain("1001字");
  });
});
