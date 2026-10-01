import type { LibraryChapter, LibraryParagraph } from "./library";
import { capReadingSelection, selectionFromParts, selectionParts, type ReadingSelection } from "./reader-selection";

type TextPoint = { node: Text; offset: number };
type EpubMapPoints = { element: Element; points: TextPoint[]; offsets: number[] };
export type EpubParagraphMap = EpubMapPoints & {
  paragraph: LibraryParagraph;
  /** Rebuilds a stale map from its format-specific canonical DOM projection. */
  refresh?: () => EpubMapPoints | null;
};
const BLOCKS = "p,blockquote,li";
const IGNORED = "script,style,svg,noscript,[data-judu-decoration]";
const compact = (text: string) => text.replace(/\s/gu, "");

export function sameEpubResource(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  // WHY：只接受同一归档资源，不用 basename 模糊匹配，避免两章同名文件或重复段落串版。
  const normalize = (value: string) => {
    try { return decodeURIComponent(value.split("#", 1)[0]).replace(/^\.\//u, "").replace(/^\//u, ""); }
    catch (cause: unknown) { console.warn("EPUB 资源路径编码无效", cause); return value; }
  };
  return normalize(a) === normalize(b);
}

function textPoints(element: Element): { text: string; points: TextPoint[] } {
  const walker = element.ownerDocument.createTreeWalker(element, 4);
  const points: TextPoint[] = [];
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(IGNORED)) continue;
    const value = node.nodeValue ?? "";
    for (let offset = 0; offset < value.length; offset += 1) {
      if (/\s/u.test(value[offset])) continue;
      text += value[offset]; points.push({ node: node as Text, offset });
    }
  }
  return { text, points };
}

function sourceOffsets(text: string): number[] {
  const offsets: number[] = [];
  for (let index = 0; index < text.length; index += 1) if (!/\s/u.test(text[index])) offsets.push(index);
  return offsets;
}

function mapPointIsCurrent(map: EpubParagraphMap, index: number): boolean {
  const point = map.points[index];
  const sourceOffset = map.offsets[index];
  return Boolean(point && Number.isInteger(sourceOffset) && sourceOffset >= 0 && sourceOffset < map.paragraph.text.length
    && point.node.ownerDocument === map.element.ownerDocument && point.node.isConnected && map.element.isConnected && map.element.contains(point.node)
    && Number.isInteger(point.offset) && point.offset >= 0 && point.offset < point.node.length
    && point.node.data.charAt(point.offset) === map.paragraph.text.charAt(sourceOffset));
}

function mapPointsAreCurrent(map: EpubParagraphMap): boolean {
  return map.points.length === map.offsets.length && map.points.every((_, index) => mapPointIsCurrent(map, index));
}

function refreshMapPoints(map: EpubParagraphMap): boolean {
  const current = map.refresh?.();
  if (!current) return false;
  map.element = current.element;
  map.points = current.points;
  map.offsets = current.offsets;
  return mapPointsAreCurrent(map);
}

function refreshedEpubPoints(doc: Document, chapter: LibraryChapter, paragraphId: string, blockSelector: string): EpubMapPoints | null {
  const current = mapEpubDocument(doc, chapter, blockSelector).find(item => item.paragraph.id === paragraphId);
  return current ? { element: current.element, points: current.points, offsets: current.offsets } : null;
}

export function mapEpubDocument(doc: Document, chapter: LibraryChapter, blockSelector=BLOCKS): EpubParagraphMap[] {
  const blocks = Array.from(doc.querySelectorAll(blockSelector)).filter(element => !element.parentElement?.closest(blockSelector));
  const candidates = (blocks.length ? blocks : [doc.body]).filter((element): element is Element => Boolean(element)).map(element => ({ element, ...textPoints(element) }));
  const expectedCounts=new Map<string,number>(), actualCounts=new Map<string,number>();
  for(const paragraph of chapter.paragraphs){const text=compact(paragraph.text);expectedCounts.set(text,(expectedCounts.get(text)??0)+1);}
  for(const candidate of candidates)actualCounts.set(candidate.text,(actualCounts.get(candidate.text)??0)+1);
  const result: EpubParagraphMap[] = [];
  let cursor = 0;
  for (const paragraph of chapter.paragraphs) {
    const expected = compact(paragraph.text);
    // WHY：净化若移除某个重复段落，后面的同文不能冒充前一个；数量不一致时全部拒绝该同文映射。
    if (!expected || expectedCounts.get(expected)!==actualCounts.get(expected)) continue;
    const next = candidates.findIndex((item, index) => index >= cursor && item.text === expected);
    if (next < 0) continue;
    const candidate = candidates[next]; cursor = next + 1;
    const offsets = sourceOffsets(paragraph.text);
    // WHY：显示 DOM 保留图片、公式与内联样式。映射只核对完整正文字符序列，不重写 DOM，也不把重复摘录猜成锚点。
    result.push({ paragraph, element: candidate.element, points: candidate.points, offsets,
      refresh: () => refreshedEpubPoints(doc, chapter, paragraph.id, blockSelector) });
  }
  return result;
}

function rangeForCurrentAnchor(map: EpubParagraphMap, start: number, end: number): Range | null {
  const first = map.offsets.findIndex(offset => offset >= start);
  let last = -1;
  for (let index = 0; index < map.offsets.length; index += 1) if (map.offsets[index] < end) last = index;
  if (first < 0 || last < first || !mapPointIsCurrent(map, first) || !mapPointIsCurrent(map, last)) return null;
  const range = map.element.ownerDocument.createRange();
  range.setStart(map.points[first].node, map.points[first].offset);
  range.setEnd(map.points[last].node, map.points[last].offset + 1);
  return range;
}

export function rangeForEpubAnchor(maps: readonly EpubParagraphMap[], paragraphId: string, start: number, end: number): Range | null {
  const map = maps.find(item => item.paragraph.id === paragraphId);
  if (!map || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > map.paragraph.text.length) return null;
  const expected = compact(map.paragraph.text.slice(start, end));
  let range = rangeForCurrentAnchor(map, start, end);
  if (range && compact(range.toString()) === expected) return range;
  // WHY： 排版器拆分 Text 节点会使旧偏移越界；重建映射并逐字核对后再创建 Range。
  if (!refreshMapPoints(map)) return null;
  range = rangeForCurrentAnchor(map, start, end);
  return range && compact(range.toString()) === expected ? range : null;
}

export function selectionFromEpubRange(range: Range, maps: readonly EpubParagraphMap[]): ReadingSelection | null {
  if (range.collapsed) return null;
  const doc = range.startContainer.ownerDocument;
  if (!doc || range.endContainer.ownerDocument !== doc) return null;
  const start = range.cloneRange(); start.collapse(true);
  const end = range.cloneRange(); end.collapse(false);
  const pointRange = doc.createRange();
  const touched: { map: EpubParagraphMap; indices: number[] }[] = [];
  for (const map of maps) {
    if (map.element.ownerDocument !== doc || !range.intersectsNode(map.element)
      || (!mapPointsAreCurrent(map) && !refreshMapPoints(map))) continue;
    const indices: number[] = [];
    for (let index = 0; index < map.points.length; index += 1) {
      const point = map.points[index];
      pointRange.setStart(point.node, point.offset); pointRange.collapse(true);
      const beforeEnd = pointRange.compareBoundaryPoints(0, end) < 0;
      pointRange.setStart(point.node, point.offset + 1); pointRange.collapse(true);
      if (beforeEnd && pointRange.compareBoundaryPoints(0, start) > 0) indices.push(index);
    }
    if (indices.length) touched.push({ map, indices });
  }
  if (!touched.length) return null;
  const parts = touched.map(({map,indices}, index) => {
    const startOffset = index === 0 ? map.offsets[indices[0]] : 0;
    const endOffset = index === touched.length-1 ? map.offsets[indices[indices.length-1]]+1 : map.paragraph.text.length;
    return {paragraphId:map.paragraph.id,startOffset,endOffset,text:map.paragraph.text.slice(startOffset,endOffset)};
  });
  const selection = selectionFromParts(parts);
  // WHY：跨段合法，但缺少索引的脚注/图中文字不能偷偷丢弃；核验完整覆盖后才提交。
  if (compact(range.toString()) !== compact(selection.text)) return null;
  return selection;
}

function rangeWithoutLeadingHeading(range: Range, maps: readonly EpubParagraphMap[]): Range | null {
  const doc = range.startContainer.ownerDocument;
  if (!doc || range.endContainer.ownerDocument !== doc) return null;
  const pointRange = doc.createRange();
  const start = range.cloneRange(); start.collapse(true);
  const end = range.cloneRange(); end.collapse(false);
  let first: TextPoint | undefined;
  for (const map of maps) {
    if (map.element.ownerDocument !== doc || !range.intersectsNode(map.element)
      || (!mapPointsAreCurrent(map) && !refreshMapPoints(map))) continue;
    for (const point of map.points) {
      pointRange.setStart(point.node, point.offset); pointRange.collapse(true);
      const beforeEnd = pointRange.compareBoundaryPoints(0, end) < 0;
      pointRange.setStart(point.node, point.offset + 1); pointRange.collapse(true);
      if (beforeEnd && pointRange.compareBoundaryPoints(0, start) > 0) { first = point; break; }
    }
    if (first) break;
  }
  if (!first) return null;
  const prefix = range.cloneRange(); prefix.setEnd(first.node, first.offset);
  const walker = doc.createTreeWalker(prefix.cloneContents(), 4);
  let hasHeadingText = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!compact(node.nodeValue ?? "")) continue;
    // WHY：只舍弃选区开头真实的标题 DOM；脚注、遗漏正文或标题之后的杂质不能被静默吞掉。
    if (!node.parentElement?.closest("h1,h2,h3,h4,h5,h6")) return null;
    hasHeadingText = true;
  }
  if (!hasHeadingText) return null;
  const trimmed = range.cloneRange(); trimmed.setStart(first.node, first.offset);
  return selectionFromEpubRange(trimmed, maps) ? trimmed : null;
}

export function readLimitedEpubSelection(selection: Selection, maps: readonly EpubParagraphMap[], onLimit?: () => void, onHeadingOmitted?: (limited: boolean) => void): ReadingSelection | null {
  if (!selection.rangeCount || selection.isCollapsed) return null;
  let range = selection.getRangeAt(0), full = selectionFromEpubRange(range,maps);
  const reverse = selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset;
  let omittedHeading = false;
  if (!full) {
    const trimmed = rangeWithoutLeadingHeading(range,maps);
    if (!trimmed) return null;
    range = trimmed; full = selectionFromEpubRange(range,maps);
    if (!full) return null;
    selection.setBaseAndExtent(reverse?range.endContainer:range.startContainer,reverse?range.endOffset:range.startOffset,reverse?range.startContainer:range.endContainer,reverse?range.startOffset:range.endOffset);
    omittedHeading = true;
  }
  const limited = capReadingSelection(full,reverse);
  if (limited !== full) {
    const parts=selectionParts(limited), first=parts[0], last=parts[parts.length-1];
    const start=rangeForEpubAnchor(maps,first.paragraphId,first.startOffset,first.endOffset);
    const end=rangeForEpubAnchor(maps,last.paragraphId,last.startOffset,last.endOffset);
    if(!start||!end)return null;
    selection.setBaseAndExtent(reverse?end.endContainer:start.startContainer,reverse?end.endOffset:start.startOffset,reverse?start.startContainer:end.endContainer,reverse?start.startOffset:end.endOffset);
    onLimit?.();
  }
  if (omittedHeading) onHeadingOmitted?.(limited !== full);
  return limited;
}

/** Canonical first visible character; page start may be inside a long paragraph. */
export function anchorFromEpubRange(range: Range, maps: readonly EpubParagraphMap[]): { paragraphId: string; offset: number } | null {
  const doc = range.startContainer.ownerDocument;
  for (const map of maps) {
    if (map.element.ownerDocument !== doc) continue;
    let refreshed = false;
    for (let index = 0; index < map.points.length; index += 1) {
      if (!mapPointIsCurrent(map, index)) {
        if (refreshed || !refreshMapPoints(map)) break;
        refreshed = true;
        index = -1;
        continue;
      }
      const point = map.points[index];
      if (range.comparePoint(point.node, point.offset) === 0) return { paragraphId: map.paragraph.id, offset: map.offsets[index] };
    }
  }
  return null;
}

export function rangeForEpubPosition(maps: readonly EpubParagraphMap[], paragraphId: string, offset: number): Range | null {
  const map=maps.find(item=>item.paragraph.id===paragraphId);
  if(!map||!Number.isInteger(offset)||offset<0||offset>map.paragraph.text.length)return null;
  // WHY：分页锚点可能落在抽取器补出的空格或段尾；使用同段下一可见字符，不猜测别的段落。
  const start=map.offsets.find(position=>position>=offset) ?? map.offsets.at(-1);
  return start===undefined ? null : rangeForEpubAnchor(maps,paragraphId,start,start+1);
}
