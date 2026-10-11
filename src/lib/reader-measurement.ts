import type { PageMeasure } from "./measured-pagination";
import type { HistoryMarkerPositions } from "./analysis-history-markers";

export function readerContentBox(element: HTMLElement): { width: number; height: number } {
  const style = getComputedStyle(element);
  return {
    width: Math.min(650, Math.max(1, element.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0"))),
    height: Math.max(1, element.clientHeight - parseFloat(style.paddingTop || "0") - parseFloat(style.paddingBottom || "0")),
  };
}

export function createReaderMeasurement(width: number, scale: number, textStyle: Readonly<Record<string, string | number>> = {}, markerPositions?: HistoryMarkerPositions): { measure: PageMeasure; dispose: () => void } {
  const root = document.createElement("div");
  root.className = "reader-sheet reader-measure-sheet";
  root.setAttribute("aria-hidden", "true");
  root.style.width = width + "px";
  root.style.setProperty("--reading-scale", String(scale));
  for (const [property, value] of Object.entries(textStyle)) {
    if (property.startsWith("--")) root.style.setProperty(property, String(value));
    else root.style.setProperty(property, String(value));
  }
  document.body.append(root);
  // WHY：测量层与可见层共享同一字号、标题和段落样式，且独立于现有分页，不形成 ResizeObserver 反馈环。
  const measure: PageMeasure = (paragraphs, heading) => {
    root.replaceChildren();
    if (heading !== undefined) {
      const title = document.createElement("div"); title.className = "page-heading";
      const small = document.createElement("small"); small.textContent = heading;
      const h1 = document.createElement("h1"); h1.textContent = heading;
      title.append(small, h1); root.append(title);
    }
    for (const part of paragraphs) {
      // WHY：标题与正文共享可追溯块 ID；测量必须使用与可见层相同的标题元素，不能仍按正文行高分页。
      const p = document.createElement(part.kind==="heading" ? "h"+(part.headingLevel??1) : "p");
      if(part.kind==="heading")p.dataset.blockKind="heading";
      const start = part.sourceStartOffset ?? 0;
      const end = start + part.text.length;
      let cursor = 0;
      // WHY：标符占位参与真实行宽测量，避免推开正文后新增的换行溢出页底；原文和 UTF-16 偏移不变。
      for (const position of markerPositions?.get(part.id) ?? []) {
        if (position <= start || position > end) continue;
        const offset = position - start;
        p.append(document.createTextNode(part.text.slice(cursor, offset)));
        const anchor = document.createElement("span"); anchor.className = "judu-history-anchor";
        anchor.setAttribute("data-reader-decoration", ""); p.append(anchor); cursor = offset;
      }
      p.append(document.createTextNode(part.text.slice(cursor))); root.append(p);
    }
    return root.getBoundingClientRect().height;
  };
  return { measure, dispose: () => root.remove() };
}
