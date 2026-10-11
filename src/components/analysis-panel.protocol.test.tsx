// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AnalysisPanel } from './analysis-panel';
type Props = Parameters<typeof AnalysisPanel>[0];
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
// WHY：统一工具状态单独测试，不继续扩大已有的聊天滚动/消息编辑回归文件。
const render = async (props: Partial<Props>) => { await act(async () => root.render(<AnalysisPanel selected="" analysis={null} loading={false} onClose={() => undefined} onBack={() => undefined} {...props} />)); };
const message = (id: string) => container.querySelector<HTMLElement>('[data-message-id="' + id + '"]')!;
it('逐句工具显示简洁中文状态而不裸露工具JSON，新记忆状态沿用内部进度卡',async()=>{
 await render({messages:[{id:'unified-result',role:'assistant',content:'正常正文',outputFormat:'text',tools:[{id:'sentence',name:'submit_reading_sentence',status:'completed',result:{ok:true,unitId:'internal-unit',completed:2,allCovered:true}},{id:'memory',name:'compact_reading_memory',status:'running',result:'已覆盖2/4条历史'}]}]});
 const item=message('unified-result');expect(item.textContent).toContain('提交本句释读');expect(item.textContent).toContain('全部原文句读已提交');expect(item.textContent).toContain('整理阅读记忆');
 expect(item.textContent).not.toContain('internal-unit');expect(item.textContent).not.toContain('"allCovered"');expect(item.querySelector('[data-context-progress]')).not.toBeNull();
});

it('长会话只渲染有上限的消息窗口，主动加载旧消息时继续保持视口锚点', async () => {
  const messages = Array.from({ length: 100 }, (_, index) => ({ id: `window-${index}`, role: 'user' as const, content: `历史消息 ${index}` }));
  await render({ messages });
  expect(container.querySelector('[data-testid="chat-messages"]')?.getAttribute('data-rendered-message-count')).toBe('30');
  expect(container.querySelector('[data-message-index="69"]')).toBeNull();
  expect(container.querySelector('[data-message-index="70"]')?.textContent).toContain('历史消息 70');
  const older = container.querySelector<HTMLButtonElement>('[data-testid="load-older-messages"]');
  expect(older).not.toBeNull();
  await act(async () => older!.click());
  expect(container.querySelector('[data-testid="chat-messages"]')?.getAttribute('data-rendered-message-count')).toBe('50');
  expect(container.querySelector('[data-message-index="50"]')).not.toBeNull();
});

it('聊天面板可展开目标所在窗口后完成历史定位回调', async () => {
  const messages = Array.from({ length: 100 }, (_, index) => ({ id: `target-${index}`, role: 'user' as const, content: `历史消息 ${index}` }));
  const handled = vi.fn();
  await render({ messages, historyTargetMessageId: 'target-3', onHistoryTargetHandled: handled });
  expect(container.querySelector('[data-message-id="target-3"]')?.getAttribute('data-history-target')).toBe('true');
  expect(handled).toHaveBeenCalledWith(true);
});
