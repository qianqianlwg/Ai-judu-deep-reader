import { segmentAnnotatedText, type TextAnnotation } from "./annotations";

export type HistoryMarkerPositions = ReadonlyMap<string, readonly number[]>;

/** WHY：同一回复的多段来源只在整次选文终点保留入口；用全书段落顺序，不让分页片段伪装成结束点。 */
export function analysisHistoryMarkerIds(annotations: readonly TextAnnotation[], paragraphIds: readonly string[]): ReadonlySet<string> {
  const order = new Map(paragraphIds.map((id, index) => [id, index]));
  const ends = new Map<string, TextAnnotation>();
  const result = new Set<string>();
  for (const annotation of annotations) {
    if (annotation.kind && annotation.kind !== "analysis") { result.add(annotation.id); continue; }
    // WHY：旧标注没有 messageId 时无法证明属于同一次句读，不按 threadId 猜合并，更不删除历史数据。
    if (!annotation.messageId) { result.add(annotation.id); continue; }
    const key = JSON.stringify([annotation.threadId, annotation.messageId]);
    const previous = ends.get(key);
    const position = order.get(annotation.paragraphId);
    if (position === undefined) continue;
    const previousPosition = previous ? order.get(previous.paragraphId) : undefined;
    if (!previous || previousPosition === undefined || position > previousPosition || (position === previousPosition && annotation.endOffset > previous.endOffset)) ends.set(key, annotation);
  }
  for (const annotation of ends.values()) result.add(annotation.id);
  return result;
}

/** WHY：分页仅计入实际可见历史入口的空占位，与正文组件使用同一终点分组和范围校验。 */
export function analysisHistoryMarkerPositions(annotations: readonly TextAnnotation[], paragraphs: readonly { id: string; text: string }[], markerIds = analysisHistoryMarkerIds(annotations, paragraphs.map(paragraph => paragraph.id))): HistoryMarkerPositions {
  const grouped = new Map<string, TextAnnotation[]>();
  for (const annotation of annotations) {
    if (!markerIds.has(annotation.id) || annotation.kind === "highlight") continue;
    const items = grouped.get(annotation.paragraphId) ?? [];
    items.push(annotation); grouped.set(annotation.paragraphId, items);
  }
  const result = new Map<string, readonly number[]>();
  for (const paragraph of paragraphs) {
    const items = grouped.get(paragraph.id);
    if (!items?.length) continue;
    const segments = segmentAnnotatedText({ paragraphId: paragraph.id, text: paragraph.text, sourceText: paragraph.text, annotations: items, showConcepts: false });
    const positions = segments.filter(segment => segment.endingAnnotations.some(annotation => markerIds.has(annotation.id))).map(segment => segment.endOffset);
    if (positions.length) result.set(paragraph.id, positions);
  }
  return result;
}
