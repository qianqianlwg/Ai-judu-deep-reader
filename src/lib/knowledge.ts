export type KnowledgeDefinition = { name: string; text: string };

export type KnowledgeAnchor = {
  editionId: string;
  chapterId: string;
  paragraphId: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
};

export type KnowledgeRecord = {
  id: string;
  editionId: string;
  annotationId: string | null;
  messageId: string | null;
  threadId: string | null;
  createdAt: string;
  summary: string;
  excerpt: string;
  chapterTitle: string | null;
  anchor: KnowledgeAnchor | null;
  locationReason: string | null;
  concepts: KnowledgeDefinition[];
};

export type KnowledgeConcept = {
  id: string;
  name: string;
  definitions: { text: string; recordIds: string[] }[];
  recordIds: string[];
  updatedAt: string;
};

export type BookKnowledge = {
  editionId: string;
  records: KnowledgeRecord[];
  concepts: KnowledgeConcept[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export function isKnowledgeAnchor(value: unknown): value is KnowledgeAnchor {
  return isRecord(value) && typeof value.editionId === "string"
    && typeof value.chapterId === "string" && typeof value.paragraphId === "string"
    && typeof value.startOffset === "number" && Number.isInteger(value.startOffset)
    && typeof value.endOffset === "number" && Number.isInteger(value.endOffset)
    && value.startOffset >= 0 && value.endOffset > value.startOffset
    && typeof value.selectedText === "string"
    && value.selectedText.length === value.endOffset - value.startOffset;
}

function isKnowledgeRecord(value: unknown): value is KnowledgeRecord {
  return isRecord(value) && typeof value.id === "string" && typeof value.editionId === "string"
    && isNullableString(value.annotationId) && isNullableString(value.messageId)
    && isNullableString(value.threadId) && typeof value.createdAt === "string"
    && typeof value.summary === "string" && typeof value.excerpt === "string"
    && isNullableString(value.chapterTitle) && isNullableString(value.locationReason)
    && (value.anchor === null || isKnowledgeAnchor(value.anchor))
    && Array.isArray(value.concepts) && value.concepts.every((item) =>
      isRecord(item) && typeof item.name === "string" && typeof item.text === "string");
}

function isKnowledgeConcept(value: unknown): value is KnowledgeConcept {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string"
    && typeof value.updatedAt === "string" && isStringArray(value.recordIds)
    && Array.isArray(value.definitions) && value.definitions.every((item) =>
      isRecord(item) && typeof item.text === "string" && isStringArray(item.recordIds));
}

export function isBookKnowledge(value: unknown): value is BookKnowledge {
  if (!isRecord(value) || typeof value.editionId !== "string"
    || !Array.isArray(value.records) || !value.records.every(isKnowledgeRecord)
    || !Array.isArray(value.concepts) || !value.concepts.every(isKnowledgeConcept)) return false;
  const ids = new Set(value.records.map((record) => record.id));
  return ids.size === value.records.length
    && value.records.every((record) => record.editionId === value.editionId
      && (record.anchor === null || record.anchor.editionId === value.editionId))
    && value.concepts.every((concept) => concept.recordIds.every((id) => ids.has(id))
      && concept.definitions.every((definition) =>
        definition.recordIds.every((id) => concept.recordIds.includes(id))));
}

export async function fetchBookKnowledge(
  editionId: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<BookKnowledge> {
  const params = new URLSearchParams({ editionId });
  const response = await fetcher("/api/knowledge?" + params, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("知识卡片读取失败，请重试（" + response.status + "）。");
  const value: unknown = await response.json();
  if (!isBookKnowledge(value) || value.editionId !== editionId) {
    throw new Error("知识卡片数据不完整或不属于当前书籍，请刷新重试。");
  }
  return value;
}

const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase().trim();

export function filterBookKnowledge(data: BookKnowledge, query: string): BookKnowledge {
  const terms = normalize(query).split(/\s+/u).filter(Boolean);
  if (!terms.length) return data;
  const matches = (text: string) => terms.every((term) => normalize(text).includes(term));
  const records = data.records.filter((record) => matches([
    record.summary, record.excerpt, record.chapterTitle ?? "",
    ...record.concepts.flatMap((concept) => [concept.name, concept.text]),
  ].join(" ")));
  const recordIds = new Set(records.map((record) => record.id));
  const concepts = data.concepts.filter((concept) => matches([
    concept.name, ...concept.definitions.map((definition) => definition.text),
  ].join(" ")) || concept.recordIds.some((id) => recordIds.has(id)));
  return { ...data, records, concepts };
}
