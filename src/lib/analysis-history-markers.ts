import type { TextAnnotation } from "./annotations";

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
