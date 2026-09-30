import { segmentAnnotatedText, type AnnotationSlice } from "./annotations";

/** WHY：按当前页的阅读顺序去重，不改字典或选区，返回本页允许高亮/交互的位置；同一概念被标注边界切开时保留整词高亮。 */
export function pageConceptHighlights(slices: readonly AnnotationSlice[]): ReadonlyMap<string, ReadonlySet<number>> {
  const seen = new Set<string>();
  const result = new Map<string, Set<number>>();
  for (const slice of slices) {
    const starts = result.get(slice.paragraphId) ?? new Set<number>();
    result.set(slice.paragraphId, starts);
    let previous: ReturnType<typeof segmentAnnotatedText>[number]["concept"];
    let highlighted = false;
    for (const segment of segmentAnnotatedText(slice)) {
      if (!segment.concept) { previous = undefined; highlighted = false; continue; }
      if (segment.concept !== previous) {
        const key = JSON.stringify([slice.paragraphId, segment.concept.name]);
        highlighted = !seen.has(key);
        seen.add(key);
      }
      if (highlighted) starts.add(segment.startOffset);
      previous = segment.concept;
    }
  }
  return result;
}
