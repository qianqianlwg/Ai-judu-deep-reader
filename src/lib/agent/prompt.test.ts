import { expect, it } from "vitest";
import { readingSystemPrompt, READING_PROMPT_VERSION } from "./prompt";
it("默认释读不附带固定分析栏目，预算约束完整可见答案和工具字段", () => {
  const prompt=readingSystemPrompt("analyze", "字".repeat(338), "standard");
  expect(prompt).toContain("目标约507字"); expect(prompt).toContain("禁止惯例性追加");
  expect(prompt).toContain("允许留空");expect(prompt).not.toContain("先输出一个标题");
  expect(prompt).toContain("保存成功后不要再输出");expect(READING_PROMPT_VERSION).toBe("v10-parallel-retrieval");
});
it("追問不注入句读详细程度或保存模板", () => {
  const prompt=readingSystemPrompt("chat", "字".repeat(338), "detailed");
  expect(prompt).not.toContain("详细程度");expect(prompt).not.toContain("readingText");expect(prompt).toContain("直接回答");
});


it("强调提示只传语义不把标记符号写进可见正文", () => { const prompt=readingSystemPrompt("analyze", "选文", "standard"); expect(prompt).toContain("emphasis"); expect(prompt).toContain("不要输出 #关键词#"); expect(prompt).toContain("逐字存在"); const follow=readingSystemPrompt("chat", "", "standard"); expect(follow).toContain("mark_answer_emphasis"); });

it("Agent 按需主动检索，保留不检索与隐私边界",()=>{const prompt=readingSystemPrompt("chat","","standard");for(const text of ["主动调用 search_book","additionalQueries","不检索","敏感个人信息","降级"])expect(prompt).toContain(text);});
