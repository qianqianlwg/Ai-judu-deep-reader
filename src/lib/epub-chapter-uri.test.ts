import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { resolveEpubChapterEntry, UriAwareEpub } from './epub-chapter-uri';

it('章节引用的空格与UTF8中文解码后精确命中，保留层级', async () => {
  const zip = new JSZip();
  zip.file('OPS/33 - 副本 - 副本.html', '<p>真实正文</p>');
  const href = 'OPS/33%20-%20%E5%89%AF%E6%9C%AC%20-%20副本.html';
  await expect(resolveEpubChapterEntry(zip, href).async('string')).resolves.toBe('<p>真实正文</p>');
});
it('字面百分号路径优先且只解码一次，不串用另一资源', async () => {
  const zip = new JSZip();
  zip.file('chapter%20one.html', '字面来源');
  zip.file('chapter one.html', '解码来源');
  await expect(resolveEpubChapterEntry(zip, 'chapter%20one.html').async('string')).resolves.toBe('字面来源');
  await expect(resolveEpubChapterEntry(zip, 'chapter%2520one.html').async('string')).resolves.toBe('字面来源');
  expect(() => resolveEpubChapterEntry(zip, 'chapter%252520one.html')).toThrow('不存在');
});
it('非法URI、路径穿越、分隔符及外部资源不能变为可读取路径', () => {
  const zip = new JSZip();
  zip.file('body.html', '真实正文');
  zip.file('OPS/body.html', '真实正文');
  for (const href of ['../body.html', '/body.html', 'OPS/%2e%2e/body.html', '%2Fbody.html', 'OPS%2Fbody.html', 'OPS/%5cbody.html', 'OPS/%00body.html', 'https://example.com/body.html', 'body%ZZ.html']) {
    expect(() => resolveEpubChapterEntry(zip, href)).toThrow();
  }
  expect(() => resolveEpubChapterEntry(zip, 'other/body.html')).toThrow('不存在');
});
it('原有字面百分号名称无需解码；目录与缺失条目明确失败', async () => {
  const zip = new JSZip(); zip.file('100%.html', '正文'); zip.folder('目录');
  await expect(resolveEpubChapterEntry(zip, '100%.html').async('string')).resolves.toBe('正文');
  expect(() => resolveEpubChapterEntry(zip, '目录')).toThrow('不存在');
  expect(() => resolveEpubChapterEntry(zip, 'missing.html')).toThrow('不存在');
});
it('适配器不改变章节类型限制、href和上游净化行为', async () => {
  const book = new UriAwareEpub(Buffer.alloc(0));
  book.zip = new JSZip(); book.rootFile = 'book.opf';
  book.zip.file('副本 one.html', '<html><body><h1>标题</h1><p onclick="bad()">正文</p><script>bad()</script></body></html>');
  book.manifest = { c: { id: 'c', href: '副本%20one.html', 'media-type': 'application/xhtml+xml' } };
  const html = await book.getChapter('c');
  expect(html).toContain('正文'); expect(html).not.toContain('<script');
  expect(book.manifest.c.href).toBe('副本%20one.html');
  await expect(book.getChapterRaw('missing')).rejects.toThrow('File not found');
  book.manifest.c['media-type'] = 'application/octet-stream';
  await expect(book.getChapterRaw('c')).rejects.toThrow('Invalid mime type');
});
