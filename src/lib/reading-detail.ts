export type ReadingDetail = "concise" | "standard" | "detailed";
export const READING_DETAIL_OPTIONS = ["concise", "standard", "detailed"] as const satisfies readonly ReadingDetail[];
export const DEFAULT_READING_DETAIL: ReadingDetail = "standard";
export type ReadingDetailSpec = { label: string; ratio: number; minRatio: number; maxRatio: number; instruction: string };
const SPECS: Record<ReadingDetail, ReadingDetailSpec> = {
  concise: { label: "精简", ratio: 1.2, minRatio: 0.85, maxRatio: 1.5, instruction: "句读文本长度目标约为选文非空白字符数的 1.2 倍，允许大约 0.85–1.5 倍；工具中的 readingText 必须与正文第一部分保持同等长度级别。" },
  standard: { label: "标准", ratio: 1.5, minRatio: 0.85, maxRatio: 1.9, instruction: "句读文本长度目标约为选文非空白字符数的 1.5 倍，允许大约 1.1–1.9 倍；工具中的 readingText 必须与正文第一部分保持同等长度级别。" },
  detailed: { label: "详细", ratio: 2, minRatio: 0.85, maxRatio: 2.5, instruction: "句读文本长度目标约为选文非空白字符数的 2 倍，允许大约 1.5–2.5 倍；工具中的 readingText 必须与正文第一部分保持同等长度级别。" },
};
export function normalizeReadingDetail(value: unknown): ReadingDetail { return value === "concise" || value === "detailed" ? value : DEFAULT_READING_DETAIL; }
export function readingDetailSpec(value: unknown): ReadingDetailSpec { return SPECS[normalizeReadingDetail(value)]; }
export function readingDetailPrompt(value: unknown): string { const spec = readingDetailSpec(value); return `当前句读详细程度：${spec.label}。${spec.instruction}`; }
export function isReadingTextLengthValid(source: string, readingText: string, detail: unknown): boolean {
  const sourceLength = Array.from(source.replace(/\s+/gu, "")).length;
  const resultLength = Array.from(readingText.replace(/\s+/gu, "")).length;
  if (sourceLength === 0 || resultLength === 0) return false;
  const spec = readingDetailSpec(detail);
  const ratio = resultLength / sourceLength;
  return ratio >= spec.minRatio && ratio <= spec.maxRatio;
}
