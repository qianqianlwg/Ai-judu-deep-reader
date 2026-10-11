export type ReadingDetail = "gist" | "concise" | "standard" | "detailed" | "expanded";
export const READING_DETAIL_OPTIONS = ["gist", "concise", "standard", "detailed", "expanded"] as const;
export const DEFAULT_READING_DETAIL: ReadingDetail = "standard";
export const MIN_READING_SELECTION = 10;
export const MAX_READING_SELECTION = 3000;
const SPECS = { gist: { label: "大意", ratio: 0.2, min: 0.15, max: 0.30 }, concise: { label: "简短", ratio: 0.5, min: 0.40, max: 0.65 }, standard: { label: "正常", ratio: 1, min: 0.80, max: 1.10 }, detailed: { label: "详细", ratio: 1.5, min: 1.30, max: 1.70 }, expanded: { label: "展开", ratio: 2, min: 1.80, max: 2.40 } } as const;
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
export function readingDetailPrompt(value: unknown, source = ''): string {
  const spec = readingDetailSpec(value);
  const sourceCharacters = countReadingCharacters(source);
  const target = source ? '对应原文' + sourceCharacters + '字，释读正文默认约' + Math.round(sourceCharacters * spec.min) + '–' + Math.round(sourceCharacters * spec.max) + '字。' : '';
  return '统一回复长度标准：gist/大意15%–30%，只留核心意思；concise/简短40%–65%，保留必要关系；standard/正常80%–110%，完整忠实解释；detailed/详细130%–170%，补充关键关系和必要背景；expanded/展开180%–240%，补充有帮助的例子、区别和推导。当前长度：' + spec.label + '（' + Math.round(spec.min*100) + '%–' + Math.round(spec.max*100) + '%）。' + target + '比例按每句或每块对应原文与释读正文计算，不计标题、原文引用和工具元数据；小结不重复计入逐句比例。短句以说清原意为先，不为达标凑字。它是默认表达目标，不是拒绝保存或中断生成的硬限制；本轮用户明确要求优先。解读方式独立决定讲解深度，不用小白/深入替代长短档位。';
}
export function readingSelectionError(text: string): string | null {
  const count = countReadingCharacters(text);
  return count < MIN_READING_SELECTION || count > MAX_READING_SELECTION ? `句读请选择${MIN_READING_SELECTION}–${MAX_READING_SELECTION}字符原文，当前${count}字符。` : null;
}
