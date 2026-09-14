import type { PageMeasure } from "./measured-pagination";

export function readerContentBox(element: HTMLElement): { width: number; height: number } {
  const style = getComputedStyle(element);
  return {
    width: Math.min(650, Math.max(1, element.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0"))),
    height: Math.max(1, element.clientHeight - parseFloat(style.paddingTop || "0") - parseFloat(style.paddingBottom || "0")),
  };
}

export function createReaderMeasurement(width: number, scale: number): { measure: PageMeasure; dispose: () => void } {
  const root = document.createElement("div");
  root.className = "reader-sheet reader-measure-sheet";
  root.setAttribute("aria-hidden", "true");
  root.style.width = width + "px";
  root.style.setProperty("--reading-scale", String(scale));
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
    for (const part of paragraphs) { const p = document.createElement("p"); p.textContent = part.text; root.append(p); }
    return root.getBoundingClientRect().height;
  };
  return { measure, dispose: () => root.remove() };
}
