// WHY：此命名空间仅用于无损迁移补建的块；首次导入的原有正文始终使用 UUID，历史兼容可据此识别新增来源而不猜文字或标题样式。
export const EPUB_SUPPLEMENTAL_BLOCK_PREFIX = 'epub-block-';
export function isSupplementalEpubBlock(id:string):boolean{return id.startsWith(EPUB_SUPPLEMENTAL_BLOCK_PREFIX);}
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type SourceBlockMetadata = {
    kind?: 'paragraph' | 'heading';
    headingLevel?: HeadingLevel;
    sourceOrdinal?: number;
};
export type ParsedSourceBlock = {
    text: string;
    kind: 'paragraph' | 'heading';
    headingLevel?: HeadingLevel;
    sourceOrdinal: number;
};
export function isHeadingLevel(value: unknown): value is HeadingLevel { return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6; }
export function readSourceBlockMetadata(value: Record<string, unknown>): SourceBlockMetadata {
    if (value.kind === undefined && value.headingLevel === undefined && value.sourceOrdinal === undefined)
        return {};
    if ((value.kind !== 'heading' && value.kind !== 'paragraph') || (value.kind === 'heading' ? !isHeadingLevel(value.headingLevel) : value.headingLevel !== undefined)
        || (value.sourceOrdinal !== undefined && (typeof value.sourceOrdinal !== 'number' || !Number.isSafeInteger(value.sourceOrdinal) || value.sourceOrdinal < 0)))
        throw new Error('原文内容块类型或来源位置无效');
    return { kind: value.kind, ...(isHeadingLevel(value.headingLevel) ? { headingLevel: value.headingLevel } : {}), ...(typeof value.sourceOrdinal === 'number' ? { sourceOrdinal: value.sourceOrdinal } : {}) };
}
