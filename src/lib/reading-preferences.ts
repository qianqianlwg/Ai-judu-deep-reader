import { normalizeReadingDetail, type ReadingDetail } from "./reading-detail";

export const READING_DIFFICULTY_OPTIONS = ["accessible", "normal", "advanced"] as const;
export type ReadingDifficulty = typeof READING_DIFFICULTY_OPTIONS[number];
export type ReadingPreferences = { difficulty: ReadingDifficulty; detail: ReadingDetail };
export const DEFAULT_READING_PREFERENCES: ReadingPreferences = { difficulty: "normal", detail: "standard" };
export const READING_DIFFICULTY_LABELS = { accessible: "通俗", normal: "正常", advanced: "深入" } as const;
export function normalizeReadingDifficulty(value: unknown): ReadingDifficulty {
  return value === "accessible" || value === "advanced" ? value : "normal";
}
export function readingDifficultyPrompt(value: unknown): string {
  const difficulty = normalizeReadingDifficulty(value);
  const guidance = { accessible: "面向初学者，用日常语言解释，必要术语随文说明；不假定读者已有背景知识。", normal: "易懂与准确兼顾，保留必要术语。", advanced: "重视概念边界、论证关系与容易混淆的区别，不堆砌专业词。" };
  return "当前解读方式：" + READING_DIFFICULTY_LABELS[difficulty] + "。" + guidance[difficulty] + "解读方式与回复长度独立；通俗不等于简短，深入不等于冗长。";
}
export function readReadingPreferences(storage: Pick<Storage, "getItem">, bookId: string): ReadingPreferences {
  if (!bookId) return { ...DEFAULT_READING_PREFERENCES };
  const raw = storage.getItem("judu:reading-preferences:" + bookId);
  if (!raw) return { ...DEFAULT_READING_PREFERENCES };
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("本书解读设置格式无效");
  const record = value as Record<string, unknown>;
  return { difficulty: normalizeReadingDifficulty(record.difficulty), detail: normalizeReadingDetail(record.detail) };
}
export function writeReadingPreferences(storage: Pick<Storage, "setItem">, bookId: string, value: ReadingPreferences): void {
  if (!bookId) throw new Error("请先打开一本书");
  // WHY：按书而非会话或版本保存，切书不串用；请求另存快照，不修改正在生成的回复。
  storage.setItem("judu:reading-preferences:" + bookId, JSON.stringify(value));
}
