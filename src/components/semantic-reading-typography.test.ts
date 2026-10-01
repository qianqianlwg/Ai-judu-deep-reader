import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

it('小结与普通回复的正文使用同一规则和字号，覆盖全局 UI 段落字号', async () => {
  const panel = await readFile('src/components/analysis-panel.module.css', 'utf8');
  expect(panel).toContain('--chat-response-font-size: max(15px, calc(var(--ui-text-size, 13px) + 2px))');
  const sharedRule = panel.match(/:global\(\.app-shell\.workspace-shell\) \.panel :global\(\.chat-message\.assistant \.message-content\),[^{}]+\{ font-size: var\(--chat-response-font-size\); \}/u)?.[0];
  expect(sharedRule).toBeDefined();
  expect(sharedRule).toContain('.chat-message.assistant .message-content :is(p,li,blockquote)');
  expect(sharedRule).toContain('[aria-label="本次细读小结"] > div)');
  expect(sharedRule).toContain('[aria-label="本次细读小结"] > div :is(p,li,blockquote)');
  expect(sharedRule).toContain('.composerInput');
  expect(sharedRule).not.toContain('!important');
});

it('小结只放大正文，不将标题、生成提示和重试按钮扩大到回复字号', async () => {
  const [panel, conclusion] = await Promise.all([
    readFile('src/components/analysis-panel.module.css', 'utf8'),
    readFile('src/components/semantic-reading-conclusion.module.css', 'utf8'),
  ]);
  const sharedRule = panel.match(/[^{}]+\{ font-size: var\(--chat-response-font-size\); \}/u)?.[0];
  expect(sharedRule).not.toMatch(/header|button|span|h4|\.note/u);
  expect(conclusion).toContain('.heading h4 { margin: 0; font-size: 14px; font-weight: 600; }');
  expect(conclusion).toContain('.heading span, .note { color: var(--reading-muted); font-size: 12px; }');
});
