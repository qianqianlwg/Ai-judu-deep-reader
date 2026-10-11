import { expect, it, vi } from 'vitest';
import { createSemanticSession, SENTENCE_EXAMPLE, SENTENCE_DESCRIPTION } from './semantic-session';
import { semanticSubmissionSchema } from '../semantic-submission';
const source = { paragraphId: 'p', startOffset: 0, endOffset: 7, selectedText: '劳动形成价值。' };
it('工具示例有效，单句提交实时发布并可恢复已完成前缀', async () => {
  const publish = vi.fn(), commit = vi.fn(); const session = createSemanticSession({ sources: [source], publish, commit });
  expect(semanticSubmissionSchema.safeParse(SENTENCE_EXAMPLE).success).toBe(true); expect(SENTENCE_DESCRIPTION).toContain('示例');
  session.startSentence(); await session.tool.invoke(SENTENCE_EXAMPLE); expect(session.complete).toBe(true); expect(commit).toHaveBeenCalledOnce();
  const resumed = createSemanticSession({ sources: [source], previous: session.state, publish, commit }); expect(resumed.complete).toBe(true); expect(resumed.state.units).toHaveLength(1);
});
it('数据库异常上抛不生成成功结果', async () => { const session = createSemanticSession({ sources: [source], publish: vi.fn(), commit: () => { throw new Error('数据库失败'); } }); await expect(session.tool.invoke(SENTENCE_EXAMPLE)).rejects.toThrow('数据库失败'); expect(session.state.units).toEqual([]); });
it('精准字段反馈三次失败，不补必填字段', () => { const session = createSemanticSession({ sources: [source], publish: vi.fn(), commit: vi.fn() }); const parsed = semanticSubmissionSchema.safeParse({ ...SENTENCE_EXAMPLE, answerEmphasis: undefined }); if (parsed.success) throw new Error('应该失败'); expect(session.invalidArguments(parsed.error).error).toContain('answerEmphasis'); session.invalidArguments(parsed.error); expect(() => session.invalidArguments(parsed.error)).toThrow('三次'); });
