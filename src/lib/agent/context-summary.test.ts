import { afterEach, expect, it, vi } from 'vitest';
import { createContextSummarizer } from './context-summary';
import { emptyMemory } from '../context-memory';
const memory = { ...emptyMemory(), task: '理解价值形式', constraints: ['只用中文解释'], conclusions: ['劳动形成价值'] };
const input = { previous: emptyMemory(), messages: [{ role: 'user' as const, content: '请保留中文约定' }], targetTokens: 512, inputBudgetTokens: 4096, outputBudgetTokens: 1024 };
afterEach(() => vi.unstubAllGlobals());
it.each(['openai', 'claude'] as const)('%s直接API返回完整JSON，不绑定压缩tool或创建Agent', async provider => {
 const fetcher = vi.fn<typeof fetch>(async () => Response.json(provider === 'openai' ? { choices: [{ message: { content: JSON.stringify(memory) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 30 } } : { content: [{ type: 'text', text: JSON.stringify(memory) }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 30 } })); vi.stubGlobal('fetch', fetcher);
 const onUsage = vi.fn(); const summarize = createContextSummarizer({ provider, baseUrl: 'https://provider.test/v1', apiKey: 'test-only', model: 'test' }, onUsage);
 expect(await summarize(input)).toEqual(memory); const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body)); expect(request.stream).toBe(false); expect(request.tools).toBeUndefined();
 if (provider === 'openai') expect(request.max_tokens).toBeUndefined(); expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ totalTokens: 130, source: 'provider' }));
});
it.each(['length', 'invalid-json', 'missing-field', 'fake-source'])('压缩%s失败保留旧记忆，不修补响应', async failure => {
 const content = failure === 'invalid-json' ? '{"task":' : JSON.stringify(failure === 'missing-field' ? { task: '缺字段' } : failure === 'fake-source' ? { ...memory, evidence: ['book:e:paragraph:fake'] } : memory);
 vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content }, finish_reason: failure === 'length' ? 'length' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 30 } })));
 const onUsage = vi.fn(); const summarize = createContextSummarizer({ provider: 'openai', baseUrl: 'https://provider.test/v1', apiKey: 'test', model: 'test' }, onUsage);
 await expect(summarize(input)).rejects.toThrow(); expect(input.previous).toEqual(emptyMemory()); expect(onUsage).toHaveBeenCalledOnce();
});
it('已知历史来源可保留，取消不发送API', async () => { const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ ...memory, evidence: ['book:e:paragraph:p1'] }) }, finish_reason: 'stop' }] })); vi.stubGlobal('fetch', fetcher); const summarize = createContextSummarizer({ provider: 'openai', baseUrl: 'https://provider.test/v1', apiKey: 'test', model: 'test' }); const result = await summarize({ ...input, messages: [{ role: 'user', content: 'book:e:paragraph:p1' }] }); expect(result.evidence).toEqual(['book:e:paragraph:p1']); const abort = new AbortController(); abort.abort(); await expect(summarize({ ...input, signal: abort.signal })).rejects.toThrow(); expect(fetcher).toHaveBeenCalledOnce(); });
