import { isAnalysis, type Analysis } from "./chat-stream";
import { anchorParts, joinAnchorText, readReadingAnchor, type ReadingAnchor } from "./reading-anchors";
import { hashText } from "./hash";
import type { BookKnowledge, KnowledgeAnchor, KnowledgeConcept, KnowledgeDefinition, KnowledgeRecord } from "./knowledge";

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): string | null => typeof value === "string" ? value : null;
const nonempty = (value: unknown): string | null => string(value)?.trim() || null;
const NO_ANCHOR = "历史记录未保存准确的文本锚点，暂不支持原文跳转。";
const INVALID_ANCHOR = "文本锚点与当前版本原文不一致，暂不支持原文跳转。";

function parseJson(value: unknown, id: string, label: string): unknown {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    console.warn("知识记录字段不是 JSON 字符串", { id, label });
    return null;
  }
  try { return JSON.parse(value) as unknown; }
  catch (error: unknown) {
    console.warn("知识记录 JSON 无法解析", { id, label, error: error instanceof Error ? error.name : "UnknownError" });
    return null;
  }
}

function analysisFrom(row: Row): (Analysis & { anchor?: unknown }) | null {
  const value = parseJson(row.structured_output, string(row.id) ?? "", "structured_output");
  // WHY：只接收成功保存的结构化句读，不从聊天正文、引用或线程的最后选文反推一次句读。
  if (!isRow(value) || value.kind === "chat" || value.mode === "chat" || !isAnalysis(value)) return null;
  // WHY：新句读以 readingText 为正文，summary 可为空；不能把已保存的纯释读误丢弃为普通聊天。
  return value.readingText?.trim() || value.summary.trim() || value.breakdown.length || value.concepts.length ? value : null;
}

function validateAnchor(value: unknown, row: Row, editionId: string): KnowledgeAnchor | null {
  if (!isRow(value) || row.edition_id !== editionId || row.source_edition_id !== editionId
    || typeof value.paragraphId !== "string" || value.paragraphId !== row.paragraph_id
    || typeof row.chapter_id !== "string" || typeof row.paragraph_text !== "string"
    || typeof value.startOffset !== "number" || !Number.isSafeInteger(value.startOffset)
    || typeof value.endOffset !== "number" || !Number.isSafeInteger(value.endOffset)
    || value.startOffset < 0 || value.endOffset <= value.startOffset
    || value.endOffset > row.paragraph_text.length || typeof value.selectedText !== "string"
    || row.paragraph_text.slice(value.startOffset, value.endOffset) !== value.selectedText) return null;
  return { editionId, chapterId: row.chapter_id, paragraphId: value.paragraphId,
    startOffset: value.startOffset, endOffset: value.endOffset, selectedText: value.selectedText };
}

function definitions(values: readonly KnowledgeDefinition[]): KnowledgeDefinition[] {
  const result: KnowledgeDefinition[] = [];
  for (const value of values) {
    const name = value.name.normalize("NFC").trim();
    const text = value.text.trim();
    if (name && !result.some((item) => item.name === name && item.text === text)) result.push({ name, text });
  }
  return result.filter((item) => item.text || !result.some((other) => other.name === item.name && other.text));
}

function messageRecord(value: unknown, editionId: string, verifyMulti?: (anchor: ReadingAnchor) => boolean): KnowledgeRecord | null {
  if (!isRow(value) || value.edition_id !== editionId || value.role !== "assistant"
    || value.status !== "completed" || !nonempty(value.id) || !nonempty(value.thread_id)
    || !nonempty(value.created_at)) return null;
  const analysis = analysisFrom(value);
  if (!analysis) return null;
  const source = readReadingAnchor(analysis.anchor);
  const first = validateAnchor(analysis.anchor, value, editionId);
  const anchor = first && source && (!source.fragments || verifyMulti?.(source)) ? {...first,...source} : null;
  const excerpt = source ? joinAnchorText(anchorParts(source)) : isRow(analysis.anchor) ? string(analysis.anchor.selectedText) ?? "" : "";
  return { id: "message:" + value.id, editionId, annotationId: null,
    messageId: nonempty(value.id), threadId: nonempty(value.thread_id),
    createdAt: String(value.created_at), summary: analysis.summary.trim() || analysis.readingText?.trim() || "",
    excerpt: anchor ? joinAnchorText(anchorParts(anchor)) : excerpt, chapterTitle: string(value.chapter_title), anchor,
    locationReason: anchor ? null : analysis.anchor ? INVALID_ANCHOR : NO_ANCHOR,
    concepts: definitions(analysis.concepts) };
}

function annotationConcepts(row: Row): KnowledgeDefinition[] {
  const id = string(row.id) ?? "";
  const details = parseJson(row.concept_details, id, "concept_details");
  const names = parseJson(row.concepts, id, "concepts");
  const validDetails = Array.isArray(details) ? details.filter((item): item is KnowledgeDefinition =>
    isRow(item) && typeof item.name === "string" && typeof item.text === "string") : [];
  const validNames = Array.isArray(names) ? names.filter((name): name is string => typeof name === "string") : [];
  return definitions([...validDetails, ...validNames.map((name) => ({ name, text: "" }))]);
}

function annotationRecord(value: unknown, editionId: string): KnowledgeRecord | null {
  if (!isRow(value) || value.edition_id !== editionId || !nonempty(value.id)
    || !nonempty(value.summary) || !nonempty(value.created_at)) return null;
  const excerpt = typeof value.paragraph_text === "string" && typeof value.start_offset === "number"
    && typeof value.end_offset === "number" ? value.paragraph_text.slice(value.start_offset, value.end_offset) : "";
  const candidate = validateAnchor({ paragraphId: value.paragraph_id, startOffset: value.start_offset,
    endOffset: value.end_offset, selectedText: excerpt }, value, editionId);
  // WHY：标注保存的是选文哈希；哈希失配时不把新文本冒充旧选文，也不猜位置。
  const anchor = candidate && value.text_hash === hashText(candidate.selectedText) ? candidate : null;
  return { id: "annotation:" + value.id, editionId, annotationId: String(value.id),
    messageId: null, threadId: nonempty(value.thread_id), createdAt: String(value.created_at),
    summary: String(value.summary).trim(), excerpt: anchor?.selectedText ?? "",
    chapterTitle: string(value.chapter_title), anchor, locationReason: anchor ? null : INVALID_ANCHOR,
    concepts: annotationConcepts(value) };
}

function conceptsFor(records: KnowledgeRecord[]): KnowledgeConcept[] {
  const map = new Map<string, KnowledgeConcept>();
  for (const record of records) {
    for (const item of record.concepts) {
      let concept = map.get(item.name);
      if (!concept) {
        concept = { id: "concept:" + item.name, name: item.name, definitions: [], recordIds: [], updatedAt: record.createdAt };
        map.set(item.name, concept);
      }
      if (!concept.recordIds.includes(record.id)) concept.recordIds.push(record.id);
      if (!item.text) continue;
      let definition = concept.definitions.find((entry) => entry.text === item.text);
      if (!definition) { definition = { text: item.text, recordIds: [] }; concept.definitions.push(definition); }
      if (!definition.recordIds.includes(record.id)) definition.recordIds.push(record.id);
    }
  }
  return [...map.values()];
}

export function buildBookKnowledge(editionId: string, annotationRows: unknown[], messageRows: unknown[], verifyMulti?: (anchor: ReadingAnchor) => boolean): BookKnowledge {
  const records = new Map<string, KnowledgeRecord>();
  const invalidMultiSources = new Set<string>();
  for (const row of messageRows) {
    const record = messageRecord(row, editionId, verifyMulti);
    if (record) {
      records.set(record.id,record);
      const saved=isRow(row) ? analysisFrom(row) : null;
      if(!record.anchor && isRow(saved?.anchor) && (saved.anchor.version===2 || saved.anchor.fragments!==undefined))invalidMultiSources.add(record.id);
    }
  }
  for (const row of annotationRows) {
    const annotation = annotationRecord(row, editionId);
    if (!annotation || !isRow(row)) continue;
    const messageId = nonempty(row.stored_message_id);
    if (!messageId) { records.set(annotation.id, annotation); continue; }
    const message = records.get("message:" + messageId);
    // WHY：只用显式消息外键合并；内容相似、时间接近、同线程都不能证明是同一次句读。
    if (!message || row.message_id !== messageId || message.threadId !== annotation.threadId) {
      console.warn("忽略未关联有效句读消息的标注", { annotationId: annotation.annotationId });
      continue;
    }
    // WHY：多段来源任何一段失效都不能借首段标注降级为“已验证全选区”。
    const anchor = message.anchor ?? (invalidMultiSources.has(message.id) ? null : annotation.anchor);
    records.set(message.id, { ...message, annotationId: annotation.annotationId, anchor,
      excerpt: anchor ? joinAnchorText(anchorParts(anchor)) : (message.excerpt || annotation.excerpt),
      chapterTitle: message.chapterTitle ?? annotation.chapterTitle,
      locationReason: anchor ? null : message.locationReason,
      concepts: definitions([...message.concepts, ...annotation.concepts]) });
  }
  const sorted = [...records.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  return { editionId, records: sorted, concepts: conceptsFor(sorted) };
}
