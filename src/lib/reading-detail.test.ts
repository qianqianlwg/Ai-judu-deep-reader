import { describe, expect, it } from "vitest";
import { isReadingTextLengthValid, normalizeReadingDetail, readingDetailPrompt, readingDetailSpec } from "./reading-detail";
describe("句读详细程度",()=>{
  it("默认标准并提供三档比例",()=>{expect(normalizeReadingDetail("unknown")).toBe("standard");expect(readingDetailSpec("concise").ratio).toBe(1.2);expect(readingDetailSpec("standard").ratio).toBe(1.5);expect(readingDetailSpec("detailed").ratio).toBe(2);});
  it("提示词明确要求正文和工具 readingText 同步控制长度",()=>{expect(readingDetailPrompt("detailed")).toContain("readingText");expect(readingDetailPrompt("detailed")).toContain("2 倍");});
  it("按非空白字符检查大致长度范围",()=>{expect(isReadingTextLengthValid("一二三四五", "一二三四五六", "concise")).toBe(true);expect(isReadingTextLengthValid("一二三四五", "一二三四五六七八九十十一十二十三十四", "standard")).toBe(false);});
});
