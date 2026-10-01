import type { ConceptDetail, TextAnnotation } from "./annotations";

export type ConceptLocation = { paragraphId: string; startOffset: number; endOffset: number };
export type ConceptReadingVersion = {
  unitId: string;
  annotationId: string;
  threadId: string;
  paragraphId: string;
  startOffset: number;
  endOffset: number;
  createdAt: string;
  definitions: ConceptDetail[];
};
export type ContextualConcept = {
  name: string;
  /** 默认只展示此处最新句读的解释，不混入其他句读块的同名词。 */
  definitions: ConceptDetail[];
  location?: ConceptLocation;
  /** 旧数据/独立浮窗允许没有来源信息；真实原文匹配始终保留来源。 */
  versions?: readonly ConceptReadingVersion[];
};

export function conceptReadingVersion(annotation: TextAnnotation, detail: ConceptDetail): ConceptReadingVersion {
  return {
    unitId: annotation.messageId ?? annotation.id,
    annotationId: annotation.id,
    threadId: annotation.threadId,
    paragraphId: annotation.paragraphId,
    startOffset: annotation.startOffset,
    endOffset: annotation.endOffset,
    createdAt: annotation.createdAt,
    definitions: [{ name: detail.name.trim(), text: detail.text.trim() }],
  };
}

export function contextualConcept(name: string, location: ConceptLocation, versions: readonly ConceptReadingVersion[]): ContextualConcept {
  // WHY：按物理词位聚合重读版本，不按同名词聚合全书；相同解释的不同句读仍保留各自来源。
  const unique = new Map(versions.map(version => [version.annotationId, version]));
  const ordered = [...unique.values()].sort((a, b) => {
    const aTime = Date.parse(a.createdAt), bTime = Date.parse(b.createdAt);
    const byTime = Number.isFinite(aTime) && Number.isFinite(bTime) ? bTime - aTime : b.createdAt.localeCompare(a.createdAt);
    // WHY：同毫秒的结果使用稳定来源 ID 打破平局，不能让接口返回顺序决定当前解释。
    return byTime || b.unitId.localeCompare(a.unitId) || b.annotationId.localeCompare(a.annotationId);
  });
  return { name, location, versions: ordered, definitions: ordered[0]?.definitions ?? [] };
}

export function conceptLocationKey(name: string, location: ConceptLocation): string {
  // WHY：同段、同名但不同原文位置是不同入口；重新句读不能改变原文位置身份。
  return JSON.stringify([location.paragraphId, location.startOffset, location.endOffset, name]);
}
