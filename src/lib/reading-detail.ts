export type ReadingDetail = "concise" | "standard" | "detailed";
export const READING_DETAIL_OPTIONS = ["concise", "standard", "detailed"] as const;
export const DEFAULT_READING_DETAIL: ReadingDetail = "standard";
export const MIN_READING_SELECTION = 10;
export const MAX_READING_SELECTION = 1000;
const SPECS = { concise: { label: "精简", ratio: 1.2 }, standard: { label: "标准", ratio: 1.5 }, detailed: { label: "详细", ratio: 2 } } as const;
export function normalizeReadingDetail(value: unknown): ReadingDetail { return value === "concise" || value === "detailed" ? value : "standard"; }
export function readingDetailSpec(value: unknown) { return SPECS[normalizeReadingDetail(value)]; }
// WHY：界面、提示词、工具与可见正文使用同一个 Unicode 字符计数，保留正文内部空格，emoji 不计成两个字。
export function countReadingCharacters(text: string): number { return Array.from(text.trim()).length; }
export function readingAnswerBudget(source: string, detail: unknown) {
  const spec = readingDetailSpec(detail), sourceCharacters = countReadingCharacters(source);
  const targetCharacters = Math.round(sourceCharacters * spec.ratio);
  return { sourceCharacters, targetCharacters, maxCharacters: Math.ceil(targetCharacters * 1.2), detail: normalizeReadingDetail(detail) };
}
export function readingDetailPrompt(value: unknown, source = ""): string {
  const spec = readingDetailSpec(value), budget = readingAnswerBudget(source, value);
  const target = source ? "选文" + budget.sourceCharacters + "字，回答目标约" + budget.targetCharacters + "字，上限" + budget.maxCharacters + "字。" : "";
  return "当前详细程度：" + spec.label + "，原文与整个可见回答的目标比例约为1:" + spec.ratio + "。" + target + "此预算包含全部段落、补充解释和小结，不仅是开头。save_reading_analysis 的 readingText 必须保存完整可见回答；readingText、summary、breakdown、concepts、context、uncertainty 等解释文字合计也不能超过同一上限。不要重复抄录原文，不为凑字数添话；可短于目标但必须说明原意。";
}
export function isReadingTextLengthValid(source: string, text: string, detail: unknown): boolean {
  return countReadingCharacters(text) > 0 && countReadingCharacters(text) <= readingAnswerBudget(source, detail).maxCharacters;
}
export function readingSelectionError(text: string): string | null {
  const count = countReadingCharacters(text);
  return count < MIN_READING_SELECTION || count > MAX_READING_SELECTION ? "句读请选择10–1000字原文，当前" + count + "字。" : null;
}
