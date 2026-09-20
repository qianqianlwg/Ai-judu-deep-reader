/** 来源偏移均使用 UTF-16；version 2 保存整个连续选区，顶层仅为旧客户端导航入口。 */
export type ReadingAnchorPart = { paragraphId: string; startOffset: number; endOffset: number; selectedText: string };
export type ReadingAnchor = ReadingAnchorPart & { version?: 2; fragments?: ReadingAnchorPart[] };
export const MAX_SELECTION_PARTS = 256;
export const SELECTION_SEPARATOR = "\n\n";
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
export function readAnchorPart(value: unknown): ReadingAnchorPart | null {
  if (!record(value) || typeof value.paragraphId !== "string" || !value.paragraphId
    || typeof value.startOffset !== "number" || !Number.isSafeInteger(value.startOffset) || value.startOffset < 0
    || typeof value.endOffset !== "number" || !Number.isSafeInteger(value.endOffset) || value.endOffset <= value.startOffset
    || typeof value.selectedText !== "string" || !value.selectedText.trim()
    || value.selectedText.length !== value.endOffset - value.startOffset) return null;
  return { paragraphId: value.paragraphId, startOffset: value.startOffset, endOffset: value.endOffset, selectedText: value.selectedText };
}
export function readAnchorParts(value: unknown): ReadingAnchorPart[] | null {
  if (!Array.isArray(value) || !value.length || value.length > MAX_SELECTION_PARTS) return null;
  const parts = value.map(readAnchorPart);
  return parts.every((part): part is ReadingAnchorPart => part !== null) ? parts : null;
}
export function anchorParts(anchor: ReadingAnchor): readonly ReadingAnchorPart[] { return anchor.fragments ?? [anchor]; }
export function joinAnchorText(parts: readonly ReadingAnchorPart[]): string { return parts.map(part => part.selectedText).join(SELECTION_SEPARATOR); }
export function makeReadingAnchor(parts: readonly ReadingAnchorPart[]): ReadingAnchor {
  if (!parts.length) throw new Error("原文来源不能为空");
  const first = { ...parts[0] };
  return parts.length === 1 ? first : { ...first, version: 2, fragments: parts.map(part => ({ ...part })) };
}
export function readReadingAnchor(value: unknown): ReadingAnchor | null {
  const first = readAnchorPart(value);
  if (!first || !record(value)) return null;
  if (value.fragments === undefined && value.version === undefined) return first;
  const parts = readAnchorParts(value.fragments);
  if (value.version !== 2 || !parts || JSON.stringify(parts[0]) !== JSON.stringify(first)) return null;
  return makeReadingAnchor(parts);
}
export function splitsReadingCharacter(text: string, offset: number): boolean {
  const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}
export type AnchorParagraph = { id: string; text: string };
/** WHY：只认可同一版本中连续、完整覆盖的原文片段，不用模糊匹配修补缺段或错位。 */
export function anchorsMatchParagraphs(parts: readonly ReadingAnchorPart[], paragraphs: readonly AnchorParagraph[], text = joinAnchorText(parts)): boolean {
  if (!parts.length || parts.length > MAX_SELECTION_PARTS || joinAnchorText(parts) !== text) return false;
  const first = paragraphs.findIndex(paragraph => paragraph.id === parts[0].paragraphId);
  return first >= 0 && parts.every((part, index) => {
    const paragraph = paragraphs[first + index];
    return readAnchorPart(part) !== null && paragraph?.id === part.paragraphId
      && part.endOffset <= paragraph.text.length && !splitsReadingCharacter(paragraph.text, part.startOffset) && !splitsReadingCharacter(paragraph.text, part.endOffset)
      && paragraph.text.slice(part.startOffset, part.endOffset) === part.selectedText
      && (index === 0 || part.startOffset === 0)
      && (index === parts.length - 1 || part.endOffset === paragraph.text.length);
  });
}
