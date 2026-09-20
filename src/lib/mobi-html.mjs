// @ts-check
import { parse } from "parse5";

const IGNORED = new Set(["head", "script", "style", "noscript", "template", "svg"]);
const BLOCKS = new Set(["p", "div", "section", "article", "blockquote", "li", "tr", "pre", "h1", "h2", "h3", "h4", "h5", "h6"]);
/** @typedef {import('parse5').DefaultTreeAdapterTypes.Node} HtmlNode */
/** @typedef {{kind: 'heading'|'paragraph', text: string}} Block */

/**
 * WHY：使用无脚本/无网络的HTML tokenizer，而非<[^>]+>一类可灾难性回溯的正则。
 * 仅由候选worker调用，解析/实体解码/树遍历/规范化均受父进程的截止时间保护。
 * @param {string} html
 * @returns {{heading: string, paragraphs: string[]}}
 */
export function mobiHtmlBlocks(html) {
  if (html.length > 20_000_000) throw new Error("MOBI HTML输入超限");
  const tree = parse(html, { scriptingEnabled: false });
  /** @type {{node: HtmlNode, exit: boolean, heading: boolean}[]} */
  const stack = [{ node: tree, exit: false, heading: false }];
  /** @type {Block[]} */
  const blocks = [];
  /** @type {string[]} */
  let parts = [];
  /** @type {'heading'|'paragraph'} */
  let kind = "paragraph";
  let visited = 0;
  const flush = () => {
    const text = parts.join("").replace(/\s+/gu, " ").trim(); parts = [];
    if (text) blocks.push({ kind, text });
    if (blocks.length > 100_000) throw new Error("MOBI正文段落数超限");
  };
  while (stack.length) {
    const entry = stack.pop();
    if (!entry) break;
    if (++visited > 400_000) throw new Error("MOBI HTML节点数超限");
    const { node } = entry;
    const tag = "tagName" in node ? node.tagName : "";
    if (IGNORED.has(tag)) continue;
    if (entry.exit) { flush(); continue; }
    if ("value" in node) { const next = entry.heading ? "heading" : "paragraph"; if (kind !== next) flush(); kind = next; parts.push(node.value); continue; }
    if (tag === "br" || tag === "td" || tag === "th") parts.push(" ");
    const heading = /^h[1-6]$/u.test(tag);
    if (BLOCKS.has(tag)) { flush(); stack.push({ ...entry, exit: true }); }
    if ("childNodes" in node) {
      if (stack.length + node.childNodes.length > 200_000) throw new Error("MOBI HTML节点栈超限");
      for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push({ node: node.childNodes[i], exit: false, heading: heading || entry.heading });
    }
  }
  flush();
  const firstHeading = blocks.findIndex(block => block.kind === "heading");
  // WHY：首标题用于章节标题，其余子标题保留为文字；标题同文的真实段落不能被过滤。
  return { heading: blocks[firstHeading]?.text ?? "", paragraphs: blocks.filter((_, index) => index !== firstHeading).map(block => block.text) };
}
