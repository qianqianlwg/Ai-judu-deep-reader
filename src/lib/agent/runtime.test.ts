import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadingAgentError, readingAgentFailure, runReadingAgent } from "./runtime";
import type { ReadingToolDependencies } from "./tools";
import type { ChatEvent } from "../chat-stream";
import type { ProviderConfig } from "../ai-provider";

type Step = { name?: string; args?: unknown; text?: string[]; finish?: string; interrupted?: boolean };
const closeServers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closeServers.splice(0)) await close(); });
async function mockProvider(provider: "openai" | "claude", steps: Step[]) {
  const requests: { url: string; body: Record<string, unknown>; auth?: string }[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      let raw = "";
      for await (const chunk of request) raw += String(chunk);
      requests.push({ url: request.url ?? "", body: JSON.parse(raw) as Record<string, unknown>, auth: String(request.headers.authorization ?? request.headers["x-api-key"]) });
      const step = steps[requests.length - 1];
      if (!step) { response.writeHead(500).end("unexpected model step"); return; }
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const send = (payload: unknown, event?: string) => response.write((event ? "event: " + event + "\n" : "") + "data: " + JSON.stringify(payload) + "\n\n");
      if (provider === "openai") {
        const chunk = (delta: unknown, finish_reason: string | null = null) => send({ id: "chat-" + requests.length, object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta, finish_reason }] });
        chunk({ role: "assistant", content: "" });
        for (const text of step.text ?? []) { chunk({ content: text }); await new Promise(resolve => setTimeout(resolve, 8)); }
        if (step.name) chunk({ tool_calls: [{ index: 0, id: "call-" + requests.length, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }] });
        if (!step.interrupted) {
          chunk({}, step.finish ?? (step.name ? "tool_calls" : "stop"));
          send({ id: "chat-" + requests.length, choices: [], usage: { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140, prompt_tokens_details: { cached_tokens: 60 } } });
          response.write("data: [DONE]\n\n");
        }
      } else {
        send({ type: "message_start", message: { id: "msg-" + requests.length, type: "message", role: "assistant", content: [], model: "test-model", stop_reason: null, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 0 } } }, "message_start");
        if (step.name) {
          if (step.text?.length) {
            send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, 'content_block_start');
            for (const text of step.text) send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, 'content_block_delta');
            send({ type: 'content_block_stop', index: 0 }, 'content_block_stop');
          }
          send({ type: "content_block_start", index: step.text?.length ? 1 : 0, content_block: { type: "tool_use", id: "call-" + requests.length, name: step.name, input: {} } }, "content_block_start");
          send({ type: "content_block_delta", index: step.text?.length ? 1 : 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(step.args) } }, "content_block_delta");
        } else {
          send({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, "content_block_start");
          for (const text of step.text ?? []) { send({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }, "content_block_delta"); await new Promise(resolve => setTimeout(resolve, 8)); }
        }
        send({ type: "content_block_stop", index: step.name && step.text?.length ? 1 : 0 }, "content_block_stop");
        if (!step.interrupted) {
          send({ type: "message_delta", delta: { stop_reason: step.finish ?? (step.name ? "tool_use" : "end_turn"), stop_sequence: null }, usage: { output_tokens: 20 } }, "message_delta");
          send({ type: "message_stop" }, "message_stop");
        }
      }
      response.end();
    })().catch(error => { response.writeHead(500).end(String(error)); });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  closeServers.push(() => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("missing test address");
  return { requests, config: { provider, baseUrl: "http://127.0.0.1:" + address.port + (provider === "openai" ? "/v1" : "/v1"), apiKey: "test-key", model: "test-model" } satisfies ProviderConfig };
}

import { createSemanticSession, SENTENCE_TOOL } from './semantic-session';
import type { SemanticReading } from '../semantic-reading';
const none = { answerEmphasis: { keywords: 'none', keySentences: 'none' } };
function fixture() {
  const events: ChatEvent[] = [];
  const tools: ReadingToolDependencies = { messageId: 'assistant', selectedText: '', sources: new Map(), search: vi.fn(async () => []), read: vi.fn(async () => []), save: vi.fn(async () => undefined), saveEmphasis: vi.fn(async () => undefined) };
  return { events, tools, audit: vi.fn(async () => undefined), emit: (event: ChatEvent) => { events.push(event); }, signal: new AbortController().signal, systemPrompt: '按原文解释，通过工具提交结果和标注', messages: [{ role: 'user' as const, content: '请解释' }], maxOutputTokens: 2048, contextWindow: 32768 };
}
const sentence = (source: string) => ({ sourceStart: Array.from(source).slice(0, 8).join(''), sourceEnd: Array.from(source).slice(-8).join(''), title: '价值关系', content: source, sourceAnnotations: { keywords: 'none', keySentences: 'none', concepts: 'none' }, ...none });
function semanticFixture() {
  const f = fixture(), states: SemanticReading[] = [], commit = vi.fn();
  const source = '劳动形成价值。价值通过关系表现。';
  const session = createSemanticSession({ sources: [{ paragraphId: 'p', startOffset: 0, endOffset: source.length, selectedText: source }], publish: state => states.push(state), commit });
  return { f, session, states, commit };
}
describe('同一主Agent的双协议HTTP闭环', () => {
  it.each(['openai', 'claude'] as const)('%s 普通追问正文后提交统一标注，不绑定旧保存或规划工具', async provider => {
    const { config, requests } = await mockProvider(provider, [{ text: ['劳动形成价值。'], name: 'mark_answer_emphasis', args: { answerEmphasis: { keywords: ['劳动'], keySentences: 'none' } } }]);
    const f = fixture(), result = await runReadingAgent({ ...f, config });
    expect(result.text).toBe('劳动形成价值。'); expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(provider === 'openai' ? '/v1/chat/completions' : '/v1/messages');
    expect(JSON.stringify(requests[0].body.tools)).not.toMatch(/save_reading_analysis|plan_reading_units|compress_reading_context/);
    expect(f.tools.saveEmphasis).toHaveBeenCalledOnce(); expect(f.tools.save).not.toHaveBeenCalled();
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ name: 'mark_answer_emphasis', status: 'completed' }));
    expect(requests[0].body).not.toHaveProperty('response_format');
    if (provider === 'openai') expect(requests[0].body).not.toHaveProperty('max_tokens');
    expect(result.usage.source).toBe('provider');
  });
  it.each(['openai', 'claude'] as const)('%s 连续工具后直接小结，保持首句和成功回执，不另起Agent', async provider => {
    const { config, requests } = await mockProvider(provider, [{ name: SENTENCE_TOOL, args: sentence('劳动形成价值。') }, { name: SENTENCE_TOOL, args: sentence('价值通过关系表现。') }, { text: ['价值的形成与表现，', '分别涉及劳动和关系。'] }]);
    const { f, session, states, commit } = semanticFixture();
    const result = await runReadingAgent({ ...f, semantic: session, config });
    expect(commit).toHaveBeenCalledTimes(2); expect(session.state.phase).toBe('completed');
    expect(session.state.conclusion?.content).toBe(result.text); expect(requests).toHaveLength(3);
    const last = JSON.stringify(requests[2].body);
    expect(last).toContain('劳动形成价值。'); expect(last).toContain('allCovered'); expect(last).toContain('unitId');
    expect(last).not.toContain('completedReadings');
    expect(requests[2].body.tools ?? []).toEqual([]);
    expect(states.some(state => state.units.length === 1 && state.phase === 'reading')).toBe(true);
    expect(states.some(state => state.pending?.index === 1 && state.thinkingCompleted)).toBe(true);
    expect(f.events.filter(event => event.type === 'raw_delta')).toEqual([]);
  });
  it('缺字段准确回交Agent，修正后继续；前期普通文字不泄漏为句读', async () => {
    const { config, requests } = await mockProvider('openai', [{ text: ['正在规划的隐藏文字'], name: SENTENCE_TOOL, args: { ...sentence('劳动形成价值。'), sourceAnnotations: { keywords: 'none', keySentences: 'none' } } }, { name: SENTENCE_TOOL, args: sentence('劳动形成价值。') }, { name: SENTENCE_TOOL, args: sentence('价值通过关系表现。') }, { text: ['价值依赖劳动与关系。'] }]);
    const { f, session, commit } = semanticFixture(); await runReadingAgent({ ...f, config, semantic: session });
    expect(JSON.stringify(requests[1].body)).toContain('concepts'); expect(commit).toHaveBeenCalledTimes(2);
    expect(session.state.conclusion?.content).not.toContain('隐藏文字');
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });
  it('当前句三次错误终止，不丢已完成内容、不伪造成功', async () => {
    const invalid = { ...sentence('价值通过关系表现。'), sourceStart: '根本不存在' };
    const { config } = await mockProvider('openai', [{ name: SENTENCE_TOOL, args: sentence('劳动形成价值。') }, ...Array.from({ length: 3 }, () => ({ name: SENTENCE_TOOL, args: invalid }))]);
    const { f, session, commit } = semanticFixture();
    await expect(runReadingAgent({ ...f, config, semantic: session })).rejects.toThrow('三次');
    expect(commit).toHaveBeenCalledOnce(); expect(session.state.units).toHaveLength(1);
  });
  it('错误正文标注可重交，普通回复JSON样式不被解析', async () => {
    const { config, requests } = await mockProvider('openai', [{ text: ['示例 {并非 JSON}。'], name: 'mark_answer_emphasis', args: { answerEmphasis: { keywords: ['不存在'], keySentences: 'none' } } }, { name: 'mark_answer_emphasis', args: none }]);
    const f = fixture(); expect((await runReadingAgent({ ...f, config })).text).toContain('{并非 JSON}'); expect(requests).toHaveLength(2);
    expect(f.tools.saveEmphasis).toHaveBeenCalledOnce();
  });
  it('按需检索和读取保留审计与普通回复的段落边界', async () => {
    const { config } = await mockProvider('openai', [{ text: ['先核对原文。'], name: 'search_book', args: { query: '劳动' } }, { text: ['### 解释\n劳动形成价值。'], name: 'mark_answer_emphasis', args: none }]);
    const f = fixture(); const result = await runReadingAgent({ ...f, config });
    expect(result.text).toBe('先核对原文。\n\n### 解释\n劳动形成价值。'); expect(f.tools.search).toHaveBeenCalledOnce();
  });
  it('未授权不装配任何外部工具', async () => {
    const { config, requests } = await mockProvider('openai', [{ text: ['回答'], name: 'mark_answer_emphasis', args: none }]); await runReadingAgent({ ...fixture(), config });
    for (const name of ['search_web', 'search_openalex', 'verify_crossref', 'read_external_source']) expect(JSON.stringify(requests[0].body.tools)).not.toContain(name);
  });
  it('输出截断、EOF都不误报成功', async () => {
    for (const step of [{ text: ['半截'], finish: 'length' }, { text: ['半截'], interrupted: true }]) {
      const { config } = await mockProvider('openai', [step]); await expect(runReadingAgent({ ...fixture(), config })).rejects.toThrow();
    }
  });
  it('取消、实际输入窗口和无效检索循环有界，不按任务累计Token取消', async () => {
    const { config, requests } = await mockProvider('openai', Array.from({ length: 30 }, () => ({ name: 'search_book', args: { query: '劳动' } })));
    const abort = new AbortController(); abort.abort(); await expect(runReadingAgent({ ...fixture(), config, signal: abort.signal })).rejects.toThrow();
    await expect(runReadingAgent({ ...fixture(), config, contextWindow: 256, maxOutputTokens: 128 })).rejects.toThrow('上下文预算'); expect(requests).toHaveLength(0);
    let failure: unknown; try { await runReadingAgent({ ...fixture(), config }); } catch (error: unknown) { failure = error; }
    expect(readingAgentFailure(failure)?.code).toBe('tool_limit'); expect(requests.length).toBeLessThan(30);
  });
  it('超过释读表达目标仍能完成，不限制输出Token', async () => {
    const text = '释'.repeat(1200); const { config, requests } = await mockProvider('openai', [{ text: [text], name: 'mark_answer_emphasis', args: none }]);
    const result = await runReadingAgent({ ...fixture(), config }); expect(result.text).toBe(text); expect(requests[0].body.max_tokens).toBeUndefined();
  });
  it('包装异常仍保留可操作错误', () => { expect(readingAgentFailure(new Error('wrapper', { cause: new ReadingAgentError('context_limit', '上下文超限') }))).toEqual({ code: 'context_limit', message: '上下文超限' }); });
});

it.each(['openai','claude'] as const)('%s普通答案后漏工具由同一Agent补交，既不伪造重点也不重复正文',async provider=>{
 const {config,requests}=await mockProvider(provider,[{text:['劳动形成价值。']},{name:'mark_answer_emphasis',args:{answerEmphasis:{keywords:['劳动'],keySentences:'none'}}}]);
 const f=fixture();const result=await runReadingAgent({...f,config});expect(result.text).toBe('劳动形成价值。');expect(requests).toHaveLength(2);
 expect(JSON.stringify(requests[1].body.messages)).toContain('劳动形成价值。');expect(JSON.stringify(requests[1].body.messages)).toContain('禁止改写');
 expect(JSON.stringify(requests[1].body.tools)).not.toContain('search_book');expect(f.tools.saveEmphasis).toHaveBeenCalledOnce();
});
it('连续漏工具只允许两次补交请求，原正文保留且没有伪审计成功',async()=>{
 const {config,requests}=await mockProvider('openai',Array.from({length:3},()=>({text:['未提交重点的正文']})));
 const f=fixture();let failure:unknown;try{await runReadingAgent({...f,config});}catch(error:unknown){failure=error;}
 expect(readingAgentFailure(failure)?.code).toBe('emphasis_missing');expect(requests).toHaveLength(3);expect(f.audit).not.toHaveBeenCalled();
 expect(f.events.filter(event=>event.type==='raw_delta')).toEqual([{type:'raw_delta',text:'未提交重点的正文'}]);
});
