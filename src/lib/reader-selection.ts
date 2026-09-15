export type ReadingSelection = { paragraphId: string; startOffset: number; endOffset: number; text: string };

/** 分页 DOM 中一个可合并的原文片段；偏移始终是 UTF-16 code unit 偏移。 */
export type ReadingSelectionFragment = ReadingSelection & {
  pageIndex?: number;
  pageNumber?: number;
};
export type SelectionMergeFailureReason =
  | "empty"
  | "different-paragraph"
  | "invalid-range"
  | "text-offset-mismatch"
  | "non-contiguous"
  | "overlap";
export type SelectionMergeResult =
  | { ok: true; selection: ReadingSelection; fragments: readonly ReadingSelectionFragment[] }
  | { ok: false; reason: SelectionMergeFailureReason; message: string };
export type SelectionExtensionDirection = "next" | "previous";
export type SelectionExtensionResult =
  | { ok: true; selection: ReadingSelection; fragments: readonly ReadingSelectionFragment[]; direction: SelectionExtensionDirection; added: ReadingSelectionFragment }
  | { ok: false; reason: SelectionMergeFailureReason; message: string; direction: SelectionExtensionDirection; added: ReadingSelectionFragment };

function paragraphFor(node: Node): HTMLElement | null {
  return (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("p[data-paragraph-id]") ?? null;
}
function plainText(fragment: DocumentFragment): string {
  fragment.querySelectorAll("[data-reader-decoration], button, [role='dialog'], [role='tooltip']").forEach(node => node.remove());
  return fragment.textContent ?? "";
}
function invalid(reason: SelectionMergeFailureReason, message: string): SelectionMergeResult {
  return { ok: false, reason, message };
}
function validateFragment(fragment: ReadingSelectionFragment): SelectionMergeFailureReason | null {
  if (!fragment.paragraphId || !Number.isInteger(fragment.startOffset) || !Number.isInteger(fragment.endOffset) || fragment.startOffset < 0 || fragment.endOffset <= fragment.startOffset) return "invalid-range";
  // WHY：JavaScript string length 和服务端锚点都按 UTF-16 code unit 计数；不能用 Array.from 代替。
  if (fragment.text.length !== fragment.endOffset - fragment.startOffset) return "text-offset-mismatch";
  return null;
}
function mergeMessage(reason: SelectionMergeFailureReason): string {
  return {
    empty: "没有可合并的选文片段。",
    "different-paragraph": "跨页扩展暂只支持同一段落，不能跨段落隐式拼接。",
    "invalid-range": "选文锚点范围无效。",
    "text-offset-mismatch": "选文文本长度与 UTF-16 锚点不一致。",
    "non-contiguous": "分页片段之间存在原文间隙，未自动拼接。",
    overlap: "分页片段发生重叠，未重复拼接。",
  }[reason];
}
/**
 * 合并同一段落的连续分页片段。
 * WHY：页码会因字号和窗口变化，保存 start/end 锚点才能在下一次分页后重新定位；合并前拒绝间隙和重叠，避免误把未选文字送给模型。
 */
export function mergeReadingSelectionFragments(fragments: readonly ReadingSelectionFragment[]): SelectionMergeResult {
  if (fragments.length === 0) return invalid("empty", mergeMessage("empty"));
  const ordered = [...fragments].sort((left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset);
  const firstParagraph = ordered[0].paragraphId;
  for (const fragment of ordered) {
    const reason = validateFragment(fragment);
    if (reason) return invalid(reason, mergeMessage(reason));
    if (fragment.paragraphId !== firstParagraph) return invalid("different-paragraph", mergeMessage("different-paragraph"));
  }
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]; const current = ordered[index];
    if (current.startOffset < previous.endOffset) return invalid("overlap", mergeMessage("overlap"));
    if (current.startOffset !== previous.endOffset) return invalid("non-contiguous", mergeMessage("non-contiguous"));
  }
  const first = ordered[0]; const last = ordered[ordered.length - 1];
  return {
    ok: true,
    selection: { paragraphId: first.paragraphId, startOffset: first.startOffset, endOffset: last.endOffset, text: ordered.map(fragment => fragment.text).join("") },
    fragments: ordered,
  };
}
function extendSelection(selection: ReadingSelection, adjacent: ReadingSelectionFragment, direction: SelectionExtensionDirection): SelectionExtensionResult {
  const fragments = direction === "next" ? [selection, adjacent] : [adjacent, selection];
  const result = mergeReadingSelectionFragments(fragments);
  return result.ok ? { ...result, direction, added: adjacent } : { ...result, direction, added: adjacent };
}
/** 父组件无法跨两个分页 DOM 直接拖选时，明确请求把当前选文延伸到下一页。 */
export function extendReadingSelectionToNextPage(selection: ReadingSelection, nextPageFragment: ReadingSelectionFragment): SelectionExtensionResult {
  return extendSelection(selection, nextPageFragment, "next");
}
/** 父组件无法跨两个分页 DOM 直接拖选时，明确请求把当前选文延伸到上一页。 */
export function extendReadingSelectionToPreviousPage(selection: ReadingSelection, previousPageFragment: ReadingSelectionFragment): SelectionExtensionResult {
  return extendSelection(selection, previousPageFragment, "previous");
}
/** 将当前分页片段转换为扩展接口所需的稳定锚点，不读取页码作为语义边界。 */
export function selectionFragmentFromPagePart(input: {
  paragraphId: string;
  text: string;
  sourceStartOffset: number;
  sourceEndOffset: number;
  pageIndex?: number;
  pageNumber?: number;
}): ReadingSelectionFragment {
  return {
    paragraphId: input.paragraphId, text: input.text, startOffset: input.sourceStartOffset,
    endOffset: input.sourceEndOffset, pageIndex: input.pageIndex, pageNumber: input.pageNumber,
  };
}
export function readReadingSelection(selection: Selection | null, container: HTMLElement): ReadingSelection | null {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0); const start = paragraphFor(range.startContainer); const end = paragraphFor(range.endContainer);
  if (!start || start !== end || !container.contains(start)) return null;
  const paragraphId = start.dataset.paragraphId; if (!paragraphId) return null;
  const prefix = range.cloneRange(); prefix.selectNodeContents(start); prefix.setEnd(range.startContainer, range.startOffset);
  const raw = plainText(range.cloneContents()); const text = raw.trim(); if (!text) return null;
  const startOffset = Number(start.dataset.sourceStart ?? 0) + plainText(prefix.cloneContents()).length + (raw.length - raw.trimStart().length);
  return { paragraphId, startOffset, endOffset: startOffset + text.length, text };
}
