// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AnalysisPanel } from './analysis-panel';
import { applyChatEvent, type ChatMessage, type ToolActivity } from '@/lib/chat-stream';
import type { SemanticReading, SemanticUnit } from '@/lib/semantic-reading';

let host: HTMLDivElement;
let root: Root;
const jump = vi.fn();
const running: ToolActivity = { id: 'prefetch-1', name: 'prefetch_book_context', status: 'running' };
const finished: ToolActivity = { ...running, status: 'completed', result: {
  ok: true, sources: [{ sourceId: 'book:e:paragraph:related', paragraphId: 'related', chapterTitle: '关联检索回归样例', text: '其他位置的真实返回原文。', channels: ['semantic'] }],
  retrieval: { version: 1, requestedMode: 'semantic', effectiveMode: 'semantic', queries: ['价值'], branches: [{ query: '价值', strategy: 'semantic', status: 'completed', count: 4, durationMs: 5 }], durationMs: 5, sourceCount: 4, degraded: false },
} };
const unit: SemanticUnit = { id: 'u', label: '第一句', action: 'read', reason: '', anchor: { paragraphId: 'p', startOffset: 0, endOffset: 2, selectedText: '甲。' }, status: 'completed', content: '第一句释读。' };
const base = (): ChatMessage[] => [{ id: 'a', role: 'assistant', content: '', status: 'streaming', outputFormat: 'text' }];
const render = async (messages: ChatMessage[]) => { await act(async () => root.render(<AnalysisPanel selected='' analysis={null} loading={messages.some(m => m.status === 'streaming')} messages={messages} onClose={() => undefined} onBack={() => undefined} onOpenCitation={jump} />)); };
const card = () => host.querySelector<HTMLDetailsElement>('[data-testid="retrieval-activity"]');
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); jump.mockClear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

// WHY：按真实 SSE 事件的阶段顺序回归，防止普通回复切为句读组件后检索卡被卸载或重复展示。
it('关联检索从执行到思考、逐句、完成都保留同一张卡，展开状态不丢失且不重复', async () => {
  let messages = applyChatEvent(base(), 'a', { type: 'tool', tool: running });
  await render(messages);
  const original = card(); expect(original).not.toBeNull();
  expect(original?.dataset.state).toBe('running');
  expect(host.querySelectorAll('[data-tool-id="prefetch-1"]')).toHaveLength(1);
  await act(async () => original!.querySelector('summary')!.click()); expect(original!.open).toBe(true);
  messages = applyChatEvent(messages, 'a', { type: 'tool', tool: finished }); await render(messages);
  const channel = host.querySelector<HTMLDetailsElement>('[data-retrieval-channel="semantic"]')!;
  await act(async () => channel.querySelector('summary')!.click());
  const phases: SemanticReading[] = [
    { version: 1, phase: 'planning', units: [], totalCharacters: 4, thinkingCompleted: false },
    { version: 1, phase: 'reading', units: [], totalCharacters: 4, thinkingCompleted: true, pending: { index: 1 } },
    { version: 1, phase: 'reading', units: [unit], totalCharacters: 4, thinkingCompleted: true, pending: { index: 2 } },
    { version: 1, phase: 'completed', units: [unit], totalCharacters: 2, thinkingCompleted: true },
  ];
  for (const result of phases) {
    messages = applyChatEvent(messages, 'a', { type: 'semantic', result, content: '句读阶段正文' }); await render(messages);
    expect(card()).toBe(original); expect(original!.open).toBe(true); expect(channel.open).toBe(true);
    expect(original!.dataset.state).toBe('completed'); expect(original!.textContent).toContain('关联检索回归样例');
    expect(host.querySelectorAll('[data-tool-id="prefetch-1"]')).toHaveLength(1);
    expect(original!.textContent).toContain('4 段去重候选'); expect(original!.textContent).toContain('1 段关联参考');
  }
  messages = applyChatEvent(messages, 'a', { type: 'done' }); await render(messages);
  expect(card()).toBe(original); expect(original!.open).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="定位原文：关联检索回归样例"]')!.click());
  expect(jump).toHaveBeenCalledWith('related', '其他位置的真实返回原文。', 'a');
});

it('历史句读和失败、取消也保留检索事实与失败原因，不伪装检索成功', async () => {
  const semantic: SemanticReading = { version: 1, phase: 'completed', units: [unit] };
  await render([{ ...base()[0], status: 'completed', tools: [finished], semantic }]);
  expect(card()?.dataset.state).toBe('completed'); expect(card()?.textContent).toContain('关联检索回归样例');
  await render([{ ...base()[0], status: 'error', tools: [{ ...finished, result: { ok: false, message: '向量服务未配置，本轮未取得关联原文。', sources: [] } }], semantic: { ...semantic, phase: 'interrupted' } }]);
  expect(card()?.dataset.state).toBe('degraded'); expect(card()?.textContent).toContain('向量服务未配置');
  expect(card()?.textContent).not.toContain('检索已完成');
  await render([{ ...base()[0], status: 'error', tools: [running], semantic: { ...semantic, phase: 'interrupted' } }]);
  expect(card()?.dataset.state).toBe('interrupted'); expect(card()?.textContent).toContain('检索已中断');
});
