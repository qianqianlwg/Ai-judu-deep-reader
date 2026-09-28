import { expect, it } from "vitest";
import { readingSystemPrompt, READING_PROMPT_VERSION } from "./prompt";
it("默认释读不附带固定分析栏目，预算约束完整可见答案和工具字段", () => {
  const prompt=readingSystemPrompt("analyze", "字".repeat(338), "standard");
  expect(prompt).toContain("目标约338字"); expect(prompt).toContain("禁止惯例性追加");
  expect(prompt).toContain("允许留空");expect(prompt).not.toContain("先输出一个标题");
  expect(prompt).toContain("保存成功后不要再输出");expect(READING_PROMPT_VERSION).toBe("v15-verified-emphasis");
});
it("追問不注入句读详细程度或保存模板", () => {
  const prompt=readingSystemPrompt("chat", "字".repeat(338), "detailed");
  expect(prompt).not.toContain("详细程度");expect(prompt).not.toContain("readingText");expect(prompt).toContain("直接回答");
});


it("强调提示只传语义不把标记符号写进可见正文", () => { const prompt=readingSystemPrompt("analyze", "选文", "standard"); expect(prompt).toContain("emphasis"); expect(prompt).toContain("不要输出 #关键词#"); expect(prompt).toContain("逐字存在"); const follow=readingSystemPrompt("chat", "", "standard"); expect(follow).toContain("mark_answer_emphasis"); });

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

it("方式贯通句读和追问，追问只沿用长度倾向", () => {
  expect(readingSystemPrompt("analyze", "字".repeat(1000), "gist", "accessible")).toContain("回答目标约200字");
  expect(readingSystemPrompt("analyze", "字".repeat(1000), "gist", "accessible")).toContain("面向初学者");
  const chat = readingSystemPrompt("chat", "字".repeat(1000), "expanded", "advanced");
  expect(chat).toContain("概念边界"); expect(chat).toContain("当前回复长度：展开");
  expect(chat).not.toContain("回答目标约");
});

it("句读与追问都采用本地元数据方案，不要求 Markdown 符号作为高亮协议", () => {
  for (const mode of ["analyze", "chat"] as const) {
    const prompt = readingSystemPrompt(mode, "选文", "standard");
    expect(prompt).toContain("逐字");
    expect(prompt).not.toContain("**关键词**");
    expect(prompt).not.toContain("*关键句正文*");
    expect(prompt).toContain(mode === "analyze" ? "emphasis" : "mark_answer_emphasis");
  }
});
