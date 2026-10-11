import { expect, it } from 'vitest';
import { retainsLegacyWholePage } from './epub-legacy-whole-page';
import type { ParsedChapter } from './epub-parser';
const chapter: ParsedChapter = {
  title: '目录', sourceHref: 'toc.xhtml', paragraphs: ['目录 甲 乙'],
  legacyBlocks: [{ kind: 'paragraph', text: '目录 甲 乙', sourceOrdinal: 0 }],
  blocks: [{ kind: 'paragraph', text: '甲', sourceOrdinal: 0 }, { kind: 'paragraph', text: '乙', sourceOrdinal: 1 }],
  legacySourceOrdinals: [null, null],
};
it('整页旧投影逐字一致才保留，不能依靠子块拼接猜测旧锚点', () => {
  expect(retainsLegacyWholePage([{ id: 'old', text: '目录 甲 乙' }], chapter)).toBe(true);
  expect(retainsLegacyWholePage([{ id: 'old', text: '甲 乙' }], chapter)).toBe(false);
  expect(retainsLegacyWholePage([{ id: 'old', text: '目录 甲 乙', kind: 'heading' }], chapter)).toBe(false);
  expect(retainsLegacyWholePage([{ id: 'old', text: '目录 甲 乙' }], { ...chapter, legacySourceOrdinals: [0, null] })).toBe(false);
  expect(retainsLegacyWholePage([{ id: 'old', text: '目录 甲 乙' }], { ...chapter, legacySourceOrdinals: [] })).toBe(false);
  expect(retainsLegacyWholePage([{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }], chapter)).toBe(false);
  expect(retainsLegacyWholePage([{ id: 'old', text: '目录 甲 乙' }], { ...chapter, legacyBlocks: undefined })).toBe(false);
});
