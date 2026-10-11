import { z } from 'zod';
import { EMPTY_ANSWER_EMPHASIS, readAnswerEmphasis, type AnswerEmphasis } from './answer-emphasis';
export const MAX_ANSWER_MARKS_PER_KIND = 16;
export const MAX_ANSWER_MARK_CHARACTERS = 1000;
const quotes = z.union([z.literal('none'), z.array(z.string().min(1).max(MAX_ANSWER_MARK_CHARACTERS)).min(1).max(MAX_ANSWER_MARKS_PER_KIND)]);
export const answerEmphasisProtocolSchema = z.object({ keywords: quotes, keySentences: quotes }).strict();
export type AnswerEmphasisProtocol = z.infer<typeof answerEmphasisProtocolSchema>;
export function resolveAnswerEmphasis(markdown: string, value: unknown): AnswerEmphasis {
  const input = answerEmphasisProtocolSchema.parse(value);
  const result: AnswerEmphasis = { version: 1, marks: [] };
  for (const field of ['keywords', 'keySentences'] as const) {
    const values = input[field]; if (values === 'none') continue;
    for (const [index, quote] of values.entries()) {
      // WHY：出现位置由服务端按首次逐字匹配确定；旧存储结构只用于兼容历史，不再要求模型提供 occurrence 或 kind。
      result.marks.push({ kind: field === 'keywords' ? 'term' : 'key_sentence', quote, occurrence: 1 });
      const verified = readAnswerEmphasis(markdown, result);
      if (!verified || verified.marks.length !== result.marks.length) throw new Error('answerEmphasis.' + field + '[' + index + ']：未逐字匹配可标注正文或标注范围重叠；请修正原句，没有重点填 none。');
    }
  }
  return result.marks.length ? result : EMPTY_ANSWER_EMPHASIS;
}
