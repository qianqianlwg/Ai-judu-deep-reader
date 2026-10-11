import { expect, it } from 'vitest';
import { readingSystemPrompt, READING_PROMPT_VERSION } from './prompt';
it('同一主Agent包含长度、解读方式、逐句与最后小结规则', () => {
  const prompt = readingSystemPrompt('analyze', '字'.repeat(338), 'standard', 'normal');
  expect(prompt).toContain('80%–110%'); expect(prompt).toContain('一至三段'); expect(prompt).toContain('allCovered=true');
  expect(prompt).toContain('submit_reading_sentence'); expect(prompt).not.toContain('save_reading_analysis'); expect(prompt).not.toContain('occurrence');
  expect(READING_PROMPT_VERSION).toBe('v18-unified-reader-protocol');
});
it('追问不按原文字数机械计算，有标注示例与明确none', () => { const prompt = readingSystemPrompt('chat', '选文', 'expanded', 'advanced'); expect(prompt).toContain('概念边界'); expect(prompt).toContain('当前回复长度：展开'); expect(prompt).toContain('mark_answer_emphasis'); expect(prompt).toContain('示例'); expect(prompt).toContain('none'); expect(prompt).not.toContain('回答目标约'); });
it.each(['analyze', 'chat'] as const)('%s保持检索、来源、隐私和不伪造重点的边界', mode => {
  const prompt = readingSystemPrompt(mode, '选文', 'standard');
  for (const text of ['主动调用 search_book','additionalQueries','敏感个人信息','降级','不检索','资料','不迎合用户预设结论','16项','1000字符','不省略或传空数组','不会替你生成或补重点']) expect(prompt).toContain(text);
});
