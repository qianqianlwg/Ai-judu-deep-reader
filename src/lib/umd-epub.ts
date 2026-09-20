import JSZip from "jszip";
import type { UmdBook } from "./umd-parser";
import { validateCbzImage } from "./cbz-image";
import { validateEpubImport } from "./epub-import-security";
import { EPUB_LIMITS } from "./epub-security-zip";

type ChapterSource = { href: string; startByte: number; endByte: number };
type Snapshot = Omit<UmdBook, "cover"> & { cover?: { bytes: Buffer; mediaType: "image/png" | "image/jpeg" } };
export type UmdEpubResult = { epub: Buffer; sourceHash: string; converterVersion: string; chapters: ChapterSource[] };

const CONVERTER_VERSION = "umd-epub-v1";
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_BYTES = 20 * 1024 * 1024;
const MAX_CHAPTERS = 1024;
const MAX_METADATA_BYTES = 4096;
const MAX_PARAGRAPHS = 100_000;
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const XML_ILLEGAL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\ud800-\udfff]/u;

function invalid(label: string): never { throw new Error(`UMD 转 EPUB：${label}`); }

function fields(value: unknown, names: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${label}必须是普通数据对象`);
  const keys = Reflect.ownKeys(value);
  if (keys.length > names.length || keys.some(key => typeof key !== "string" || !names.includes(key))) invalid(`${label}包含未知字段`);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) invalid(`${label}不允许访问器字段`);
    result[String(key)] = descriptor.value;
  }
  return result;
}

function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalid(`${label}无效或超过上限`);
  return value;
}

function text(value: unknown, limit: number, label: string): string {
  if (typeof value !== "string" || value.length > limit || Buffer.byteLength(value, "utf8") > limit) invalid(`${label}无效或超过文本预算`);
  // WHY：Buffer/TextEncoder 会替换孤立代理项，XML 会拒绝控制字符；拒绝输入而不是悄悄改变原文。
  if (XML_ILLEGAL.test(value)) invalid(`${label}包含非法 XML 字符或孤立代理项`);
  return value;
}

function snapshot(input: unknown): Snapshot {
  const data = fields(input, ["kind", "title", "author", "sourceHash", "sourceSize", "declaredBytes", "chapters", "cover"], "书籍");
  if (data.kind !== "text") invalid("仅接受文字型 UMD 的已解析数据");
  const title = text(data.title, MAX_METADATA_BYTES, "书名");
  if (!title.trim()) invalid("书名不能为空");
  const author = text(data.author, MAX_METADATA_BYTES, "作者");
  const sourceHash = text(data.sourceHash, 64, "来源哈希");
  if (!/^[a-f0-9]{64}$/u.test(sourceHash)) invalid("来源哈希必须是小写 SHA-256");
  const sourceSize = integer(data.sourceSize, 4, MAX_SOURCE_BYTES, "来源文件大小");
  const declaredBytes = integer(data.declaredBytes, 2, MAX_TEXT_BYTES, "来源正文长度");
  if (declaredBytes % 2) invalid("来源正文必须按 UTF-16LE 字节对齐");
  if (!Array.isArray(data.chapters) || data.chapters.length < 1 || data.chapters.length > MAX_CHAPTERS) invalid("章节数量无效或超过1024章");
  const chapters: Snapshot["chapters"] = [];
  let utf8Bytes = Buffer.byteLength(title + author), utf16Bytes = 0, previousEnd = 0;
  for (let index = 0; index < data.chapters.length; index++) {
    const item = Object.getOwnPropertyDescriptor(data.chapters, String(index));
    if (!item || !("value" in item)) invalid("章节数组不允许空洞或访问器");
    const chapter = fields(item.value, ["title", "text", "startByte", "endByte"], `章节${index + 1}`);
    const chapterTitle = text(chapter.title, MAX_METADATA_BYTES, "章节标题");
    const chapterText = text(chapter.text, MAX_TEXT_BYTES, "章节正文");
    const startByte = integer(chapter.startByte, 0, declaredBytes, "章节起点");
    const endByte = integer(chapter.endByte, startByte + 2, declaredBytes, "章节终点");
    if (startByte % 2 || endByte % 2 || startByte < previousEnd) invalid("章节来源范围未对齐、重叠或倒序");
    // WHY：当前合同保留原始UTF-16LE文本，必须逐章连续完整覆盖；将来规范化需显式映射版本，不能猜测来源。
    if (startByte !== previousEnd) invalid(index === 0 ? "首章来源必须从0开始" : "章节来源范围不连续，存在中间缺口");
    if (chapterText.length * 2 !== endByte - startByte) invalid("章节正文UTF-16LE字节长度与来源范围不一致");
    previousEnd = endByte;
    utf8Bytes += Buffer.byteLength(chapterTitle + chapterText);
    utf16Bytes += chapterText.length * 2;
    if (utf8Bytes > MAX_TEXT_BYTES || utf16Bytes > MAX_TEXT_BYTES) invalid("正文和元数据超过20MiB文本预算");
    chapters.push({ title: chapterTitle, text: chapterText, startByte, endByte });
  }
  if (previousEnd !== declaredBytes) invalid("末章来源未覆盖declaredBytes，存在尾部缺失");
  if (!utf16Bytes) invalid("书籍没有正文");
  let cover: Snapshot["cover"];
  if (data.cover !== undefined) {
    const image = fields(data.cover, ["bytes", "mediaType"], "封面");
    if (image.mediaType !== "image/png" && image.mediaType !== "image/jpeg") invalid("封面只允许 PNG/JPEG");
    if (!(image.bytes instanceof Uint8Array) || image.bytes.length < 1 || image.bytes.length > EPUB_LIMITS.entry
      || !(image.bytes.buffer instanceof ArrayBuffer)) invalid("封面字节无效、共享或超过24MiB");
    // WHY：在第一个 await 前冻结输入内容，避免调用者在图片验证/ZIP生成期间替换字段或篡改像素。
    cover = { bytes: Buffer.from(image.bytes), mediaType: image.mediaType };
  }
  return { kind: "text", title, author, sourceHash, sourceSize, declaredBytes, chapters, cover };
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"'\r]/gu, character => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&apos;";
      default: return "&#13;";
    }
  });
}

class Xml {
  private readonly parts: string[] = [XML_DECLARATION];
  private size = Buffer.byteLength(XML_DECLARATION);
  add(part: string): void {
    this.size += Buffer.byteLength(part);
    if (this.size > EPUB_LIMITS.text) invalid("单份 XML/XHTML 超过2MiB安全上限，未拆分或截断章节");
    this.parts.push(part);
  }
  finish(): Buffer { return Buffer.from(this.parts.join(""), "utf8"); }
}

const chapterName = (index: number) => `chapter-${String(index + 1).padStart(4, "0")}.xhtml`;
const chapterId = (index: number) => `chapter-${String(index + 1).padStart(4, "0")}`;
const label = (title: string, index: number) => title || `第 ${index + 1} 章`;
const style = '<style type="text/css">.umd-line{white-space:pre-wrap;margin:0;min-height:1em}</style>';

function chapterDocument(chapter: Snapshot["chapters"][number], index: number, budget: { paragraphs: number }): Buffer {
  if (Buffer.byteLength(chapter.text) > EPUB_LIMITS.text) invalid("单章正文超过2MiB安全上限");
  const xml = new Xml();
  xml.add(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeXml(label(chapter.title, index))}</title>${style}</head><body>`);
  if (chapter.title) xml.add(`<h1>${escapeXml(chapter.title)}</h1>`);
  xml.add('<div id="umd-body">');
  // WHY：只生成固定元素，不把正文当HTML；段落间原换行作为文本保留，CR用字符引用避免XML换行归一化。
  for (const match of chapter.text.matchAll(/([^\r\n\u2029]*)(\r\n|[\r\n\u2029]|$)/gu)) {
    if (!match[0]) continue;
    if (++budget.paragraphs > MAX_PARAGRAPHS) invalid("正文超过100000段落上限");
    xml.add(`<p class="umd-line">${escapeXml(match[1])}</p>${escapeXml(match[2])}`);
  }
  xml.add("</div></body></html>");
  return xml.finish();
}

function packageDocument(book: Snapshot, identifier: string, coverName?: string): Buffer {
  const xml = new Xml();
  xml.add('<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">');
  xml.add(`<dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${escapeXml(book.title)}</dc:title><dc:creator>${escapeXml(book.author)}</dc:creator><dc:language>und</dc:language>`);
  xml.add(`<dc:source>urn:sha256:${book.sourceHash}</dc:source><dc:description>UMD 转换阅读版，不代表原始排版。</dc:description><meta name="umd:converter" content="${CONVERTER_VERSION}"/>`);
  xml.add(`<meta name="umd:source-size" content="${book.sourceSize}"/><meta name="umd:declared-bytes" content="${book.declaredBytes}"/>`);
  if (coverName) xml.add('<meta name="cover" content="cover-image"/>');
  xml.add('</metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');
  if (coverName) xml.add(`<item id="cover-image" href="${coverName}" media-type="${book.cover!.mediaType}"/><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
  book.chapters.forEach((_, index) => xml.add(`<item id="${chapterId(index)}" href="${chapterName(index)}" media-type="application/xhtml+xml"/>`));
  xml.add('</manifest><spine toc="ncx">');
  if (coverName) xml.add('<itemref idref="cover" linear="no"/>');
  book.chapters.forEach((_, index) => xml.add(`<itemref idref="${chapterId(index)}"/>`));
  xml.add("</spine>");
  if (coverName) xml.add('<guide><reference type="cover" title="封面" href="cover.xhtml"/></guide>');
  xml.add("</package>");
  return xml.finish();
}

function navigationDocument(book: Snapshot, identifier: string): Buffer {
  const xml = new Xml();
  xml.add(`<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${identifier}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>`);
  xml.add(`<docTitle><text>${escapeXml(book.title)}</text></docTitle><docAuthor><text>${escapeXml(book.author)}</text></docAuthor><navMap>`);
  book.chapters.forEach((chapter, index) => xml.add(`<navPoint id="nav-${index + 1}" playOrder="${index + 1}"><navLabel><text>${escapeXml(label(chapter.title, index))}</text></navLabel><content src="${chapterName(index)}"/></navPoint>`));
  xml.add("</navMap></ncx>");
  return xml.finish();
}

/** 只转换已解析文字书；sourceHash是调用方提供的来源证据，本函数无法代替原UMD校验，也不覆盖原件。 */
export async function createUmdEpub(book: UmdBook): Promise<UmdEpubResult> {
  const saved = snapshot(book);
  let coverName: string | undefined;
  if (saved.cover) {
    coverName = saved.cover.mediaType === "image/png" ? "cover.png" : "cover.jpg";
    await validateCbzImage(coverName, saved.cover.bytes);
  }
  const zip = new JSZip();
  let predictedSize = 22;
  function add(name: string, content: Buffer | string): void {
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    // WHY：全部STORE，避免重复文本触发压缩比限制；ASCII文件名、无extra/comment时可在生成前精确界定ZIP体积。
    predictedSize += bytes.length + 76 + Buffer.byteLength(name) * 2;
    if (bytes.length > EPUB_LIMITS.entry || predictedSize > EPUB_LIMITS.compressed) invalid("EPUB条目或输出超过安全预算（输出64MiB）");
    zip.file(name, bytes, { date: new Date("1980-01-01T00:00:00.000Z"), compression: "STORE", createFolders: false });
  }
  add("mimetype", "application/epub+zip");
  add("META-INF/container.xml", `${XML_DECLARATION}<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const identifier = `urn:judu:${CONVERTER_VERSION}:${saved.sourceHash}`;
  add("OPS/package.opf", packageDocument(saved, identifier, coverName));
  add("OPS/toc.ncx", navigationDocument(saved, identifier));
  if (coverName && saved.cover) {
    add(`OPS/${coverName}`, saved.cover.bytes);
    add("OPS/cover.xhtml", `${XML_DECLARATION}<html xmlns="http://www.w3.org/1999/xhtml"><head><title>封面</title></head><body><img src="${coverName}" alt="封面"/></body></html>`);
  }
  const budget = { paragraphs: 0 };
  const chapters = saved.chapters.map((chapter, index) => {
    const href = `OPS/${chapterName(index)}`;
    add(href, chapterDocument(chapter, index, budget));
    return { href, startByte: chapter.startByte, endByte: chapter.endByte };
  });
  const epub = await zip.generateAsync({ type: "nodebuffer", compression: "STORE", platform: "DOS", streamFiles: false, comment: "" });
  if (epub.length !== predictedSize || epub.length > EPUB_LIMITS.compressed) invalid("EPUB实际输出与预算不符");
  // WHY：返回前复用现有的目录/大小/CRC检查，不把自己生成的ZIP视为天然可信。
  await validateEpubImport(epub);
  return { epub, sourceHash: saved.sourceHash, converterVersion: CONVERTER_VERSION, chapters };
}
