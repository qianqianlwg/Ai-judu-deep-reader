import { EPub } from "epub";

export type ParsedChapter = { title: string; paragraphs: string[]; sourceHref: string };
export type ParsedEpub = { title: string; author: string; chapters: ParsedChapter[] };
type FlowItem = { id: string; title?: string; href?: string };
type EpubBook = { metadata: { title?: string; creator?: string }; flow: FlowItem[]; parse: () => Promise<void>; getChapter: (id: string) => Promise<string> };
const NON_READING_IDS = /^(cover|toc|front_matter|titlepage|copyright|colophon|nav)$/i;
const NAVIGATION_TEXT = /^(table of contents|contents|\u76ee\u5f55|front matter|\u7248\u6743\u4fe1\u606f|\u4e66\u540d\u9875)$/i;
const NON_READING_MARKUP = /class=["'][^"']*(toc|copyright|titlepage|cover)[^"']*["']/i;

function decodeEntities(value: string): string { return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, "> ").replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&ldquo;/gi, "\u201c").replace(/&rdquo;/gi, "\u201d").replace(/&lsquo;/gi, "\u2018").replace(/&rsquo;/gi, "\u2019").replace(/&hellip;/gi, "\u2026").replace(/&mdash;/gi, "\u2014").replace(/&ndash;/gi, "\u2013").replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code))).replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16))); }
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
function shouldSkip(item: FlowItem, headings: string[], paragraphs: string[], html: string): boolean { const basename = (item.href ?? "").split("/").pop()?.replace(/\.x?html?$/i, "") ?? ""; return NON_READING_MARKUP.test(html) || NON_READING_IDS.test(item.id) || NON_READING_IDS.test(basename) || NAVIGATION_TEXT.test((item.title ?? "").trim()) || NAVIGATION_TEXT.test(headings[0] ?? "") || (paragraphs.length === 0 && headings.length === 0); }
export async function parseEpubFile(filePath: string): Promise<ParsedEpub> { const book = new EPub(filePath) as unknown as EpubBook; await book.parse(); const chapters: ParsedChapter[] = []; for (const item of book.flow) { const html = await book.getChapter(item.id); const blocks = htmlToBlocks(html); if (shouldSkip(item, blocks.headings, blocks.paragraphs, html)) continue; const title = (item.title?.trim() || blocks.headings[0] || `\u7b2c${chapters.length + 1}\u7ae0`).replace(/\s+/g, " "); const paragraphs = blocks.paragraphs.filter((paragraph) => paragraph !== title); if (paragraphs.length) chapters.push({ title, paragraphs, sourceHref: item.href ?? item.id }); } if (!chapters.length) throw new Error("EPUB 中没有提取到可阅读正文"); return { title: book.metadata.title?.trim() || "未命名书籍", author: book.metadata.creator?.trim() || "未知作者", chapters }; }
