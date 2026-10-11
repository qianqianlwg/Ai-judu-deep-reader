import { expect, it } from 'vitest';
import { readSourceBlockMetadata, isSupplementalEpubBlock } from './source-block';
it('兼容旧段落，并原样保留标题层级和来源次序', () => { expect(readSourceBlockMetadata({})).toEqual({}); expect(readSourceBlockMetadata({ kind: 'heading', headingLevel: 2, sourceOrdinal: 4 })).toEqual({ kind: 'heading', headingLevel: 2, sourceOrdinal: 4 }); });
it.each([{ kind: 'heading' }, { kind: 'heading', headingLevel: 7 }, { kind: 'paragraph', headingLevel: 1 }, { kind: 'heading', headingLevel: 2, sourceOrdinal: -1 }, { kind: 'unknown' }])('拒绝伪造的内容块元数据 %j', value => { expect(() => readSourceBlockMetadata(value)).toThrow(); });

it('仅识别保留给补建来源的ID命名空间，不根据文字或类名判断',()=>{
 expect(isSupplementalEpubBlock('epub-block-added')).toBe(true);expect(isSupplementalEpubBlock('original-uuid')).toBe(false);
});
