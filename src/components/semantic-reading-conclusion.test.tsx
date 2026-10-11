import React from 'react';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SemanticReadingConclusion } from './semantic-reading-conclusion';
describe('本次细读小结展示', () => {
  it('呈现AI原文Markdown，安全处理图片和HTML', () => {
    const html = renderToStaticMarkup(<SemanticReadingConclusion conclusion={{ status: 'completed', content: '**整体主旨**。[资料](https://example.test) ![图](https://img.test/x) <script>attack()</script>' }}/>);
    expect(html).toContain('<strong>整体主旨</strong>'); expect(html).toContain('noopener noreferrer'); expect(html).toContain('图片未自动加载'); expect(html).not.toContain('<img'); expect(html).not.toContain('<script');
  });
  it('小结使用紧凑段距，不继承聊天正文的保留空白样式', async () => {
    const html = renderToStaticMarkup(<SemanticReadingConclusion conclusion={{ status: 'completed', content: '第一段。\n\n第二段。' }}/>);
    expect(html).not.toContain('message-content');
    expect(html.match(/<p>/g)).toHaveLength(2);
    const css = await readFile(path.resolve('src/components/semantic-reading-conclusion.module.css'), 'utf8');
    expect(css).toContain('white-space: normal');
    expect(css).toContain('.body :global(p) { margin: 0 0 10px;');
  });
  it('工具结束后显示正在生成，并展示流式片段', () => {
    const empty = renderToStaticMarkup(<SemanticReadingConclusion conclusion={{ status: 'streaming', content: '' }}/>);
    expect(empty).toContain('AI 正在串联'); expect(empty).toContain('aria-busy="true"');
    expect(renderToStaticMarkup(<SemanticReadingConclusion conclusion={{ status: 'streaming', content: '当前小结' }}/>)).toContain('当前小结');
  });
  it('失败保留部分正文并显示原错误，重试受请求锁保护', () => {
    const html = renderToStaticMarkup(<SemanticReadingConclusion disabled onRetry={vi.fn()} conclusion={{ status: 'error', content: '部分小结', error: '403 channel_unavailable' }}/>);
    expect(html).toContain('部分小结'); expect(html).toContain('403 channel_unavailable'); expect(html).toContain('重试小结'); expect(html).toContain('disabled=""');
  });
});
