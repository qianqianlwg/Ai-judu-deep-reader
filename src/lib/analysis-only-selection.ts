import { MAX_READING_SELECTION } from "./reading-detail";
import type { AnalysisOnlySource } from "./analysis-only-source";

type Piece = { text: string; node?: Text; start: number; end: number };
const EXCLUDED = 'script,style,noscript,template,[hidden],[data-reader-decoration],button,[role="dialog"],[role="tooltip"]';
const BLOCKS = "h1,h2,h3,h4,h5,h6,p,div,section,article,header,footer,main,aside,figure,figcaption,pre,li,dt,dd,td,th,caption,blockquote";
function pieces(range: Range, root: HTMLElement): Piece[] {
  const doc = root.ownerDocument, walker = doc.createTreeWalker(root, 5), result: Piece[] = [];
  let previousBlock: Element | null = null;
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current.nodeType === 1) {
      const element=current as Element;
      if(element.tagName.toLowerCase()==="br" && !element.closest(EXCLUDED) && range.intersectsNode(element)) result.push({text:"\n",start:0,end:0});
      continue;
    }
    const node = current as Text, parent = node.parentElement;
    if (!parent || parent.closest(EXCLUDED) || !range.intersectsNode(node)) continue;
    let hidden = false;
    for (let element: Element | null = parent; element; element = element.parentElement) {
      const style = doc.defaultView?.getComputedStyle(element);
      if (style?.display === "none" || style?.visibility === "hidden") { hidden = true; break; }
      if (element === root) break;
    }
    if (hidden) continue;
    const start = range.startContainer === node ? range.startOffset : 0;
    const end = range.endContainer === node ? range.endOffset : node.length;
    if (end <= start) continue;
    // WHY：块边界只用于保留阅读换行，不作为文字接收白名单，也不推断标题或 AI 分块。
    const block = parent.closest(BLOCKS);
    if (result.length && block !== previousBlock) result.push({ text: "\n", start: 0, end: 0 });
    result.push({ node, start, end, text: node.data.slice(start, end) });
    previousBlock = block;
  }
  return result;
}
/** Capture actual selectable text without inventing a source ID or relying on HTML tag support. */
export function readAnalysisOnlySelection(selection: Selection | null | undefined, root: HTMLElement, onLimit?: () => void): AnalysisOnlySource | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  // WHY：只接受阅读区域内的完整范围，不能把聊天框或工具按钮拼进用户的阅读材料。
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  let selected = pieces(range, root), text = selected.map(piece => piece.text).join("").trim();
  if (!text) return null;
  if (Array.from(text).length > MAX_READING_SELECTION) {
    const reverse = selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset;
    const ordered = reverse ? [...selected].reverse() : selected;
    let remaining = MAX_READING_SELECTION;
    let boundary: { node: Text; offset: number } | undefined;
    for (const piece of ordered) {
      const chars = Array.from(piece.text);
      const take = Math.min(remaining, chars.length);
      if (piece.node && take) boundary = { node: piece.node, offset: reverse ? piece.end - chars.slice(chars.length - take).join("").length : piece.start + chars.slice(0, take).join("").length };
      remaining -= take;
      if (!remaining) break;
    }
    if (!boundary) return null;
    const limited = range.cloneRange();
    if (reverse) limited.setStart(boundary.node, boundary.offset); else limited.setEnd(boundary.node, boundary.offset);
    selection.setBaseAndExtent(reverse ? limited.endContainer : limited.startContainer, reverse ? limited.endOffset : limited.startOffset, reverse ? limited.startContainer : limited.endContainer, reverse ? limited.startOffset : limited.endOffset);
    selected = pieces(limited, root); text = selected.map(piece => piece.text).join("").trim();
    onLimit?.();
  }
  return text ? { sourceMode: "analysis-only", text } : null;
}
