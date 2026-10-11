// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { mapEpubDocument, rangeForEpubAnchor, selectionFromEpubRange } from './epub-source-map';
it('保留的旧目录整页块仍能逐字定位跨div的UTF16选区', () => {
  const doc = new DOMParser().parseFromString('<div>目录</div><div>甲😀</div><div>乙</div>', 'text/html');
  const text = '目录 甲😀 乙';
  const maps = mapEpubDocument(doc, { id: 'toc', title: '目录', paragraphs: [{ id: 'old-toc', text }] });
  expect(maps).toHaveLength(1);
  const start = text.indexOf('甲');
  const range = rangeForEpubAnchor(maps, 'old-toc', start, text.length);
  expect(range).not.toBeNull();
  expect(selectionFromEpubRange(range!, maps)).toEqual({ paragraphId: 'old-toc', startOffset: start, endOffset: text.length, text: '甲😀 乙' });
  expect(doc.querySelectorAll('div')).toHaveLength(3);
});
