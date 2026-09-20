// @ts-check
import { createHash } from "node:crypto";
import { parse, parseFragment, defaultTreeAdapter, html as parse5Html } from "parse5";
import { EntityDecoder, DecodingMode, htmlDecodeTree } from "entities/decode";

/** @typedef {{kind: 'element', path: number[], tag: string, offset: 0} | {kind: 'text', path: number[], text: string, offset: number}} MobiSourcePoint */
/** @typedef {import('parse5').DefaultTreeAdapterTypes.Node} Node */
/** @typedef {import('parse5').DefaultTreeAdapterTypes.Element} Element */
/** @typedef {import('parse5').DefaultTreeAdapterTypes.TextNode} Text */
/** @typedef {{node: Text, start: number, end: number, map?: Int32Array | null}} TextEntry */
const MAX_HTML = 20_000_000, MAX_NODES = 400_000, MAX_DEPTH = 128;
const HTML_NS = parse5Html.NS.HTML;
const EXCLUDED = new Set(["head", "script", "style", "template", "noscript", "title", "meta", "link", "base", "iframe", "object", "embed", "canvas", "input", "textarea", "select", "xmp", "plaintext", "noembed", "noframes"]);
/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** @param {Element} node */
export function isMobiSourceElementExcluded(node) {
  // WHY：此层没有浏览器样式计算；保守排除已知隐藏语义与非HTML命名空间，不声称解析外部CSS的可见性。
  if (node.namespaceURI !== HTML_NS || EXCLUDED.has(node.tagName)) return true;
  return node.attrs.some(({ name, value }) => ["hidden", "inert", "data-judu-decoration"].includes(name)
    || (name === "aria-hidden" && value.trim().toLowerCase() === "true")
    || (name === "style" && (/\\/u.test(value) || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|content-visibility\s*:\s*hidden)\s*(?:!\s*important\s*)?(?:;|$)/iu.test(value.replace(/\/\*[\s\S]*?\*\//gu, "")))));
}
/** @param {string} text @param {number} offset */
function boundary(text, offset) {
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= text.length
    && !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/u.test(text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(text[offset]));
}
/** @param {string} html @param {TextEntry} entry */
function textMap(html, entry) {
  if (entry.map !== undefined) return entry.map;
  // WHY：一次完整解码并与parse5全文核对，绝不对查询prefix独立解码，否则半个实体会冒充正文。
  entry.map = null;
  const raw = html.slice(entry.start, entry.end), expected = entry.node.value;
  const offsets = new Int32Array(raw.length + 1).fill(-1);
  let i = 0, decoded = 0, entity = "";
  const decoder = new EntityDecoder(htmlDecodeTree, codepoint => { entity += String.fromCodePoint(codepoint); });
  offsets[0] = 0;
  while (i < raw.length) {
    let consumed = 1, value = raw[i];
    if (value === "&") {
      entity = ""; decoder.startEntity(DecodingMode.Legacy);
      let count = decoder.write(raw, i + 1); if (count < 0) count = decoder.end();
      if (count > 0) { consumed = count; value = entity; }
    } else if (value === "\r") {
      consumed = raw[i + 1] === "\n" ? 2 : 1; value = "\n";
    } else {
      const cp = raw.codePointAt(i);
      if (cp === undefined || cp === 0 || (cp >= 0xd800 && cp <= 0xdfff)) return null;
      if (cp > 0xffff) { consumed = 2; value = raw.slice(i, i + 2); }
    }
    if (!expected.startsWith(value, decoded)) return null;
    i += consumed; decoded += value.length;
    if (i > raw.length) return null;
    offsets[i] = decoded;
  }
  if (decoded !== expected.length) return null;
  entry.map = offsets;
  return offsets;
}

/** @param {Node | undefined} body @param {WeakSet<Node>} allowed */
function structureOf(body, allowed) {
  const hash = createHash("sha256");
  /** @type {Node[]} */ const stack = body ? [body] : [];
  let bytes = 0;
  hash.update("mobi-source-body-v1\n");
  while (stack.length) {
    const node = stack.pop(); if (!node) throw new Error("MOBI结构节点缺失");
    const opaque = "tagName" in node && !allowed.has(node);
    const children = !opaque && "childNodes" in node ? node.childNodes : [];
    const token = "tagName" in node ? [opaque ? "opaque" : "element", node.namespaceURI, node.tagName, node.attrs.map(attr=>[attr.namespace??"",attr.prefix??"",attr.name,attr.value]).sort((a,b)=>{const left=JSON.stringify(a),right=JSON.stringify(b);return left<right?-1:left>right?1:0;}), children.length]
      : node.nodeName === "#text" && "value" in node ? ["text", node.value] : [node.nodeName, children.length];
    const json = JSON.stringify(token) + "\n";
    bytes += Buffer.byteLength(json, "utf8");
    if (bytes > 128 * 1024 * 1024) throw new Error("MOBI结构签名总量超限");
    // WHY：先序token带子节点数，保留嵌套/文本/注释位置；流式哈希避免返回或积攒第二份巨型正文。
    // 属性属于节点身份；仅先经受控资源投影后比较，不能忽略id/src让不同同文节点或图片换位。
    hash.update(json);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return hash.digest("hex");
}

/**
 * 源码与DOM偏移均为UTF-16单位，不是字节。仅支持HTML正文；SVG/MathML及已知隐藏区域明确拒绝。
 * 不执行脚本、不请求网络；matches只证明指定路径的局部身份，不证明整本文档/资源安全。
 * @param {string} html
 * @param {"document"|"body-fragment"} [mode]
 * @returns {{readonly structureHash: string, locate: (sourceOffset: number) => MobiSourcePoint | null, matches: (point: unknown) => boolean, matchesTextDigest: (point: unknown) => boolean}}
 */
export function indexMobiSourceHtml(html, mode = "document") {
  if (!["document", "body-fragment"].includes(mode)) throw new Error("MOBI源码解析上下文无效");
  if (typeof html !== "string" || html.length > MAX_HTML) throw new Error("MOBI源码HTML类型或长度超限");
  let created = 0;
  const located = new WeakSet();
  /** @type {import("parse5").ParserOptions<import("parse5").DefaultTreeAdapterMap>} */
  const options = { sourceCodeLocationInfo: true, scriptingEnabled: true, treeAdapter: {
    ...defaultTreeAdapter,
    setNodeSourceCodeLocation(node, location) {
      if (!located.has(node)) { located.add(node); if (++created > MAX_NODES) throw new Error("MOBI源码节点数超限"); }
      defaultTreeAdapter.setNodeSourceCodeLocation(node, location);
    },
  } };
  // WHY：正文片段用真实body上下文解析；完整document解析会把首部空白放在body外，导致节点路径错位。
  const tree = mode === "body-fragment" ? parseFragment(defaultTreeAdapter.createElement("body", HTML_NS, []), html, options) : parse(html, options);
  const htmlElement = tree.childNodes.find(node => "tagName" in node && node.tagName === "html");
  const body = mode === "body-fragment" ? tree : htmlElement && "childNodes" in htmlElement
    ? htmlElement.childNodes.find(node => "tagName" in node && node.tagName === "body") : undefined;
  /** @type {Map<number, Element | null>} */ const starts = new Map();
  /** @type {WeakSet<Node>} */ const allowed = new WeakSet();
  /** @type {WeakMap<Node, {parent: Node, index: number}>} */ const parents = new WeakMap();
  /** @type {WeakMap<Node, TextEntry>} */ const textEntries = new WeakMap();
  /** @type {TextEntry[]} */ const entries = [];
  /** @type {{node: Node, depth: number, blocked: boolean, inBody: boolean}[]} */
  const stack = [{ node: tree, depth: 0, blocked: false, inBody: false }];
  let count = 0;
  while (stack.length) {
    const frame = stack.pop(); if (!frame) throw new Error("MOBI源码节点缺失");
    const { node, depth } = frame;
    // WHY：全树预算包含非正文/template内容及隐式html/head/body；不跳过隐藏区域逃避深度或节点限制。
    if (++count > MAX_NODES || depth > MAX_DEPTH) throw new Error("MOBI源码节点数或深度超限");
    const blocked = frame.blocked || ("tagName" in node && isMobiSourceElementExcluded(node)), inBody = frame.inBody || node === body;
    const eligible = inBody && !blocked;
    if (eligible) allowed.add(node);
    if ("tagName" in node) {
      const start = node.sourceCodeLocation?.startTag?.startOffset;
      if (start !== undefined) starts.set(start, starts.has(start) || !eligible ? null : node);
    } else if (node.nodeName === "#text" && "value" in node && eligible) {
      const location = node.sourceCodeLocation;
      if (location && location.startOffset >= 0 && location.endOffset <= html.length && location.endOffset > location.startOffset) {
        const entry = { node, start: location.startOffset, end: location.endOffset };
        entries.push(entry); textEntries.set(node, entry);
      }
    }
    if ("content" in node) stack.push({ node: node.content, depth: depth + 1, blocked: true, inBody });
    if ("childNodes" in node) {
      if (count + stack.length + node.childNodes.length > MAX_NODES) throw new Error("MOBI源码节点数超限");
      for (let index = node.childNodes.length - 1; index >= 0; index--) {
        const child = node.childNodes[index]; parents.set(child, { parent: node, index });
        stack.push({ node: child, depth: depth + 1, blocked, inBody });
      }
    }
  }
  entries.sort((a, b) => a.start - b.start || a.end - b.end);
  // WHY：重排/合并产生的重叠源码区间全部拒绝，不能挑一个看起来更近的节点；也约束缓存总长度。
  for (let first = 0; first < entries.length;) {
    let last = first + 1, end = entries[first].end;
    while (last < entries.length && entries[last].start < end) { end = Math.max(end, entries[last].end); last++; }
    if (last > first + 1) for (let i = first; i < last; i++) entries[i].map = null;
    first = last;
  }
  /** @param {Node} node */
  function pathFor(node) {
    const result = [];
    while (node !== body) {
      const edge = parents.get(node); if (!edge) throw new Error("MOBI源码正文路径断裂");
      result.push(edge.index); node = edge.parent;
    }
    return result.reverse();
  }
  /** @type {WeakMap<Text, string>} */ const textHashes = new WeakMap();
  /** @param {unknown} path @returns {Node | undefined} */
  function nodeAt(path) {
    if(!Array.isArray(path)||path.length>MAX_DEPTH||Object.keys(path).length!==path.length||!body)return undefined;
    /** @type {Node} */ let node=body;
    for(const index of path){if(!Number.isSafeInteger(index)||index<0||!("childNodes" in node)||index>=node.childNodes.length)return undefined;node=node.childNodes[index];}
    return allowed.has(node)?node:undefined;
  }
  return {
    structureHash: structureOf(body, allowed),
    locate(sourceOffset) {
      if (!Number.isSafeInteger(sourceOffset) || sourceOffset < 0 || sourceOffset > html.length) return null;
      // WHY：相邻元素真实起点优先于上一文本末尾；被排除元素的起点也不能退回上一段冒充正文。
      if (starts.has(sourceOffset)) {
        const node = starts.get(sourceOffset);
        return node ? { kind: "element", path: pathFor(node), tag: node.tagName, offset: 0 } : null;
      }
      let lo = 0, hi = entries.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (entries[mid].start <= sourceOffset) lo = mid + 1; else hi = mid; }
      const entry = entries[lo - 1];
      if (!entry || sourceOffset > entry.end) return null;
      const offset = textMap(html, entry)?.[sourceOffset - entry.start];
      if (offset === undefined || offset < 0 || !boundary(entry.node.value, offset)) return null;
      return { kind: "text", path: pathFor(entry.node), text: entry.node.value, offset };
    },
    matchesTextDigest(point) {
      if(!record(point)||Object.keys(point).length!==5||point.kind!=="text"||typeof point.offset!=="number"||typeof point.textLength!=="number"||typeof point.textHash!=="string")return false;
      const node=nodeAt(point.path),entry=node?textEntries.get(node):undefined;
      if(!entry||entry.node.value.length!==point.textLength||!boundary(entry.node.value,point.offset)||textMap(html,entry)===null)return false;
      let hash=textHashes.get(entry.node);if(!hash){hash=createHash("sha256").update(entry.node.value).digest("hex");textHashes.set(entry.node,hash);}
      return point.textHash===hash;
    },
    matches(point) {
      if (!record(point) || !Array.isArray(point.path) || point.path.length > MAX_DEPTH || Object.keys(point).length !== 4 || !body) return false;
      /** @type {Node} */ let node = body;
      for (let i = 0; i < point.path.length; i++) {
        const index = point.path[i];
        if (!Number.isSafeInteger(index) || index < 0 || !("childNodes" in node) || index >= node.childNodes.length) return false;
        node = node.childNodes[index];
      }
      if (!allowed.has(node)) return false;
      if (point.kind === "element") {
        const start = node.sourceCodeLocation && "startTag" in node.sourceCodeLocation ? node.sourceCodeLocation.startTag?.startOffset : undefined;
        return point.offset === 0 && "tagName" in node && node.tagName === point.tag && start !== undefined && starts.get(start) === node;
      }
      const entry = textEntries.get(node);
      return point.kind === "text" && entry !== undefined && entry.node.value === point.text && typeof point.offset === "number"
        && boundary(entry.node.value, point.offset) && textMap(html, entry) !== null;
    },
  };
}
