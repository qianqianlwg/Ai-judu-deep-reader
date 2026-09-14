import type { PaginatedParagraph, ReadingPage } from "./pagination";

export type PageMeasure = (paragraphs: readonly PaginatedParagraph[], heading?: string) => number;
export type MeasureOptions = {
  height: number;
  measure: PageMeasure;
  signal?: AbortSignal;
  yieldControl?: () => Promise<void>;
};

// WHY：锚点统一用 DOM Range / JS 字符串的 UTF-16 偏移，不能混用 Array.from 的码点位置。
function safeBoundary(text: string, offset: number): number {
  if (offset > 0 && offset < text.length && /[\uDC00-\uDFFF]/u.test(text[offset]) && /[\uD800-\uDBFF]/u.test(text[offset - 1])) return offset - 1;
  return offset;
}

export async function paginateMeasuredParagraphs(sources: readonly PaginatedParagraph[], options: MeasureOptions): Promise<ReadingPage[]> {
  const pages: ReadingPage[] = [];
  let current: PaginatedParagraph[] = [];
  let chapterId = "";
  let chapterTitle = "";
  let chapterStart = true;
  let checks = 0;
  const height = Math.floor(options.height) - 2;
  if (height < 32) throw new Error("正文区域过小，请扩大窗口或缩小字号。");
  const fits = (parts: PaginatedParagraph[]) => options.measure(parts, chapterStart ? chapterTitle : undefined) <= height;
  const flush = () => {
    if (!current.length) return;
    pages.push({ pageNumber: pages.length + 1, chapterId, chapterTitle, paragraphs: current, isChapterStart: chapterStart });
    current = [];
    chapterStart = false;
  };
  for (const source of sources) {
    options.signal?.throwIfAborted();
    if (source.chapterId !== chapterId) { flush(); chapterId = source.chapterId; chapterTitle = source.chapterTitle; chapterStart = true; }
    let start = 0;
    const base = source.sourceStartOffset ?? 0;
    const fragment = (end: number): PaginatedParagraph => ({ ...source, text: source.text.slice(start, end), sourceStartOffset: base + start, sourceEndOffset: base + end });
    while (start < source.text.length) {
      if (++checks % 24 === 0) { await options.yieldControl?.(); options.signal?.throwIfAborted(); }
      const rest = fragment(source.text.length);
      if (fits([...current, rest])) { current.push(rest); start = source.text.length; continue; }
      // WHY：使用浏览器实测整个页而非平均字宽；中英文、标题换行和段落间距都参与高度计算。
      let low = 0;
      let high = source.text.length - start;
      while (low < high) {
        const length = Math.ceil((low + high) / 2);
        if (fits([...current, fragment(start + length)])) low = length;
        else high = length - 1;
      }
      const end = safeBoundary(source.text, start + low);
      if (end <= start) {
        if (current.length) { flush(); continue; }
        throw new Error("当前字号和窗口无法容纳一行正文，请调整阅读设置。");
      }
      current.push(fragment(end));
      start = end;
      flush();
    }
  }
  flush();
  return pages;
}
