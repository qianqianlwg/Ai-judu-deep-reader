import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, createMiddleware, tool } from "langchain";
import { z } from "zod";
import { createToolChoiceMiddleware } from "./tool-choice-middleware";

type Step = { name?: string; text?: string; status?: number; message?: string };
function upstream(steps: Step[]) {
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const step = steps[requests.length - 1];
    if (!step) throw new Error('unexpected model request');
    if (step.status) return new Response(JSON.stringify({ error: { message: step.message ?? 'Excel supports only auto/none tool_choice', type: 'upstream_error' } }), { status: step.status, headers: { 'Content-Type': 'application/json' } });
    const delta = step.name ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call-' + requests.length, type: 'function', function: { name: step.name, arguments: JSON.stringify({ content: 'Agent明确提交', emphasis: 'none' }) } }] } : { role: 'assistant', content: step.text ?? '' };
    const frames = [{ id: 'chat-test-' + requests.length, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] },
      { id: 'chat-test-' + requests.length, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: step.name ? 'tool_calls' : 'stop' }] }];
    return new Response(frames.map(frame => 'data: ' + JSON.stringify(frame) + '\n\n').join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  }));
  return requests;
}
function fixture(choice: 'required' | 'auto' | 'none' | undefined) {
  const submit = vi.fn(async (input: { content: string; emphasis: 'none' }) => ({ ok: true, ...input }));
  const schema = z.object({ content: z.string(), emphasis: z.literal('none') });
  const submitTool = tool(submit, { name: 'submit_result', description: 'Agent提交结果和必填重点', schema });
  const onFallback = vi.fn(), abort = new AbortController();
  const policy = createMiddleware({ name: 'SubmissionPolicy', wrapModelCall: (request, handler) => {
    const complete = submit.mock.calls.length >= 2;
    return handler({ ...request, ...(choice === undefined ? {} : { toolChoice: complete ? 'none' : choice }), tools: complete ? [] : request.tools });
  } });
  const agent = createAgent({ model: new ChatOpenAI({ model: 'changed-model', apiKey: 'test-key', streaming: true, streamUsage: false, maxRetries: 0, configuration: { baseURL: 'http://gateway.test/v1' } }), tools: [submitTool], middleware: [policy, createToolChoiceMiddleware({ signal: abort.signal, onFallback })] });
  return { submit, onFallback, abort, run: async () => { for await (const event of agent.streamEvents({ messages: [{ role: 'user', content: '请提交结果' }] }, { version: 'v2', signal: abort.signal })) { void event; } } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('工具选择中间件与LangChain SDK集成', () => {
  it('明确400后只改选择策略，真实工具提交两次后none小结，不重复400', async () => {
    const requests = upstream([{ status: 400 }, { name: 'submit_result' }, { name: 'submit_result' }, { text: '最终小结。' }]);
    const { submit, onFallback, run } = fixture('required'); await run();
    expect(requests.map(request => request.tool_choice)).toEqual(['required', 'auto', 'auto', 'none']);
    expect(requests[1]).toEqual({ ...requests[0], tool_choice: 'auto' });
    expect(submit).toHaveBeenCalledTimes(2); expect(submit.mock.calls[0][0]).toEqual({ content: 'Agent明确提交', emphasis: 'none' });
    expect(onFallback).toHaveBeenCalledOnce(); expect(requests.at(-1)?.tools).toBeUndefined();
  });
  it('auto普通回复不能伪造工具提交', async () => {
    const requests = upstream([{ status: 400 }, { text: '只回复文字。' }]);
    const { submit, run } = fixture('required'); await run();
    expect(requests.map(request => request.tool_choice)).toEqual(['required', 'auto']); expect(submit).not.toHaveBeenCalled();
  });
  it.each([401, 429, 500])('上游HTTP %i不进行能力降级', async status => {
    const requests = upstream([{ status, message: 'upstream failure' }]);
    const { run, submit, onFallback } = fixture('required');
    await expect(run()).rejects.toThrow('upstream failure');
    expect(requests).toHaveLength(1); expect(submit).not.toHaveBeenCalled(); expect(onFallback).not.toHaveBeenCalled();
  });
  it.each(['auto', 'none', undefined] as const)('原策略%s不被强制修改', async choice => {
    const requests = upstream([{ text: '回复。' }]);
    const { run, onFallback } = fixture(choice); await run();
    expect(requests[0].tool_choice).toBe(choice); expect(onFallback).not.toHaveBeenCalled();
  });
  it('已取消请求不会调用上游', async () => {
    const requests = upstream([]), { abort, run } = fixture('required'); abort.abort(new Error('cancel'));
    await expect(run()).rejects.toThrow(); expect(requests).toHaveLength(0);
  });
});
