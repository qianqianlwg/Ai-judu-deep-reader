import { sourceEmphasisRanges,type SourceEmphasis } from "./source-enhancement";
import { getReadingThemeVariables, type ReadingAppearancePreferences } from "./reading-appearance";
import { type TextAnnotation, type ConceptDetail } from "./annotations";
import { rangeForEpubAnchor, type EpubParagraphMap } from "./epub-source-map";
import { buildEpubInteractions, epubRectToHost, clipReaderRect, type ReaderRect } from "./epub-interactions";
export type ConceptPageScope = { bounds(): ReaderRect | null; changes: EventTarget };

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): boolean };
type HighlightWindow = Window & { CSS?: { highlights?: HighlightRegistry }; Highlight?: new (...ranges: Range[]) => unknown };
const COLORS = { yellow: "#ffe36e99", green: "#a6d9ac99", blue: "#9bcbfa99", pink: "#f89eb699", orange: "#ffcd8a99" };
const NAMES = [...Object.keys(COLORS), "analysis", "concept", "enhance-term", "enhance-sentence"].map(name => "judu-" + name);

export function supportsEpubHighlights(doc: Document): boolean {
  const view = doc.defaultView as HighlightWindow | null;
  return Boolean(view?.CSS?.highlights && view.Highlight);
}

export function paintEpubAnnotations(doc: Document, maps: readonly EpubParagraphMap[], annotations: readonly TextAnnotation[], concepts: readonly ConceptDetail[], hints: { enabled: boolean; opacity: number } = { enabled: true, opacity: 0.25 }, page?: ConceptPageScope, appearance?: ReadingAppearancePreferences,sourceMarks:readonly SourceEmphasis[]=[]): () => void {
  const view = doc.defaultView as HighlightWindow | null;
  const registry = view?.CSS?.highlights;
  const Constructor = view?.Highlight;
  const ranges = new Map<string, Range[]>();
  for (const annotation of annotations) {
    const name = annotation.kind && annotation.kind !== "analysis" ? annotation.markColor ?? "yellow" : "analysis";
    // WHY：概念去重只改变黄底与入口，不从已句读范围中挖掉同名词的下横线。
    const intervals = [{ start: annotation.startOffset, end: annotation.endOffset }];
    for (const interval of intervals) {
      const range = rangeForEpubAnchor(maps, annotation.paragraphId, interval.start, interval.end);
      if (range) ranges.set(name, [...(ranges.get(name) ?? []), range]);
    }
  }
  // WHY：重点提示使用独立非侵入图层，不改原文节点；关闭仅清除提示，不删除用户标注。
  if (appearance?.sourceTerms || appearance?.sourceSentences) for (const map of maps) {
    if (map.element.matches('h1,h2,h3,h4,h5,h6')) continue;
    for (const mark of sourceEmphasisRanges(map.paragraph.text,map.paragraph.id,sourceMarks)) {
      if (!(mark.kind === 'term' ? appearance.sourceTerms : appearance.sourceSentences)) continue;
      const range = rangeForEpubAnchor(maps, map.paragraph.id, mark.start, mark.end);
      const name = mark.kind === 'term' ? 'enhance-term' : 'enhance-sentence';
      if (range) ranges.set(name,[...(ranges.get(name)??[]),range]);
    }
  }
  if (!registry || !Constructor) return () => {};
  const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
  style.dataset.juduDecoration = "";
  // WHY：原版沿用 Highlight 图层而不改写 EPUB DOM/CFI，线条透明度由阅读设置控制。
  style.textContent = Object.entries(COLORS).map(([name,color]) => `::highlight(judu-${name}){background:${color};color:inherit}`).join("\n") +
    `\n::highlight(judu-analysis){${hints.enabled ? `text-decoration:underline solid rgba(84,126,119,${Math.min(.35, Math.max(.05, hints.opacity))});text-decoration-thickness:1px;text-underline-offset:.18em;` : ""}}::highlight(judu-concept){background:#fff0a388;}`;
  if (appearance) {
    const colors=getReadingThemeVariables(appearance.theme,appearance.emphasisPalette);
    style.textContent += '\n::highlight(judu-enhance-term){background-color:'+colors['--reading-term-background']+'}::highlight(judu-enhance-sentence){text-decoration:underline solid '+colors['--reading-key-sentence-accent']+';text-decoration-thickness:1px;text-underline-offset:.2em;}';
  }
  doc.head.append(style);
  // WHY：使用独立 Highlight 图层，不插入 span 改写原 EPUB DOM，确保 CFI 和文本节点偏移稳定。
  for (const name of NAMES) registry.delete(name);
  for (const [name, values] of ranges) registry.set("judu-" + name, new Constructor(...values));
  // WHY：同一章可能有多页，必须在翻页/重排后重新按当前可见页计数，不能整章只标一次。
  const candidates = buildEpubInteractions(maps, [], concepts).filter(item => item.kind === "concept");
  const paintConcepts = () => {
    const seen = new Set<string>();
    const selected: Range[] = [];
    const bounds = page?.bounds();
    for (const item of candidates) {
      if (item.kind !== "concept" || seen.has(item.concept.name)) continue;
      if (page && (!bounds || !Array.from(item.range.getClientRects()).some(rect => clipReaderRect(epubRectToHost(doc, rect), bounds)))) continue;
      seen.add(item.concept.name); selected.push(item.range);
    }
    registry.set("judu-concept", new Constructor(...selected));
  };
  paintConcepts();
  let frame: number | undefined;
  const update = () => {
    if (frame !== undefined) view?.cancelAnimationFrame(frame);
    frame = view?.requestAnimationFrame(() => { frame = undefined; paintConcepts(); });
  };
  page?.changes.addEventListener("relocate", update);
  view?.addEventListener("resize", update);
  return () => { page?.changes.removeEventListener("relocate", update); view?.removeEventListener("resize", update); if (frame !== undefined) view?.cancelAnimationFrame(frame); style.remove(); for (const name of NAMES) registry.delete(name); };
}
