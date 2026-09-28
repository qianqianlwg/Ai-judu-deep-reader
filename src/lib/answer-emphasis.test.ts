import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { describe, expect, it } from "vitest";
import remarkGfm from "remark-gfm";
import { inferAnswerEmphasis, readAnswerEmphasis, remarkAnswerEmphasis, validateAnswerEmphasis, type AnswerEmphasis } from "./answer-emphasis";

const sample = "关键不在于层级越高越好，而在于协调范围能否覆盖影响范围。\n\n先看影响范围，再看协调责任。";
const marks: AnswerEmphasis = { version: 1, marks: [
  { kind: "key_sentence", quote: "关键不在于层级越高越好，而在于协调范围能否覆盖影响范围。", occurrence: 1 },
  { kind: "term", quote: "影响范围", occurrence: 2 },
] };
function render(markdown: string, emphasis: AnswerEmphasis): string {
  return renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm, [remarkAnswerEmphasis, emphasis]] }, markdown));
}

describe("回答重点标注协议", () => {
  it("完整原文与合法强调分别保留，重叠词不重复标记", () => {
    const verified = validateAnswerEmphasis(sample, marks);
    expect(verified).toEqual(marks);
    const html = render(sample, verified);
    expect(html).toContain('data-answer-emphasis="key_sentence"');
    expect(html).toContain('data-answer-emphasis="term"');
    expect(html.match(/data-answer-emphasis/g)).toHaveLength(2);
    expect(html.replace(/<[^>]+>/gu, "").replace(/\s+/gu, " ").trim()).toBe(sample.replace(/\s+/gu, " ").trim());
  });
  it("无效、跨 Markdown 边界、链接和代码内的提议都不可高亮", () => {
    const text = "正常段落有外部性。\n\n[外部性](https://example.com) `外部性`\n\n**外部性**";
    const proposal = { version: 1, marks: [
      { kind: "term", quote: "外部性", occurrence: 1 },
      { kind: "term", quote: "不存在", occurrence: 1 },
      { kind: "term", quote: "外部性", occurrence: 2 },
      { kind: "term", quote: "外部性", occurrence: 3 },
    ] };
    expect(validateAnswerEmphasis(text, proposal).marks).toEqual([{ kind: "term", quote: "外部性", occurrence: 1 }]);
    expect(render(text, validateAnswerEmphasis(text, proposal)).match(/data-answer-emphasis/g)).toHaveLength(1);
  });
  it("损坏的历史数据和错误版本降级原文，而不解释任意 HTML 或 CSS", () => {
    expect(readAnswerEmphasis(sample, { version: 2, marks: marks.marks })).toBeUndefined();
    expect(readAnswerEmphasis(sample, { version: 1, marks: [{ kind: "term", quote: "影响范围", occurrence: 0, color: "red" }] })).toBeUndefined();
    expect(validateAnswerEmphasis(sample, { version: 1, marks: [] }).marks).toHaveLength(0);
    expect(render(sample, { version: 1, marks: [] })).not.toContain("data-answer-emphasis");
  });
});


it("模型没有调用标注工具时，兜底仍只标注正文中的完整句子", () => {
  const inferred = inferAnswerEmphasis("先看影响范围，再确定协调责任。\n\n协调责任不能脱离实际影响范围。\n\n`影响范围` 不应被标注。");
  expect(inferred?.marks.some(mark => mark.kind === "key_sentence")).toBe(true);
  expect(inferred?.marks.every(mark => mark.quote !== "影响范围" || mark.kind !== "term")).toBe(true);
  expect(inferred?.marks.some(mark => mark.kind === "term")).toBe(true);
});
