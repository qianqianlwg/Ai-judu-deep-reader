import type { TextAnnotation, ConceptDetail } from "./annotations";
import { rangeForEpubAnchor, type EpubParagraphMap } from "./epub-source-map";

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): boolean };
type HighlightWindow = Window & { CSS?: { highlights?: HighlightRegistry }; Highlight?: new (...ranges: Range[]) => unknown };
const COLORS = { yellow: "#ffe36e99", green: "#a6d9ac99", blue: "#9bcbfa99", pink: "#f89eb699", orange: "#ffcd8a99" };
const NAMES = [...Object.keys(COLORS), "analysis", "concept"].map(name => "judu-" + name);

export function supportsEpubHighlights(doc: Document): boolean {
  const view = doc.defaultView as HighlightWindow | null;
  return Boolean(view?.CSS?.highlights && view.Highlight);
}

export function paintEpubAnnotations(doc: Document, maps: readonly EpubParagraphMap[], annotations: readonly TextAnnotation[], concepts: readonly ConceptDetail[]): () => void {
  const view = doc.defaultView as HighlightWindow | null;
  const registry = view?.CSS?.highlights;
  const Constructor = view?.Highlight;
  const ranges = new Map<string, Range[]>();
  for (const annotation of annotations) {
    const range = rangeForEpubAnchor(maps, annotation.paragraphId, annotation.startOffset, annotation.endOffset);
    if (!range) continue;
    const name = annotation.kind && annotation.kind !== "analysis" ? annotation.markColor ?? "yellow" : "analysis";
    ranges.set(name, [...(ranges.get(name) ?? []), range]);
  }
  for (const map of maps) for (const concept of concepts) {
    if (!concept.name) continue;
    let at = map.paragraph.text.indexOf(concept.name);
    while (at >= 0) {
      const range = rangeForEpubAnchor(maps, map.paragraph.id, at, at + concept.name.length);
      if (range) ranges.set("concept", [...(ranges.get("concept") ?? []), range]);
      at = map.paragraph.text.indexOf(concept.name, at + concept.name.length);
    }
  }
  if (!registry || !Constructor) return () => {};
  const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
  style.dataset.juduDecoration = "";
  style.textContent = Object.entries(COLORS).map(([name,color]) => `::highlight(judu-${name}){background:${color};color:inherit}`).join("\n") + "\n::highlight(judu-analysis){text-decoration:underline dashed #4d7971;}::highlight(judu-concept){background:#fff0a388;text-decoration:underline #d3b837;}";
  doc.head.append(style);
  // WHY：使用独立 Highlight 图层，不插入 span 改写原 EPUB DOM，确保 CFI 和文本节点偏移稳定。
  for (const name of NAMES) registry.delete(name);
  for (const [name, values] of ranges) registry.set("judu-" + name, new Constructor(...values));
  return () => { style.remove(); for (const name of NAMES) registry.delete(name); };
}
