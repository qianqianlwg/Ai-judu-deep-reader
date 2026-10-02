// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { SemanticReadingResult } from './semantic-reading-result';
import styles from './semantic-reading-answer.module.css';
import type { SemanticUnit } from '@/lib/semantic-reading';

const unit: SemanticUnit = {
  id: 'gap-unit', label: '段落间距', action: 'read', reason: '',
  anchor: { paragraphId: 'p', startOffset: 0, endOffset: 2, selectedText: '原文' },
  status: 'completed',
  content: '**第一段**。\n\n\n\n第二段。\n软换行仍在同段。\n\n```text\n  保留缩进\n下一行\n```',
};
afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; });

async function installStyles(): Promise<void> {
    const css = await readFile(path.resolve('src/components/semantic-reading-answer.module.css'), 'utf8');
    const style = document.createElement('style');
    // WHY：模拟聊天全局样式后再加载生产模块规则，验证不是仅靠删除 Agent 原文换行来收紧段距。
    style.textContent = '.message-content { white-space: pre-wrap; }\n' + css
      .replaceAll('.body', '.' + styles.body)
      .replace(/:global\(([^)]+)\)/gu, '$1');
    document.head.append(style);
}

describe('句读 Markdown 段距', () => {
  it('普通段落紧凑显示，保留强调、原文和代码换行', async () => {
    const html = renderToStaticMarkup(<SemanticReadingResult state={{ version: 1, phase: 'completed', units: [unit] }}/>);
    document.body.innerHTML = html;
    const body = document.querySelector('.semantic-answer');
    expect(body?.classList.contains(styles.body)).toBe(true);
    expect(body?.querySelectorAll('p')).toHaveLength(2);
    expect(body?.querySelector('strong')?.textContent).toBe('第一段');
    expect(body?.querySelector('pre')?.textContent).toBe('  保留缩进\n下一行\n');
    expect(document.querySelector('.semantic-source blockquote')?.textContent).toBe('原文');

    await installStyles();
    expect(getComputedStyle(body!).whiteSpace).toBe('normal');
    const paragraphs = body!.querySelectorAll('p');
    expect(getComputedStyle(paragraphs[0]).marginBottom).toBe('10px');
    expect(getComputedStyle(paragraphs[1]).whiteSpace).toBe('normal');
    expect(getComputedStyle(body!.querySelector('pre')!).whiteSpace).toBe('pre-wrap');
  });

  it('最后一段不留额外底部空白，流式内容也使用同一规则', async () => {
    document.body.innerHTML = renderToStaticMarkup(<SemanticReadingResult state={{ version: 1, phase: 'reading', units: [{ ...unit, status: 'streaming', content: '第一段。\n\n第二段。' }] }}/>);
    const body = document.querySelector('.semantic-answer');
    expect(body?.classList.contains(styles.body)).toBe(true);
    expect(body?.querySelectorAll('p')).toHaveLength(2);
    await installStyles();
    expect(getComputedStyle(body!.querySelector('p:last-child')!).marginBottom).toBe('0px');
    expect(getComputedStyle(body!).whiteSpace).toBe('normal');
  });
});
