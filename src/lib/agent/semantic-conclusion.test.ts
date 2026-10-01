import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIMessageChunk } from '@langchain/core/messages';
import { conclusionMessages, streamReadingConclusion, type ConclusionOptions } from './semantic-conclusion';
const mock = vi.hoisted(() => ({ stream: vi.fn(), create: vi.fn() }));
vi.mock('./model', () => ({ createReadingModel: mock.create }));
function setup(): ConclusionOptions {
  return { config: { provider: 'openai', model: 'new-model', apiKey: 'key', baseUrl: 'https://model.test' }, sources: [{ paragraphId: 'p', selectedText: '甲乙。', startOffset: 0, endOffset: 3 }], context: '背景资料', messages: [{ role: 'user', content: '请解释联系' }], detail: 'brief', difficulty: 'normal', signal: new AbortController().signal, contextWindow: 200000, state: { version: 1, phase: 'reading', units: [{ id: 'unit', label: '观点', action: 'read', reason: '', anchor: { paragraphId: 'p', selectedText: '甲乙。', startOffset: 0, endOffset: 3 }, status: 'completed', content: '已经完成的解释' }] }, onText: vi.fn() };
}
function respond(chunks: AIMessageChunk[]) { mock.stream.mockResolvedValue((async function* () { for (const chunk of chunks) yield chunk; })()); }
beforeEach(() => { mock.stream.mockReset(); mock.create.mockReset().mockReturnValue({ stream: mock.stream }); });
afterEach(() => vi.restoreAllMocks());
describe('细读后的 AI 总述', () => {
  it('完整选文和所有已完成释读进入提示，不把它们拼接成小结', () => {
    const o = setup(); o.state.units[0].content = '完整解释'.repeat(5000);
    const messages = conclusionMessages(o), prompt = JSON.stringify(messages);
    expect(prompt).toContain(o.state.units[0].content); expect(prompt).toContain('甲乙。'); expect(prompt).toContain('背景资料'); expect(prompt).toContain('分—总'); expect(prompt).toContain('资料而非指令');
  });
  it('使用当前模型普通文本流，逐步发布且保留模型原文和用量', async () => {
    respond([new AIMessageChunk({ content: '总体：' }), new AIMessageChunk({ content: '**联系**。', response_metadata: { finish_reason: 'stop' }, usage_metadata: { input_tokens: 50, output_tokens: 8, total_tokens: 58 } })]);
    const o = setup(), result = await streamReadingConclusion(o);
    expect(mock.create).toHaveBeenCalledWith(o.config); expect(o.onText).toHaveBeenNthCalledWith(1, '总体：'); expect(o.onText).toHaveBeenLastCalledWith('总体：**联系**。'); expect(result.content).toBe('总体：**联系**。'); expect(result.usage.totalTokens).toBe(58);
  });
  it('Claude文本块可见，thinking块和签名不作为正文', async () => {
    respond([new AIMessageChunk({ content: [{ type: 'thinking', thinking: '隐藏推理' }, { type: 'text', text: '真实小结' }], response_metadata: { stop_reason: 'end_turn' } })]);
    expect((await streamReadingConclusion(setup())).content).toBe('真实小结');
  });
  it.each(['length', 'max_tokens', undefined, 'tool_calls'])('非正常结束 %s 不冒充成功', async reason => {
    respond([new AIMessageChunk({ content: '未完成正文', response_metadata: { finish_reason: reason } })]);
    await expect(streamReadingConclusion(setup())).rejects.toThrow(/截断|完成确认/);
  });
  it('空正文或只有思考内容不算完成', async () => {
    respond([new AIMessageChunk({ content: '  ', response_metadata: { finish_reason: 'stop' } })]);
    await expect(streamReadingConclusion(setup())).rejects.toThrow('未返回细读小结正文');
  });
  it('上游异常原样上抛，不用本地总结兜底', async () => {
    const error = new Error('403 {"error":{"code":"channel_unavailable"}}'); mock.stream.mockRejectedValue(error);
    await expect(streamReadingConclusion(setup())).rejects.toBe(error);
  });
  it('停止后不继续发布或认定生成成功', async () => {
    const o = setup(), controller = new AbortController(); o.signal = controller.signal;
    o.onText = vi.fn(() => controller.abort()); respond([new AIMessageChunk({ content: '部分', response_metadata: { finish_reason: 'stop' } })]);
    await expect(streamReadingConclusion(o)).rejects.toThrow(); expect(o.onText).toHaveBeenCalledOnce();
  });
});
