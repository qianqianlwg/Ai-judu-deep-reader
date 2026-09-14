export type PaginatedParagraph = {
  id: string;
  text: string;
  chapterId: string;
  chapterTitle: string;
  fragmentIndex?: number;
  fragmentCount?: number;
  /** 原始段落中的字符起点；普通段落默认为 0。 */
  sourceStartOffset?: number;
  /** 原始段落中的字符终点（不包含）。 */
  sourceEndOffset?: number;
};

export type ReadingPage = {
  pageNumber: number;
  chapterId: string;
  chapterTitle: string;
  paragraphs: PaginatedParagraph[];
  isChapterStart: boolean;
};

export type PaginationOptions = {
  availableWidth: number;
  availableHeight: number;
  charWidth?: number;
  lineHeight?: number;
  paragraphGap?: number;
  topReserve?: number;
};

export type ReadingAnchor = {
  paragraphId: string;
  offset: number;
};

function splitOversizedParagraph(paragraph: PaginatedParagraph, charsPerPage: number): PaginatedParagraph[] {
  const characters = Array.from(paragraph.text);
  if (characters.length <= charsPerPage) return [paragraph];

  const fragments: PaginatedParagraph[] = [];
  let start = 0;
  while (start < characters.length) {
    let end = Math.min(start + charsPerPage, characters.length);
    if (end < characters.length) {
      const window = characters.slice(start, end);
      const punctuation = Math.max(
        window.lastIndexOf("。"),
        window.lastIndexOf("！"),
        window.lastIndexOf("？"),
        window.lastIndexOf("；"),
        window.lastIndexOf("，"),
      );
      if (punctuation >= Math.floor(charsPerPage * 0.45)) end = start + punctuation + 1;
    }
    fragments.push({
      ...paragraph,
      text: characters.slice(start, end).join(""),
      fragmentIndex: fragments.length,
      sourceStartOffset: start,
      sourceEndOffset: end,
    });
    start = end;
  }
  return fragments.map((fragment) => ({ ...fragment, fragmentCount: fragments.length }));
}

/**
 * 从当前页生成稳定的阅读锚点。
 * WHY：分页会随字号和窗口变化，页码不是稳定位置；当前页首个文本片段的原文偏移可以跨分页重算复原。
 */
export function createReadingAnchor(page: ReadingPage | undefined): ReadingAnchor | null {
  const paragraph = page?.paragraphs[0];
  if (!paragraph) return null;
  return { paragraphId: paragraph.id, offset: paragraph.sourceStartOffset ?? 0 };
}

/**
 * 在新分页中查找阅读锚点所在页。
 * WHY：同一段落可能被拆成多个片段，必须用原文偏移区分片段，不能只按 paragraphId 找到第一个页面。
 */
export function findPageIndexForAnchor(pages: ReadingPage[], anchor: ReadingAnchor): number {
  const match = pages.findIndex((page) => page.paragraphs.some((paragraph) => {
    if (paragraph.id !== anchor.paragraphId) return false;
    const start = paragraph.sourceStartOffset ?? 0;
    const end = paragraph.sourceEndOffset ?? start + Array.from(paragraph.text).length;
    return anchor.offset >= start && anchor.offset < end;
  }));
  if (match >= 0) return match;

  // 允许锚点落在段落末尾，兼容外部传入的 end offset。
  return pages.findIndex((page) => page.paragraphs.some((paragraph) => {
    if (paragraph.id !== anchor.paragraphId) return false;
    const start = paragraph.sourceStartOffset ?? 0;
    const end = paragraph.sourceEndOffset ?? start + Array.from(paragraph.text).length;
    return anchor.offset === end && end > start;
  }));
}

/**
 * 根据可用阅读区域计算稳定分页。
 * WHY：正文优先保持完整；只有单个段落超过一页时才按标点拆分，避免字号变化后内容被裁切。
 */
export function paginateParagraphs(paragraphs: PaginatedParagraph[], options: PaginationOptions): ReadingPage[] {
  const width = Math.max(options.availableWidth, 280);
  const height = Math.max(options.availableHeight, 240);
  const charWidth = options.charWidth ?? 8.2;
  const lineHeight = options.lineHeight ?? 32;
  const paragraphGap = options.paragraphGap ?? 24;
  const topReserve = options.topReserve ?? 130;
  const usableHeight = Math.max(height - topReserve, lineHeight);
  const charsPerLine = Math.max(Math.floor(width / charWidth), 12);
  const maxLines = Math.max(Math.floor((usableHeight - paragraphGap) / lineHeight), 1);
  const charsPerPage = Math.max(charsPerLine * maxLines, charsPerLine);
  const pages: ReadingPage[] = [];
  let current: PaginatedParagraph[] = [];
  let usedHeight = 0;
  let currentChapterId = paragraphs[0]?.chapterId ?? "";
  let currentChapterTitle = paragraphs[0]?.chapterTitle ?? "";

  const flush = (): void => {
    if (!current.length) return;
    pages.push({
      pageNumber: pages.length + 1,
      chapterId: currentChapterId,
      chapterTitle: currentChapterTitle,
      paragraphs: current,
      isChapterStart: current[0].chapterId !== (pages.at(-1)?.chapterId ?? null),
    });
    current = [];
    usedHeight = 0;
  };

  for (const source of paragraphs) {
    const fragments = splitOversizedParagraph(source, charsPerPage);
    for (const paragraph of fragments) {
      const lines = Math.max(1, Math.ceil(Array.from(paragraph.text).length / charsPerLine));
      const paragraphHeight = lines * lineHeight + paragraphGap;
      const chapterChanged = current.length > 0 && paragraph.chapterId !== currentChapterId;
      if (chapterChanged) flush();
      currentChapterId = paragraph.chapterId;
      currentChapterTitle = paragraph.chapterTitle;
      if (current.length && usedHeight + paragraphHeight > usableHeight) flush();
      current.push(paragraph);
      usedHeight += paragraphHeight;
    }
  }
  flush();
  return pages;
}
