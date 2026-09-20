// @ts-check
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { mobiHtmlBlocks } from "./mobi-html.mjs";

/** @param {unknown} value @returns {asserts value is {bytes: Uint8Array, kind: 'mobi'|'kf8', resourceDir: string}} */
function validateInput(value) {
  if (!value || typeof value !== "object" || !("bytes" in value) || !(value.bytes instanceof Uint8Array)
    || value.bytes.byteLength > 100 * 1024 * 1024 || !("kind" in value) || !["mobi", "kf8"].includes(String(value.kind))
    || !("resourceDir" in value) || typeof value.resourceDir !== "string") {
    throw new Error("MOBI worker输入无效");
  }
}

/** @param {unknown} value @param {number} limit */
function boundedString(value, limit) {
  if (typeof value !== "string" || value.length > limit) throw new Error("MOBI字符串无效或超限");
  return value;
}

/** @param {string} directory */
async function checkResources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > 5000) throw new Error("MOBI资源数量超限");
  let bytes = 0;
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("MOBI资源类型无效");
    bytes += (await lstat(path.join(directory, entry.name))).size;
    if (bytes > 100 * 1024 * 1024) throw new Error("MOBI资源总大小超限");
  }
}

/** @param {unknown} input */
async function run(input) {
  validateInput(input);
  const { initMobiFile, initKf8File } = await import("../../vendor/mobi/index.mjs");
  // WHY：候选库包含同步解压和文件写入；只在可被父进程终止的独立进程中调用，不阻塞Web主线程。
  const parser = await (input.kind === "kf8" ? initKf8File : initMobiFile)(input.bytes, input.resourceDir);
  const metadata = parser.getMetadata();
  const title = boundedString(metadata.title ?? "", 4096);
  if (!Array.isArray(metadata.author) || metadata.author.length > 256) throw new Error("MOBI作者列表无效");
  const authors = metadata.author.map((/** @type {unknown} */ author) => boundedString(author, 4096));
  const spine = parser.getSpine();
  if (!Array.isArray(spine) || !spine.length || spine.length > 10000) throw new Error("MOBI章节数量无效或超限");
  const seen = new Set();
  let characters = title.length + authors.join("").length;
  const chapters = [];
  let paragraphs = 0;
  for (const chapter of spine) {
    const id = boundedString(chapter.id, 256);
    if (!id || seen.has(id)) throw new Error("MOBI章节标识为空或重复");
    seen.add(id);
    // WHY：MOBI文本候选评估直接读公开spine原文，不为提取文字额外写图片；KF8仍须重建skeleton/fragments。
    const html = boundedString(input.kind === "mobi" ? chapter.text : parser.loadChapter(id)?.html, 20000000);
    characters += html.length;
    if (characters > 20000000) throw new Error("MOBI文本输出超限");
    const blocks = mobiHtmlBlocks(html);
    paragraphs += blocks.paragraphs.length;
    if (paragraphs > 100_000) throw new Error("MOBI段落总数超限");
    chapters.push({ id, heading: blocks.heading, paragraphs: blocks.paragraphs });
    await checkResources(input.resourceDir);
  }
  const labels = new Map();
  const stack = [...parser.getToc()].reverse();
  let count = 0;
  while (stack.length) {
    if (++count > 10000) throw new Error("MOBI目录数量超限或存在循环");
    const item = stack.pop();
    if (!item || typeof item !== "object") throw new Error("MOBI目录项无效");
    const label = boundedString(item.label, 4096), href = boundedString(item.href, 4096);
    // WHY：必须通过解析器的真实locator解算目录，不把id=1与filepos:120等子串误当同一章节。
    const resolved = parser.resolveHref(href);
    if (resolved && seen.has(resolved.id) && !labels.has(resolved.id)) {
      characters += label.length;
      if (characters > 20_000_000) throw new Error("MOBI目录与正文累计输出超限");
      labels.set(resolved.id, label);
    }
    if (item.children !== undefined) {
      if (!Array.isArray(item.children) || stack.length + item.children.length > 10000) throw new Error("MOBI目录树无效或超限");
      stack.push(...[...item.children].reverse());
    }
  }
  // WHY：不调用上游fire-and-forget unlink；父进程等待exit后统一异步清理整个私有目录，杜绝删除竞争。
  return { title, authors, chapters: chapters.map(chapter => ({ id: chapter.id, paragraphs: chapter.paragraphs, title: labels.get(chapter.id) || chapter.heading })) };
}

process.once("message", async input => {
  try {
    const result = await run(input);
    process.send?.({ ok: true, result }, error => process.exit(error ? 1 : 0));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.slice(0, 500) : "未知解析错误";
    process.send?.({ ok: false, error: message }, error => process.exit(error ? 1 : 0));
  }
});
