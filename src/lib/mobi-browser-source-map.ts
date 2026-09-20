import type { EpubParagraphMap } from "./epub-source-map";
import type { LibraryChapter } from "./library";

type TextPoint = EpubParagraphMap["points"][number];
type Visibility = { suppressed: boolean; visibility: string };
type Entry = Visibility & { node: Node; exit: boolean; heading: boolean };
type Block = { text: string; points: TextPoint[]; heading: boolean; hidden: boolean };
const IGNORED = new Set(["head", "script", "style", "noscript", "template", "svg"]);
const BLOCKS = new Set(["p", "div", "section", "article", "blockquote", "li", "tr", "pre", "h1", "h2", "h3", "h4", "h5", "h6"]);
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

function visibilityFor(element: Element, parent: Visibility): Visibility {
  const inline = element.namespaceURI === HTML_NAMESPACE ? (element as HTMLElement).style : undefined;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element) ?? inline;
  return {
    // WHY：隐藏内容仍参加抽取和计数；仅禁止产出锚点，不能先删掉它再让可见同文顶替。
    suppressed: parent.suppressed || element.hasAttribute("hidden") || element.hasAttribute("inert")
      || element.getAttribute("aria-hidden") === "true" || style?.display === "none"
      || style?.contentVisibility === "hidden" || style?.opacity === "0",
    // WHY：visibility 可由子元素恢复为 visible，不同于 display:none 的整棵子树隐藏。
    visibility: style?.visibility || parent.visibility,
  };
}

function documentBlocks(doc: Document): Block[] {
  const stack: Entry[] = [{ node: doc, exit: false, heading: false, suppressed: false, visibility: "visible" }];
  const blocks: Block[] = [];
  let parts: string[] = [], points: TextPoint[] = [];
  let heading = false, hidden = false, visited = 0;
  const flush = () => {
    const text = parts.join("").replace(/\s+/gu, " ").trim();
    if (text) blocks.push({ text, points, heading, hidden });
    parts = []; points = []; hidden = false;
    if (blocks.length > 100_000) throw new Error("MOBI正文段落数超限");
  };
  // WHY：逐项复现 mobiHtmlBlocks 的进入/退出 flush 和标题状态，嵌套 div 不是一个合并段落。
  while (stack.length) {
    const entry = stack.pop();
    if (!entry) break;
    if (++visited > 400_000) throw new Error("MOBI HTML节点数超限");
    const { node } = entry;
    const element = node.nodeType === 1 ? node as Element : null;
    const tag = element?.localName.toLowerCase() ?? "";
    if (IGNORED.has(tag)) continue;
    if (entry.exit) { flush(); continue; }
    if (node.nodeType === 3) {
      if (heading !== entry.heading) flush();
      heading = entry.heading;
      const text = node as Text;
      parts.push(text.data);
      for (let offset = 0; offset < text.length; offset += 1) {
        if (/\s/u.test(text.data[offset])) continue;
        points.push({ node: text, offset });
        hidden ||= entry.suppressed || entry.visibility === "hidden" || entry.visibility === "collapse";
      }
      continue;
    }
    if (tag === "br" || tag === "td" || tag === "th") parts.push(" ");
    if (BLOCKS.has(tag)) { flush(); stack.push({ ...entry, exit: true }); }
    const visibility = element ? visibilityFor(element, entry) : entry;
    if (stack.length + node.childNodes.length > 200_000) throw new Error("MOBI HTML节点栈超限");
    for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
      stack.push({ node: node.childNodes[index], exit: false, heading: /^h[1-6]$/u.test(tag) || entry.heading,
        suppressed: visibility.suppressed, visibility: visibility.visibility });
    }
  }
  flush();
  const firstHeading = blocks.findIndex(block => block.heading);
  // WHY：只移除首个 heading 块，不按标题文本过滤；同名正文和后续标题必须保留。
  return blocks.filter((_, index) => index !== firstHeading);
}

/** 调用端已核验章节 sourceHref；这里只把原版 DOM 的正文字符映射到既有精读段落。 */
export function mapMobiDocument(doc: Document, chapter: LibraryChapter): EpubParagraphMap[] {
  const blocks = documentBlocks(doc);
  const actual = new Map<string, number[]>(), expectedCounts = new Map<string, number>();
  for (const [index, block] of blocks.entries()) {
    const indices = actual.get(block.text) ?? [];
    indices.push(index); actual.set(block.text, indices);
  }
  for (const paragraph of chapter.paragraphs) {
    expectedCounts.set(paragraph.text, (expectedCounts.get(paragraph.text) ?? 0) + 1);
  }
  const occurrences = new Map<string, number>();
  const result: EpubParagraphMap[] = [];
  let previous = -1;
  for (const paragraph of chapter.paragraphs) {
    const indices = actual.get(paragraph.text);
    // WHY：核验完整规范化字符串（含 br/单元格空格）及重复数量；不做子串、去标点或模糊匹配。
    if (!indices || indices.length !== expectedCounts.get(paragraph.text)) continue;
    const occurrence = occurrences.get(paragraph.text) ?? 0;
    const index = indices[occurrence];
    occurrences.set(paragraph.text, occurrence + 1);
    // WHY：数量相同也可能发生重排；拒绝倒序章，不能贪心跳过冲突而悄悄串绑重复段。
    if (index <= previous) return [];
    previous = index;
    const block = blocks[index];
    if (block.hidden || !block.points.length) continue;
    const first = block.points[0], last = block.points[block.points.length - 1];
    const range = doc.createRange();
    range.setStart(first.node, first.offset); range.setEnd(last.node, last.offset + 1);
    const ancestor = range.commonAncestorContainer;
    const element = ancestor.nodeType === 1 ? ancestor as Element : ancestor.parentElement;
    if (!element) continue;
    const offsets: number[] = [];
    for (let offset = 0; offset < paragraph.text.length; offset += 1) {
      if (!/\s/u.test(paragraph.text[offset])) offsets.push(offset);
    }
    // WHY：保留原 Text 节点与 UTF-16 偏移，直接复用 EPUB 的 Range、分页锚点和选区限长逻辑。
    result.push({ paragraph, element, points: block.points, offsets });
  }
  return result;
}
