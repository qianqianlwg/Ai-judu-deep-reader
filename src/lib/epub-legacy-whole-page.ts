import type { LibraryParagraph } from './library';
import type { ParsedChapter } from './epub-parser';

/** 识别旧解析器整页回退产生的不可拆分来源，仅做逐字和结构校验。 */
export function retainsLegacyWholePage(rows: readonly LibraryParagraph[], parsed: ParsedChapter): boolean {
  const legacy = parsed.legacyBlocks;
  const ordinals = parsed.legacySourceOrdinals;
  // WHY：整页旧锚点不能拆成多个新 ID；只有旧投影逐字一致且所有新容器均无旧元素边界时，才保留原块。
  return rows.length === 1 && legacy?.length === 1
    && legacy[0].kind === 'paragraph' && legacy[0].sourceOrdinal === 0
    && rows[0].text === legacy[0].text && rows[0].kind !== 'heading'
    && ordinals?.length === parsed.blocks.length && ordinals.length > 0
    && ordinals.every(ordinal => ordinal === null);
}
