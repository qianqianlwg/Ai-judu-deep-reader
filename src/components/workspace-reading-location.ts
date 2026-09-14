import type { ReadingAnchor } from "@/lib/pagination";
import type { ReadingSelection } from "@/lib/reader-selection";

type SourceParagraph = { id: string; text: string };
export type SearchSelectionTarget = { paragraphId: string; matchedText?: string; excerpt?: string; startOffset?: number };

export function restoreWorkspaceReadingAnchor(raw: string | null, paragraphs: readonly SourceParagraph[]): ReadingAnchor | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || !("paragraphId" in value) || !("offset" in value) || typeof value.paragraphId !== "string" || typeof value.offset !== "number" || !Number.isSafeInteger(value.offset) || value.offset < 0) return null;
    const paragraph = paragraphs.find(item => item.id === value.paragraphId);
    return paragraph && value.offset <= paragraph.text.length ? { paragraphId: value.paragraphId, offset: value.offset } : null;
  } catch (cause: unknown) {
    console.error("保存的阅读位置不可用", cause);
    return null;
  }
}

export function selectionFromSearchResult(target: SearchSelectionTarget, paragraph: SourceParagraph | undefined): ReadingSelection | null {
  if (!paragraph || paragraph.id !== target.paragraphId) return null;
  const text = target.matchedText ?? target.excerpt;
  if (typeof text !== "string" || !text.trim()) return null;
  // WHY：offset存在时必须逐字验证该位置，不能失败后偷偷换到同段另一处同名文本。
  const startOffset = target.startOffset === undefined ? paragraph.text.indexOf(text) : target.startOffset;
  if (!Number.isSafeInteger(startOffset) || startOffset < 0 || paragraph.text.slice(startOffset, startOffset + text.length) !== text) return null;
  // WHY：excerpt可能含省略号或语义概括；只有确实存在于原文的片段才能成为模型请求选区。
  return { paragraphId: paragraph.id, startOffset, endOffset: startOffset + text.length, text };
}
