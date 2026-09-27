import { expect, it } from "vitest";
import { readingSystemPrompt, READING_PROMPT_VERSION } from "./prompt";
it("默认释读不附带固定分析栏目，预算约束完整可见答案和工具字段", () => {
  const prompt=readingSystemPrompt("analyze", "字".repeat(338), "standard");
  expect(prompt).toContain("目标约507字"); expect(prompt).toContain("禁止惯例性追加");
  expect(prompt).toContain("允许留空");expect(prompt).not.toContain("先输出一个标题");
  expect(prompt).toContain("保存成功后不要再输出");expect(READING_PROMPT_VERSION).toBe("v12-reading-highlights");
});
it("追問不注入句读详细程度或保存模板", () => {
  const prompt=readingSystemPrompt("chat", "字".repeat(338), "detailed");
  expect(prompt).not.toContain("详细程度");expect(prompt).not.toContain("readingText");expect(prompt).toContain("直接回答");
});

it("Agent 按需主动检索，保留不检索与隐私边界",()=>{const prompt=readingSystemPrompt("chat","","standard");for(const text of ["主动调用 search_book","additionalQueries","不检索","敏感个人信息","降级"])expect(prompt).toContain(text);});

it("两种模式尊重试查意图，保持查询简洁与证据边界", () => {
  for (const mode of ["chat", "analyze"] as const) {
    const prompt = readingSystemPrompt(mode, "选文", "standard");
    for (const text of ["已授权且可用", "具体疑点用一个查询", "不堆叠近义关键词", "本轮增益有限", "网页片段不等于全文", "不迎合用户预设结论"]) {
      expect(prompt).toContain(text);
    }
    expect(prompt).not.toContain("需要原文证据时才检索");
  }
});

it("句读正文提示少量关键词和关键句标注，追问不强制使用", () => {
  const analyze = readingSystemPrompt("analyze", "选文", "standard");
  expect(analyze).toContain("**关键词**");
  expect(analyze).toContain("*关键句正文*。");
  expect(analyze).toContain("不新增关键词/关键句清单");
  expect(readingSystemPrompt("chat", "选文", "standard")).not.toContain("**关键词**");
});
