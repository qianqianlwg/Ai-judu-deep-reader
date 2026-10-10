import JSZip from 'jszip';
import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EPUB_HREF, makeEpub } from '../app/api/import/fixtures';
import { parseEpubFile } from './epub-parser';
import { validateEpubImport } from './epub-import-security';

async function uriFixture(removeChapter = false): Promise<Buffer> {
  const zip = await JSZip.loadAsync(makeEpub());
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  const entry = zip.file(EPUB_HREF);
  if (!entry) throw new Error('测试夹具缺少正文');
  const chapter = await entry.async('string');
  const encoded = '33%20-%20副本%20-%20副本.html';
  for (const name of ['OPS/book.opf', 'OPS/toc.ncx']) {
    const resource = zip.file(name);
    if (!resource) throw new Error('测试夹具缺少清单或目录');
    zip.file(name, (await resource.async('string')).replaceAll('Text/chapter%20one.xhtml', 'Text/' + encoded));
  }
  zip.remove(EPUB_HREF);
  if (!removeChapter) zip.file('OPS/Text/33 - 副本 - 副本.html', chapter, { createFolders: false });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
async function parseFixture(bytes: Buffer) {
  await validateEpubImport(bytes);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'judu-uri-test-'));
  try {
    const file = path.join(directory, 'source.epub');
    await fs.writeFile(file, bytes);
    return await parseEpubFile(file);
  } finally {
    // WHY：递归清理限于本次mkdtemp返回的已核验测试目录，不接触用户原件或正式书库。
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('judu-uri-test-')) {
      throw new Error('测试临时目录边界异常');
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
}
it('通过安全预检后读取URI编码的中文空格章节，保留真实来源href和段落', async () => {
  const result = await parseFixture(await uriFixture());
  expect(result.chapters).toHaveLength(1);
  expect(result.chapters[0].sourceHref).toBe('OPS/Text/33%20-%20副本%20-%20副本.html');
  expect(result.chapters[0].paragraphs).toEqual(['First paragraph important .', '第二段， 保持原文。']);
});
it('旧字面百分号归档保持原有结果', async () => {
  const result = await parseFixture(makeEpub());
  expect(result.chapters[0].sourceHref).toBe(EPUB_HREF);
  expect(result.chapters[0].paragraphs).toEqual(['First paragraph important .', '第二段， 保持原文。']);
});
it('真实缺失章节仍然失败，不跳过失败章节伪造导入成功', async () => {
  await expect(parseFixture(await uriFixture(true))).rejects.toThrow('章节资源不存在');
});
