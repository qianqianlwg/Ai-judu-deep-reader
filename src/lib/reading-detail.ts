export type ReadingDetail = "gist" | "concise" | "standard" | "detailed" | "expanded";
export const READING_DETAIL_OPTIONS = ["gist", "concise", "standard", "detailed", "expanded"] as const;
export const DEFAULT_READING_DETAIL: ReadingDetail = "standard";
export const MIN_READING_SELECTION = 10;
export const MAX_READING_SELECTION = 3000;
const SPECS = { gist: { label: "大意", ratio: 0.2 }, concise: { label: "简短", ratio: 0.5 }, standard: { label: "正常", ratio: 1 }, detailed: { label: "详细", ratio: 1.5 }, expanded: { label: "展开", ratio: 2 } } as const;
export function normalizeReadingDetail(value: unknown): ReadingDetail { return value === "gist" || value === "concise" || value === "detailed" || value === "expanded" ? value : "standard"; }
export function readingDetailSpec(value: unknown) { return SPECS[normalizeReadingDetail(value)]; }
// WHY：界面、提示词、工具与可见正文使用同一个 Unicode 字符计数，保留正文内部空格，emoji 不计成两个字。
export function countReadingCharacters(text: string): number { return Array.from(text.trim()).length; }
export function readingAnswerBudget(source: string, detail: unknown) {
  const spec = readingDetailSpec(detail), sourceCharacters = countReadingCharacters(source);
  // WHY：短选文不机械压成几个字，给核心意思留出最低表达空间。
  const targetCharacters = Math.max(40, Math.round(sourceCharacters * spec.ratio));
  return { sourceCharacters, targetCharacters, detail: normalizeReadingDetail(detail) };
}
export function readingDetailPrompt(value: unknown, source = ""): string {
  const spec = readingDetailSpec(value), budget = readingAnswerBudget(source, value);
  const target = source ? "选文" + budget.sourceCharacters + "字，回答目标约" + budget.targetCharacters + "字。" : "";
  return "当前回复长度：" + spec.label + "，原文与整个可见回答的目标比例约为1:" + spec.ratio + "。" + target + "长度只是写作目标，不作为中断生成或拒绝保存的硬上限。目标考虑完整回答，而不仅是开头。save_reading_analysis 的 readingText 应对应完整可见释读；summary、breakdown、concepts、context、uncertainty 等仅记录确有价值且不重复的信息。不要重复抄录原文，不为凑字数添话；可短于目标但必须说明原意。大意档只保留核心意思，可省略次要细节，不能歪曲原意。";
}
export function readingSelectionError(text: string): string | null {
  const count = countReadingCharacters(text);
  return count < MIN_READING_SELECTION || count > MAX_READING_SELECTION ? `句读请选择${MIN_READING_SELECTION}–${MAX_READING_SELECTION}字符原文，当前${count}字符。` : null;
}
