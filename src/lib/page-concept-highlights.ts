import { segmentAnnotatedText, type AnnotationSlice } from "./annotations";

/** WHY：同名词不等于同处解释；只按原文位置去重，保留不同句读块与跨页词的入口。 */
export function pageConceptHighlights(slices: readonly AnnotationSlice[]): ReadonlyMap<string, ReadonlySet<number>> {
  const result = new Map<string, Set<number>>();
  for (const slice of slices) {
    const starts = result.get(slice.paragraphId) ?? new Set<number>();
    result.set(slice.paragraphId, starts);
    for (const segment of segmentAnnotatedText(slice)) {
      if (segment.concept) starts.add(segment.startOffset);
    }
  }
  return result;
}
