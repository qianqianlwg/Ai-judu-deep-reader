import type { ReaderInteraction } from "./reader-interactions";
export const EPUB_HISTORY_SPACER_WIDTH = 22;
export type EpubHistorySpacerDocument = { doc: Document; targets: readonly ReaderInteraction[] };
/** WHY：原版 EPUB 的按钮位于宿主覆盖层，绝对定位不会参与书内排版；在历史终点插入无文本占位，把后续正文向后推开。 */
export function installEpubHistorySpacers(documents: readonly EpubHistorySpacerDocument[]): () => void {
  const inserted: HTMLElement[] = [];
  for (const source of documents) {
    source.doc.querySelectorAll<HTMLElement>("[data-judu-history-spacer]").forEach(node => node.remove());
    for (const target of source.targets) {
      if (target.kind !== "history") continue;
      const range = target.range.cloneRange(); range.collapse(false);
      const spacer = source.doc.createElement("span");
      spacer.setAttribute("data-judu-history-spacer", ""); spacer.setAttribute("data-judu-decoration", ""); spacer.setAttribute("data-reader-decoration", ""); spacer.setAttribute("aria-hidden", "true");
      Object.assign(spacer.style, { display: "inline-block", width: EPUB_HISTORY_SPACER_WIDTH + "px", height: "0px", margin: "0", padding: "0", border: "0", verticalAlign: "baseline", userSelect: "none", pointerEvents: "none" });
      range.insertNode(spacer); inserted.push(spacer);
    }
  }
  return () => { for (const node of inserted) node.remove(); };
}
