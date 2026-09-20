import { EPub } from "epub";

export type ParsedChapter = { title: string; paragraphs: string[]; sourceHref: string };
export type ParsedEpub = { title: string; author: string; chapters: ParsedChapter[] };
type FlowItem = { id: string; title?: string; href?: string };
type EpubBook = { metadata: { title?: string; creator?: string }; flow: FlowItem[]; parse: () => Promise<void>; getChapter: (id: string) => Promise<string> };
const NON_READING_IDS = /^(cover|toc|front_matter|titlepage|copyright|colophon|nav)$/i;
const NAVIGATION_LABELS = new Set(["tableofcontents", "contents", "目录", "目錄", "frontmatter", "版权信息", "书名页"]);
const NAVIGATION_CLASSES = new Set(["toc", "contents", "table-of-contents", "table_of_contents"]);

function decodeEntities(value: string): string { return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, "> ").replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&ldquo;/gi, "“").replace(/&rdquo;/gi, "”").replace(/&lsquo;/gi, "‘").replace(/&rsquo;/gi, "’").replace(/&hellip;/gi, "…").replace(/&mdash;/gi, "—").replace(/&ndash;/gi, "–").replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code))).replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16))); }
function cleanText(value: string): string { return decodeEntities(value.replace(/<br\s*\/?>(?=.)/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/\s+([\uFF0C\u3002\uFF01\uFF1F\uFF1B\uFF1A\u3001\uFF09\u3011\u300B])/g, "$1").trim()); }
export function htmlToBlocks(html: string): { headings: string[]; paragraphs: string[] } {
  const withoutNoise = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const blocks: Array<{ kind: "heading" | "paragraph"; text: string }> = [];
  const pattern = /<(h[1-6]|p|blockquote|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of withoutNoise.matchAll(pattern)) { const text = cleanText(match[2]); if (text) blocks.push({ kind: /^h[1-6]$/i.test(match[1]) ? "heading" : "paragraph", text }); }
  if (!blocks.length) { const text = cleanText(withoutNoise); return { headings: [], paragraphs: text ? [text] : [] }; }
  return { headings: blocks.filter((item) => item.kind === "heading").map((item) => item.text), paragraphs: blocks.filter((item) => item.kind === "paragraph").map((item) => item.text) };
}
export function splitParagraphs(text: string): string[] { return text.replace(/\r/g, "").split(/\n\s*\n|(?<=[\u3002\uFF01\uFF1F])\s+(?=[\u4e00-\u9fff])/).map(cleanText).filter((value) => value.length >= 2); }
function normalizedLabel(value: string): string {
  // WHY：只规范化用于分类的标签；正文空白和 UTF-16 偏移保持原样，不能因此改变既有标注锚点。
  return cleanText(value).replace(/[\s\u200B-\u200D]+/gu, "").replace(/[：:]$/u, "").toLowerCase();
}
export function isNavigationLabel(value: string): boolean { return NAVIGATION_LABELS.has(normalizedLabel(value)); }
function isNavigationOnlyPage(html: string): boolean {
  const content = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const taggedNavigation = Array.from(content.matchAll(/<[a-z][^>]*>/gi)).some(([tag]) =>
    Array.from(tag.matchAll(/\s(class|id|epub:type|role)\s*=\s*(["'])(.*?)\2/gi)).some(([, attribute, , value]) => {
      const tokens = value.toLowerCase().split(/\s+/u);
      if (attribute.toLowerCase() === "epub:type") return tokens.includes("toc");
      if (attribute.toLowerCase() === "role") return tokens.includes("doc-toc");
      return tokens.some(token => NAVIGATION_CLASSES.has(token));
    }));
  if (!taggedNavigation || !/<a\b[^>]*>[\s\S]*?<\/a>/i.test(content)) return false;
  // WHY：局部小目录、插图 cover 类名不代表整章是目录；只有带明确标记且除标题外全是链接的页才跳过。
  const remainder = content.replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, "")
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, "");
  return cleanText(remainder).trim().length === 0;
}
function isCopyrightMetadata(headings: string[], paragraphs: string[]): boolean {
  // WHY：仅将“编目标题 + 独立 ISBN 字段”视为版权页；正文提及 CIP/ISBN 或采用楷体不能触发整节删除。
  return headings.length === 0
    && /^图书在版编目[（(]CIP[）)]数据$/iu.test((paragraphs[0] ?? "").replace(/\s+/gu, ""))
    && paragraphs.some(paragraph => /^ISBN[\s：:-]*\d/iu.test(paragraph));
}
export function shouldSkipEpubSection(item: FlowItem, headings: string[], paragraphs: string[], html: string): boolean {
  const basename = (item.href ?? "").split("/").pop()?.replace(/\.x?html?$/i, "") ?? "";
  return NON_READING_IDS.test(item.id) || NON_READING_IDS.test(basename)
    || isNavigationLabel(item.title ?? "") || isNavigationLabel(headings[0] ?? "")
    || isNavigationOnlyPage(html) || (!item.title?.trim() && isCopyrightMetadata(headings, paragraphs))
    || (paragraphs.length === 0 && headings.length === 0);
}
export async function parseEpubFile(filePath: string): Promise<ParsedEpub> {
  const book = new EPub(filePath) as unknown as EpubBook;
  await book.parse();
  const chapters: ParsedChapter[] = [];
  for (const item of book.flow) {
    const html = await book.getChapter(item.id);
    const blocks = htmlToBlocks(html);
    if (shouldSkipEpubSection(item, blocks.headings, blocks.paragraphs, html)) continue;
    // WHY：缺失书内标题时明确标为未命名，不能给献词、题辞等内容虚构“第几章”的原书语义。
    const sourceTitle = item.title?.trim() || blocks.headings[0];
    const title = (sourceTitle || `未命名章节 ${chapters.length + 1}`).replace(/\s+/g, " ");
    const paragraphs = sourceTitle ? blocks.paragraphs.filter(paragraph => paragraph !== title) : blocks.paragraphs;
    if (paragraphs.length) chapters.push({ title, paragraphs, sourceHref: item.href ?? item.id });
  }
  if (!chapters.length) throw new Error("EPUB 中没有提取到可阅读正文");
  return { title: book.metadata.title?.trim() || "未命名书籍", author: book.metadata.creator?.trim() || "未知作者", chapters };
}
