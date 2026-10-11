import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('./runtime', () => ({ runReadingAgent: mocks.run }));
import { executeSemanticFlow, type SemanticFlowOptions } from './semantic-flow';
import { getDb } from '../db';
it('组合根仅装配同一主Agent，无独立summary/planner，完成消息不重新注入释读合集', async () => {
 mocks.run.mockImplementation(async () => ({ text: '小结', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, contextTokens: 15, contextWindow: 1000, source: 'provider' } }));
 const options: SemanticFlowOptions = { db: {} as ReturnType<typeof getDb>, editionId: 'e', config: { provider: 'openai', baseUrl: 'https://test.invalid', apiKey: 'test', model: 'test' }, settings: { maxInputTokens: 4096, maxOutputTokens: 1024, compressionStrategy: 'balanced' }, sources: [{ paragraphId: 'p', startOffset: 0, endOffset: 2, selectedText: '甲。' }], context: '资料', messages: [], detail: 'standard', difficulty: 'normal', forceRead: true, signal: new AbortController().signal, search: async () => [], publish: vi.fn(), commit: vi.fn(), emit: vi.fn(), audit: async () => undefined };
 await executeSemanticFlow(options); expect(mocks.run).toHaveBeenCalledOnce(); const input = mocks.run.mock.calls[0][0]; expect(input.semantic.tool.name).toBe('submit_reading_sentence'); expect(input.systemPrompt).toContain('同一对话'); expect(input.messages).toHaveLength(1); expect(input.messages[0].content).not.toContain('completedReadings');
});
