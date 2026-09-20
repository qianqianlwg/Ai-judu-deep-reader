// @ts-check
import { Parser, Token, defaultTreeAdapter } from "parse5";
import { isMobiSourceElementExcluded } from "./mobi-source-html.mjs";
/** @typedef {import('parse5').DefaultTreeAdapterTypes.Node} Node */
/** @typedef {import('parse5').DefaultTreeAdapterTypes.Element} Element */
/** @typedef {import('parse5').Token.Token} HtmlToken */
/** @typedef {{start: number, end: number}} Span */
/** @typedef {Span & {node: Element, tag: string, explicit: boolean}} Closure */
/** @typedef {Span & {text: boolean}} Event */
const MAX_HTML = 20_000_000, MAX_NODES = 400_000, MAX_DEPTH = 128;
/** @param {string} reason @returns {never} */
function fail(reason) { throw new Error("MOBI文档投影" + reason); }

/** @extends {Parser<import('parse5').DefaultTreeAdapterMap>} */
class ProjectionParser extends Parser {
  /** @type {HtmlToken | null} */ active = null;
  /** @type {Closure[]} */ closures = [];
  /** @type {Event[]} */ events = [];
  /** @type {WeakSet<object>} */ seen = new WeakSet();
  /** @param {HtmlToken} token @param {() => void} run */
  observe(token, run) {
    if (!this.seen.has(token)) {
      this.seen.add(token);
      const { type, location } = token;
      if (location && type !== Token.TokenType.COMMENT && type !== Token.TokenType.EOF
        && !("chars" in token && /^[\t\n\f\r ]*$/u.test(token.chars))) {
        const event = { start: location.startOffset, end: location.endOffset, text: "chars" in token };
        const last = this.events.at(-1);
        if (event.text && last?.text && last.end <= event.start) last.end = event.end;
        else {
          if (this.events.length >= MAX_NODES * 2) fail("token数量超限");
          this.events.push(event);
        }
      }
    }
    const old = this.active; this.active = token;
    try { run(); } finally { this.active = old; }
  }
  /** @param {import('parse5').Token.TagToken} token */
  onStartTag(token) { this.observe(token, () => super.onStartTag(token)); }
  /** @param {import('parse5').Token.TagToken} token */
  onEndTag(token) { this.observe(token, () => super.onEndTag(token)); }
  /** @param {import('parse5').Token.CharacterToken} token */
  onCharacter(token) { this.observe(token, () => super.onCharacter(token)); }
  /** @param {import('parse5').Token.CharacterToken} token */
  onWhitespaceCharacter(token) { this.observe(token, () => super.onWhitespaceCharacter(token)); }
  /** @param {import('parse5').Token.CharacterToken} token */
  onNullCharacter(token) { this.observe(token, () => super.onNullCharacter(token)); }
  /** @param {import('parse5').Token.CommentToken} token */
  onComment(token) {
    // 注释内伪标签不参与边界，注释本身允许位于容器外。
    this.observe(token, () => super.onComment(token));
  }
  /** @param {import('parse5').Token.DoctypeToken} token */
  onDoctype(token) { this.observe(token, () => super.onDoctype(token)); }
  /** @param {import('parse5').Token.EOFToken} token */
  onEof(token) { this.observe(token, () => super.onEof(token)); }
  /** @param {Element} node @param {HtmlToken} token */
  _setEndLocation(node, token) {
    const current = this.active;
    // WHY：观察解析器真正关闭/弹出的节点，而非词法标签。隐式body没有location，仍能由该hook证明关闭被接受。
    // head被字符触发关闭时parse5的currentToken可能滞后；用当前实际派发token确定边界，不相信滞后的endOffset。
    if (current?.location && node.namespaceURI === "http://www.w3.org/1999/xhtml") {
      const isEnd = current.type === Token.TokenType.END_TAG;
      if (node.tagName === "head" || (["body", "html"].includes(node.tagName) && isEnd && ["body", "html"].includes(current.tagName))) {
        if (this.closures.length >= MAX_NODES) fail("关闭边界数量超限");
        this.closures.push({ node, start: current.location.startOffset, end: current.location.endOffset,
          tag: "tagName" in current ? current.tagName : "", explicit: isEnd && current.tagName === node.tagName });
      }
    }
    super._setEndLocation(node, token);
  }
}
/** @param {Node} tree */
function checkTree(tree) {
  const stack = [{ node: tree, depth: 0 }]; let count = 0;
  while (stack.length) {
    const entry = stack.pop(); if (!entry) fail("节点缺失");
    const { node, depth } = entry;
    if (++count > MAX_NODES || depth > MAX_DEPTH) fail("节点数或深度超限");
    if ("content" in node) stack.push({ node: node.content, depth: depth + 1 });
    if ("childNodes" in node) {
      if (count + stack.length + node.childNodes.length > MAX_NODES) fail("节点数超限");
      for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push({ node: node.childNodes[i], depth: depth + 1 });
    }
  }
}
/** @param {Span} inner @param {Span} outer */
function within(inner, outer) { return inner.start >= outer.start && inner.end <= outer.end; }
/** @param {import('parse5').Token.Location | null | undefined} location @returns {Span | null} */
function span(location) { return location ? { start: location.startOffset, end: location.endOffset } : null; }

/**
 * 只返回原始源码切片；所有offset均为原字符串UTF-16单位，不是字节。不执行脚本、样式或网络请求。
 * @param {string} html
 * @returns {{bodyAllowed: boolean, body: string, head: string, start: number, end: number, prefixEnd: number}}
 */
export function projectMobiDocument(html) {
  if (typeof html !== "string" || html.length > MAX_HTML) fail("输入类型或20M长度预算无效");
  let created = 0; const located = new WeakSet();
  const parser = new ProjectionParser({ sourceCodeLocationInfo: true, scriptingEnabled: true, treeAdapter: {
    ...defaultTreeAdapter,
    setNodeSourceCodeLocation(node, location) {
      if (!located.has(node)) { located.add(node); if (++created > MAX_NODES) fail("节点数超限"); }
      defaultTreeAdapter.setNodeSourceCodeLocation(node, location);
    },
  } });
  parser.tokenizer.write(html, true);
  checkTree(parser.document);
  const root = parser.document.childNodes.find(node => "tagName" in node && node.tagName === "html");
  if (!root || !("tagName" in root)) fail("缺少可识别的HTML根");
  const body = root.childNodes.find(node => "tagName" in node && node.tagName === "body");
  const head = root.childNodes.find(node => "tagName" in node && node.tagName === "head");
  if (!body || !("tagName" in body) || !head || !("tagName" in head)) fail("不支持frameset或缺失正文容器");
  const rootOpen = span(root.sourceCodeLocation?.startTag), bodyOpen = span(body.sourceCodeLocation?.startTag), headOpen = span(head.sourceCodeLocation?.startTag);
  const doctype = parser.document.childNodes.find(node => node.nodeName === "#documentType");
  const doctypeSpan = span(doctype?.sourceCodeLocation);
  const documentMode = Boolean(rootOpen || bodyOpen || headOpen || doctypeSpan);
  const headClose = parser.closures.find(item => item.node === head);
  const bodyClose = parser.closures.find(item => item.node === body && ["body", "html"].includes(item.tag));
  const rootClose = parser.closures.find(item => item.node === root && item.tag === "html");
  /** @type {Span | null} */ let headContent = null;
  /** @type {Span | null} */ let headOuter = null;
  if (documentMode) {
    if (headOpen) {
      const end = headClose?.start ?? html.length;
      headContent = { start: headOpen.end, end };
      headOuter = { start: headOpen.start, end: headClose?.explicit ? headClose.end : end };
    } else if (head.childNodes.length) {
      const locations = head.childNodes.map(node => span(node.sourceCodeLocation));
      if (locations.some(item => !item)) fail("隐式head的源码范围不明确");
      const spans = /** @type {Span[]} */ (locations);
      headContent = { start: html.length, end: 0 };
      for (const item of spans) { headContent.start = Math.min(headContent.start, item.start); headContent.end = Math.max(headContent.end, item.end); }
      headOuter = headContent;
    }
  }
  // WHY：无显式文档容器时是章节fragment，绝不能按隐式head裁掉开头style/title或空白。
  // 显式head无body用解析器实际head关闭位置；显式body永远以真实startTag.end为切片起点，不trim。
  const start = bodyOpen?.end ?? (headOpen ? headOuter?.end : documentMode ? headClose?.start ?? rootOpen?.end ?? doctypeSpan?.end : 0) ?? 0;
  const end = bodyClose?.start ?? html.length;
  const prefixEnd = bodyOpen?.start ?? start;
  if (start < 0 || end < start || end > html.length || prefixEnd > start) fail("正文边界歧义");
  if (headContent && (headContent.start > headContent.end || headContent.end > start)) fail("head与正文范围重叠");
  if (headContent) {
    for (const node of head.childNodes) {
      const location = span(node.sourceCodeLocation);
      if (!location || !within(location, headContent)) fail("head发生跨边界重排");
    }
  }
  const permitted = [rootOpen, bodyOpen, headOuter, doctypeSpan, bodyClose, rootClose].filter(item => item !== null && item !== undefined);
  const window = { start, end };
  // WHY：完整解析可能把body外尾部文字合并进原文本节点；检查实际token范围才能拒绝裁掉的正文。
  // 仅容器/真实head、解析器接受的关闭标签、空白和注释可位于切片外，任何其他内容都明确失败。
  for (const event of parser.events) if (!within(event, window) && !permitted.some(outer => within(event, outer))) fail("正文容器外存在实质内容或未接受的标签");
  // WHY：裁掉文档容器不能丢失原始祖先的隐藏语义；片段来源索引须沿用这一门禁。
  return { bodyAllowed: !isMobiSourceElementExcluded(root) && !isMobiSourceElementExcluded(body), body: html.slice(start, end), head: headContent ? html.slice(headContent.start, headContent.end) : "", start, end, prefixEnd };
}
