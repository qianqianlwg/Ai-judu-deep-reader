import { hashText } from "./hash";
import type { ReadingAnchorPart } from "./reading-anchors";

export type ConceptDetail = { name: string; text: string };

export type TextAnnotation = {
  id: string;
  paragraphId: string;
  startOffset: number;
  endOffset: number;
  textHash: string;
  threadId: string;
  messageId?: string;
  kind?: "analysis" | "highlight" | "note" | "favorite";
  markColor?: "yellow" | "green" | "blue" | "pink" | "orange";
  summary: string;
  concepts: string[];
  conceptDetails?: ConceptDetail[];
  createdAt: string;
};

export type AnnotationInput = Omit<TextAnnotation, "id" | "textHash"> & {
  id?: string;
  textHash?: string;
};

export type AnnotationRange = Pick<
  TextAnnotation,
  "paragraphId" | "startOffset" | "endOffset"
>;

export function createAnnotation(
  input: AnnotationInput,
  paragraphText: string,
): TextAnnotation {
  assertAnnotationRange(input, paragraphText);

  const selectedText = paragraphText.slice(input.startOffset, input.endOffset);
  return {
    id: input.id ?? createStableId(input, selectedText),
    paragraphId: input.paragraphId,
    startOffset: input.startOffset,
    endOffset: input.endOffset,
    textHash: input.textHash ?? hashText(selectedText),
    threadId: input.threadId,
    ...(input.messageId ? { messageId: input.messageId } : {}),
    summary: input.summary.trim(),
    concepts: uniqueStrings([...input.concepts, ...(input.conceptDetails ?? []).map((item) => item.name)]),
    ...(input.conceptDetails ? { conceptDetails: annotationConceptDetails(input) } : {}),
    createdAt: input.createdAt,
  };
}

export function annotationKey(annotation: AnnotationRange & Pick<TextAnnotation, "textHash">): string {
  return [
    annotation.paragraphId,
    annotation.startOffset,
    annotation.endOffset,
    annotation.textHash,
  ].join(":");
}

export function dedupeAnnotations(annotations: readonly TextAnnotation[]): TextAnnotation[] {
  const result: TextAnnotation[] = [];
  const seen = new Set<string>();

  for (const annotation of annotations) {
    // WHY：同一选段的不同消息是独立句读历史，不能按范围去重。
    const key = annotation.id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(annotation);
  }

  return result;
}

export type ConceptTextPart = { text: string; isConcept: boolean };

/**
 * 将概念名称限制在原文中真实出现的词语上。
 * WHY：模型返回的概念说明可能是抽象概括，不能因为它属于某条标注就把整段正文当成概念。
 */
export function splitConceptTerms(
  text: string,
  concepts: readonly string[],
): ConceptTextPart[] {
  const terms = uniqueStrings(concepts)
    .filter((term) => term.length > 0 && text.includes(term))
    .sort((left, right) => right.length - left.length);
  const matches: Array<{ start: number; end: number }> = [];

  for (const term of terms) {
    let start = text.indexOf(term);
    while (start >= 0) {
      const end = start + term.length;
      const overlaps = matches.some((match) => start < match.end && match.start < end);
      if (!overlaps) matches.push({ start, end });
      start = text.indexOf(term, start + term.length);
    }
  }

  matches.sort((left, right) => left.start - right.start);
  if (matches.length === 0) return [{ text, isConcept: false }];

  const parts: ConceptTextPart[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) parts.push({ text: text.slice(cursor, match.start), isConcept: false });
    parts.push({ text: text.slice(match.start, match.end), isConcept: true });
    cursor = match.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), isConcept: false });
  return parts;
}

export function annotationContainsOffset(
  annotation: AnnotationRange,
  offset: number,
): boolean {
  return (
    annotation.startOffset <= offset &&
    offset < annotation.endOffset
  );
}

export function findAnnotationAtOffset(
  annotations: readonly TextAnnotation[],
  paragraphId: string,
  offset: number,
): TextAnnotation | undefined {
  return annotations
    .filter((annotation) => annotation.paragraphId === paragraphId)
    .find((annotation) => annotationContainsOffset(annotation, offset));
}

export function findAnnotationsInRange(
  annotations: readonly TextAnnotation[],
  paragraphId: string,
  startOffset: number,
  endOffset: number,
): TextAnnotation[] {
  if (startOffset >= endOffset) return [];

  return annotations.filter(
    (annotation) =>
      annotation.paragraphId === paragraphId &&
      annotation.startOffset < endOffset &&
      startOffset < annotation.endOffset,
  );
}

function assertAnnotationRange(
  input: AnnotationInput,
  paragraphText: string,
): void {
  if (!input.paragraphId.trim()) {
    throw new Error("标注必须绑定段落 ID");
  }
  if (!input.threadId.trim()) {
    throw new Error("标注必须绑定线程 ID");
  }
  if (!Number.isInteger(input.startOffset) || !Number.isInteger(input.endOffset)) {
    throw new Error("标注位置必须是整数");
  }
  if (input.startOffset < 0 || input.endOffset <= input.startOffset) {
    throw new Error("标注范围必须是非空的正向区间");
  }
  if (input.endOffset > paragraphText.length) {
    throw new Error("标注范围不能超出段落文本");
  }
  if (input.textHash !== undefined) {
    const actualHash = hashText(
      paragraphText.slice(input.startOffset, input.endOffset),
    );
    if (input.textHash !== actualHash) {
      throw new Error("标注文本哈希与段落内容不匹配");
    }
  }
}

function createStableId(input: AnnotationInput, selectedText: string): string {
  return `annotation-${hashText(
    [
      input.paragraphId,
      input.startOffset,
      input.endOffset,
      input.threadId,
      hashText(selectedText),
      ...(input.messageId ? [input.messageId] : []),
    ].join("|"),
  ).slice(0, 16)}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function annotationConceptDetails(annotation: Pick<TextAnnotation, "concepts" | "conceptDetails">): ConceptDetail[] {
  const names = uniqueStrings([...annotation.concepts, ...(annotation.conceptDetails ?? []).map((item) => item.name)]);
  return names.map((name) => ({
    name,
    // WHY：旧标注缺少逐词定义时保留空值，展示层只能显示“暂无定义”，不能挪用句读摘要。
    text: uniqueStrings((annotation.conceptDetails ?? []).filter((item) => item.name.trim() === name).map((item) => item.text)).join("\n\n"),
  }));
}

export type AnnotationConcept = { name: string; definitions: ConceptDetail[] };
export type AnnotationSegment = {
  text: string;
  startOffset: number;
  endOffset: number;
  annotations: TextAnnotation[];
  endingAnnotations: TextAnnotation[];
  concept?: AnnotationConcept;
};
export type AnnotationSlice = {
  paragraphId: string;
  text: string;
  annotations: readonly TextAnnotation[];
  sourceStartOffset?: number;
  sourceEndOffset?: number;
  /** 原段落完整文本；用于先匹配整个词，再按分页 UTF-16 范围裁剪。 */
  sourceText?: string;
  bookConcepts?: readonly ConceptDetail[];
  showConcepts: boolean;
};

/** 输入 text 必须是原段落的 UTF-16 slice，不能预先 trim 或替换空白。 */
export function segmentAnnotatedText(input: AnnotationSlice): AnnotationSegment[] {
  const { text, paragraphId } = input;
  const start = input.sourceStartOffset ?? 0;
  const end = input.sourceEndOffset ?? start + text.length;
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(end) || end - start !== text.length) {
    throw new Error("分页标注的 UTF-16 起止位置必须与片段文本长度一致");
  }
  const ranges = findAnnotationsInRange(input.annotations, paragraphId, start, end)
    .filter((item) => Number.isInteger(item.startOffset) && Number.isInteger(item.endOffset) && item.startOffset >= 0 && item.endOffset > item.startOffset);
  if (input.sourceText !== undefined && (end > input.sourceText.length || input.sourceText.slice(start, end) !== text)) {
    throw new Error("分页片段必须与完整原段落的 UTF-16 对应范围一致");
  }
  // WHY：必须先在完整原段落中识别概念，裁剪分页之后再查找会丢失跨页词和最长名称优先级。
  const source = input.sourceText ?? text;
  const sourceOffset = input.sourceText === undefined ? start : 0;
  const concepts = matchParagraphConcepts(input, source, sourceOffset)
    .filter((item) => item.start < end && start < item.end);
  const boundaries = [...new Set([start, end, ...ranges.flatMap((item) => [Math.max(start, item.startOffset), Math.min(end, item.endOffset)]), ...concepts.flatMap((item) => [Math.max(start, item.start), Math.min(end, item.end)])])].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((from, index) => {
    const to = boundaries[index + 1];
    return {
      text: text.slice(from - start, to - start), startOffset: from, endOffset: to,
      annotations: ranges.filter((item) => item.startOffset < to && from < item.endOffset),
      // WHY：图标只属于真实结束点，跨页裁剪的“假末尾”不能伪装成选段结束。
      endingAnnotations: ranges.filter((item) => item.endOffset === to && item.kind !== "highlight").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      concept: concepts.find((item) => item.start <= from && to <= item.end)?.concept,
    };
  });
}


type ConceptMatch = { start: number; end: number; concept: AnnotationConcept };

function matchParagraphConcepts(input: AnnotationSlice, source: string, sourceOffset: number): ConceptMatch[] {
  if (!input.showConcepts) return [];
  const dictionary = new Map<string, ConceptDetail[]>();
  const localDetails = input.annotations
    .filter((annotation) => annotation.paragraphId === input.paragraphId)
    .flatMap(annotationConceptDetails);
  // WHY：本段已有逐词定义排在全书字典之前，字典用于补充；任何路径都不读取整段 summary。
  for (const detail of [...localDetails, ...(input.bookConcepts ?? [])]) {
    const name = detail.name.trim();
    if (!name) continue;
    const text = detail.text.trim();
    const definitions = dictionary.get(name) ?? [];
    if (!definitions.some((item) => item.text === text)) definitions.push({ name, text });
    dictionary.set(name, definitions);
  }
  const candidates: ConceptMatch[] = [];
  for (const [name, definitions] of dictionary) {
    // WHY：复合标签必须整体真实出现才标记，不拆“与/和”等连接词、不猜同义词或抽象口号。
    let offset = source.indexOf(name);
    while (offset !== -1) {
      candidates.push({ start: sourceOffset + offset, end: sourceOffset + offset + name.length, concept: { name, definitions } });
      offset = source.indexOf(name, offset + 1);
    }
  }
  candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const matches: ConceptMatch[] = [];
  for (const candidate of candidates) {
    if (!matches.some((item) => item.start < candidate.end && candidate.start < item.end)) matches.push(candidate);
  }
  return matches;
}

/** WHY：来源回跳高亮不写数据库；全部片段共同展示，避免只把首段当作整次句读。 */
export function sourceSelectionHighlights(parts: readonly ReadingAnchorPart[]): TextAnnotation[] {
  return parts.map(part=>({id:"source-"+part.paragraphId+"-"+part.startOffset,paragraphId:part.paragraphId,startOffset:part.startOffset,endOffset:part.endOffset,textHash:hashText(part.selectedText),threadId:"source-preview",summary:"",concepts:[],kind:"highlight",markColor:"yellow",createdAt:""}));
}
