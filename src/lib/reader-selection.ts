import { countReadingCharacters, MAX_READING_SELECTION } from "./reading-detail";
import { anchorsMatchParagraphs, SELECTION_SEPARATOR, type ReadingAnchorPart, type AnchorParagraph } from "./reading-anchors";
export type ReadingSelectionPart = { paragraphId: string; startOffset: number; endOffset: number; text: string };
export type ReadingSelection = ReadingSelectionPart & { version?: 2; fragments?: ReadingSelectionPart[] };
export function selectionParts(selection: ReadingSelection): readonly ReadingSelectionPart[] { return selection.fragments ?? [selection]; }
export function selectionAnchors(selection: ReadingSelection): ReadingAnchorPart[] { return selectionParts(selection).map(({text,...part}) => ({...part,selectedText:text})); }
export function selectionFromParts(parts: readonly ReadingSelectionPart[]): ReadingSelection {
  if (!parts.length) throw new Error("选区不能为空");
  return parts.length === 1 ? {...parts[0]} : {...parts[0],version:2,fragments:parts.map(part=>({...part})),text:parts.map(part=>part.text).join(SELECTION_SEPARATOR)};
}
export function selectionMatchesParagraphs(selection: ReadingSelection, paragraphs: readonly AnchorParagraph[]): boolean { return anchorsMatchParagraphs(selectionAnchors(selection), paragraphs, selection.text); }
/** WHY：限制实际可见选区而不是在提交时暗中截文；UTF-16 偏移与 Unicode 字数分别计算。 */
export function capReadingSelection(selection: ReadingSelection, fromEnd = false): ReadingSelection {
  if (countReadingCharacters(selection.text) <= MAX_READING_SELECTION) return selection;
  let remaining = MAX_READING_SELECTION;
  const result: ReadingSelectionPart[] = [];
  const parts = [...selectionParts(selection)];
  if (fromEnd) parts.reverse();
  for (const part of parts) {
    if (result.length) remaining -= SELECTION_SEPARATOR.length;
    if (remaining <= 0) break;
    const points = Array.from(part.text);
    const text = (fromEnd ? points.slice(-remaining) : points.slice(0, remaining)).join("");
    if (!text.trim()) break;
    result.push({...part,text,...(fromEnd ? {startOffset:part.endOffset-text.length} : {endOffset:part.startOffset+text.length})});
    remaining -= points.length;
    if (remaining <= 0) break;
  }
  if (fromEnd) result.reverse();
  return selectionFromParts(result);
}

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
export function mergeContinuousSelections(left: ReadingSelection, right: ReadingSelection, paragraphs: readonly AnchorParagraph[]): ReadingSelection | null {
  const parts = [...selectionParts(left), ...selectionParts(right)].sort((a,b)=>paragraphs.findIndex(p=>p.id===a.paragraphId)-paragraphs.findIndex(p=>p.id===b.paragraphId)||a.startOffset-b.startOffset);
  const merged: ReadingSelectionPart[] = [];
  for (const part of parts) {
    const previous = merged.at(-1);
    if (previous?.paragraphId === part.paragraphId) {
      if (previous.endOffset !== part.startOffset) return null;
      previous.text += part.text; previous.endOffset = part.endOffset;
    } else merged.push({...part});
  }
  const result = selectionFromParts(merged);
  return selectionMatchesParagraphs(result, paragraphs) && countReadingCharacters(result.text) <= MAX_READING_SELECTION ? result : null;
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
export function readReadingSelection(selection: Selection | null, container: HTMLElement, onLimit?: () => void): ReadingSelection | null {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
  const parts: ReadingSelectionPart[] = [];
  const elements = Array.from(container.querySelectorAll<HTMLElement>("p[data-paragraph-id]"));
  for (const element of elements) {
    if (!range.intersectsNode(element)) continue;
    const partRange = range.cloneRange();
    if (!element.contains(range.startContainer)) partRange.setStart(element,0);
    if (!element.contains(range.endContainer)) partRange.setEnd(element,element.childNodes.length);
    const prefix = range.cloneRange(); prefix.selectNodeContents(element); prefix.setEnd(partRange.startContainer,partRange.startOffset);
    const raw = plainText(partRange.cloneContents()); const text = raw.trim(); if (!text) continue;
    const startOffset = Number(element.dataset.sourceStart ?? 0) + plainText(prefix.cloneContents()).length + raw.length-raw.trimStart().length;
    parts.push({paragraphId:element.dataset.paragraphId!,startOffset,endOffset:startOffset+text.length,text});
  }
  if (!parts.length) return null;
  const full = selectionFromParts(parts);
  if(plainText(range.cloneContents()).replace(/\s/gu,"")!==full.text.replace(/\s/gu,""))return null;
  const fromEnd = selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset;
  const capped = capReadingSelection(full, fromEnd);
  if (capped !== full) {
    const cappedParts = selectionParts(capped), first=cappedParts[0], last=cappedParts[cappedParts.length-1];
    const locate = (part: ReadingSelectionPart, offset: number) => {
      const element = elements.find(item=>item.dataset.paragraphId===part.paragraphId && offset>=Number(item.dataset.sourceStart??0) && offset<=Number(item.dataset.sourceStart??0)+plainText(elementFragment(item)).length);
      if (!element) return null;
      let remaining=offset-Number(element.dataset.sourceStart??0);
      const walker=element.ownerDocument.createTreeWalker(element,4);
      for(let node=walker.nextNode();node;node=walker.nextNode()) {
        if(node.parentElement?.closest("[data-reader-decoration], button, [role='dialog'], [role='tooltip']"))continue;
        if(remaining <= (node.nodeValue?.length??0))return {node,offset:remaining};
        remaining-=node.nodeValue?.length??0;
      }
      return null;
    };
    const start=locate(first,first.startOffset), end=locate(last,last.endOffset);
    if(!start||!end)return null;
    selection.setBaseAndExtent(fromEnd?end.node:start.node,fromEnd?end.offset:start.offset,fromEnd?start.node:end.node,fromEnd?start.offset:end.offset);
    onLimit?.();
  }
  return capped;
}
function elementFragment(element: Element): DocumentFragment { const range=element.ownerDocument.createRange();range.selectNodeContents(element);return range.cloneContents(); }
