export type ReadingSelection = { paragraphId: string; startOffset: number; endOffset: number; text: string };
function paragraphFor(node: Node): HTMLElement | null { return (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("p[data-paragraph-id]") ?? null; }
function plainText(fragment: DocumentFragment): string {
  fragment.querySelectorAll("[data-reader-decoration], button, [role='dialog'], [role='tooltip']").forEach(node => node.remove());
  return fragment.textContent ?? "";
}
export function readReadingSelection(selection: Selection | null, container: HTMLElement): ReadingSelection | null {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0); const start = paragraphFor(range.startContainer); const end = paragraphFor(range.endContainer);
  if (!start || start !== end || !container.contains(start)) return null;
  const paragraphId = start.dataset.paragraphId; if (!paragraphId) return null;
  const prefix = range.cloneRange(); prefix.selectNodeContents(start); prefix.setEnd(range.startContainer, range.startOffset);
  const raw = plainText(range.cloneContents()); const text = raw.trim(); if (!text) return null;
  const startOffset = Number(start.dataset.sourceStart ?? 0) + plainText(prefix.cloneContents()).length + (raw.length - raw.trimStart().length);
  return { paragraphId, startOffset, endOffset:startOffset + text.length, text };
}
