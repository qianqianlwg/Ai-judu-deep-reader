// @ts-check
import { parse as parseHtml } from "parse5";
import { parse, walk, generate } from "../../public/vendor/foliate/vendor/csstree.esm.js";

const MAX_HTML = 20_000_000, MAX_CSS = 2 * 1024 * 1024, MAX_NODES = 100_000, MAX_PATCHES = 10_000;
const RESOURCE = /^kindle:(flow|embed):[A-Za-z0-9_]+(?:\?mime=[A-Za-z0-9+.-]+\/[A-Za-z0-9+.-]+)?$/u;
const ATTRIBUTES = new Set(["src", "href", "xlink:href", "poster", "background", "data"]);
/** @typedef {(uri: string) => string} Replace */
/** @typedef {{nodes: number, patches: number}} Budget */
/** @typedef {{start: number, end: number, value: string}} Patch */
/** @typedef {import('parse5').DefaultTreeAdapterTypes.Node} HtmlNode */
/** @typedef {{parse: (source: string, options: {positions: boolean, context: string, parseCustomProperty: boolean, onParseError: (error: unknown) => never}) => unknown,
 * walk: (ast: unknown, callback: (node: unknown) => void) => void, generate: (node: {type: 'Url', value: string}) => unknown}} CssApi */
// WHY：固定 vendor 的无类型接口只在这里收窄；AST 和 generate 结果仍须运行时检查，不让 any 扩散。
const css = /** @type {CssApi} */ (/** @type {unknown} */ ({ parse, walk, generate }));
/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** @param {unknown} text @param {unknown} replace @param {number} limit */
function validate(text, replace, limit) {
  if (typeof text !== "string" || text.length > limit || typeof replace !== "function") throw new Error("MOBI资源改写输入类型或长度超限");
}
/** @param {Budget} budget */
function countNode(budget) { if (++budget.nodes > MAX_NODES) throw new Error("MOBI资源改写节点超限"); }
/** @param {string} uri @param {Replace} replace @returns {string} */
function replaced(uri, replace) {
  if (RESOURCE.exec(uri)?.[0] !== uri) return uri;
  const result = replace(uri);
  if (typeof result !== "string" || result.length > MAX_HTML) throw new Error("MOBI资源回调结果类型或长度超限");
  return result;
}
/** @param {string} source @param {number} limit @param {Budget} budget */
function patchesFor(source, limit, budget) {
  /** @type {Patch[]} */ const patches = [];
  let outputLength = source.length;
  return {
    /** @param {number} start @param {number} end @param {string} value */
    add(start, end, value) {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > source.length) throw new Error("MOBI资源源码位置无效");
      if (source.slice(start, end) === value) return;
      if (++budget.patches > MAX_PATCHES) throw new Error("MOBI资源改写patch超限");
      outputLength += value.length - (end - start);
      if (outputLength > limit) throw new Error("MOBI资源改写输出超限");
      patches.push({ start, end, value });
    },
    finish() {
      // WHY：按原始位置逆序拼接，不序列化整棵树；同时避免逐patch复制全文的平方复杂度。
      patches.sort((a, b) => b.start - a.start);
      /** @type {string[]} */ const chunks = [];
      let end = source.length;
      for (const patch of patches) {
        if (patch.end > end) throw new Error("MOBI资源源码patch重叠");
        chunks.push(source.slice(patch.end, end), patch.value); end = patch.start;
      }
      chunks.push(source.slice(0, end));
      return chunks.reverse().join("");
    },
  };
}
/** @param {unknown} node @returns {{start: number, end: number}} */
function cssLocation(node) {
  if (!record(node) || !record(node.loc) || !record(node.loc.start) || !record(node.loc.end)
    || typeof node.loc.start.offset !== "number" || typeof node.loc.end.offset !== "number") throw new Error("MOBI CSS源码位置缺失");
  return { start: node.loc.start.offset, end: node.loc.end.offset };
}
/** @param {string} source @param {Replace} replace @param {boolean} inline @param {Budget} budget */
function rewriteCss(source, replace, inline, budget) {
  validate(source, replace, MAX_CSS);
  const patches = patchesFor(source, MAX_CSS, budget);
  const ast = css.parse(source, { positions: true, context: inline ? "declarationList" : "stylesheet", parseCustomProperty: true,
    onParseError(error) { throw error; } });
  css.walk(ast, node => {
    countNode(budget);
    if (!record(node) || typeof node.type !== "string") throw new Error("MOBI CSS节点无效");
    // WHY：@import首个String也是资源引用；只在该语义位置处理，content等普通字符串保持原样。
    let reference = node;
    if (node.type === "Atrule" && typeof node.name === "string" && node.name.toLowerCase() === "import") {
      if (!record(node.prelude) || !record(node.prelude.children)) return;
      const first = node.prelude.children.first;
      if (!record(first) || first.type !== "String") return;
      reference = first;
    } else if (node.type !== "Url") return;
    if (typeof reference.value !== "string") throw new Error("MOBI CSS URL值无效");
    const value = replaced(reference.value, replace);
    if (value === reference.value) return;
    const generated = css.generate({ type: "Url", value });
    if (typeof generated !== "string") throw new Error("MOBI CSS生成结果无效");
    const location = cssLocation(reference);
    // WHY：CSS转义保留URL语义，避免回调结果中的 </style> 结束HTML原始文本元素；这不是sanitize。
    patches.add(location.start, location.end, generated.replaceAll("<", "\\3c "));
  });
  return patches.finish();
}
/**
 * 只改写 CSS AST Url 与 import 规则首个 String，不执行、不请求、不净化；返回内容仍不可信。预算按 UTF-16 单位计。
 * @param {string} source @param {Replace} replace @param {boolean} [inline]
 */
export function rewriteMobiResourceCss(source, replace, inline = false) {
  if (typeof inline !== "boolean") throw new Error("MOBI CSS上下文无效");
  return rewriteCss(source, replace, inline, { nodes: 0, patches: 0 });
}
/** @param {string} value */
function attributeValue(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
/**
 * 保留所有未改写的原始源码；HTML解析不会执行脚本或加载资源。此函数不是sanitize。
 * @param {string} source @param {Replace} replace
 */
export function rewriteMobiResourceMarkup(source, replace) {
  validate(source, replace, MAX_HTML);
  const budget = { nodes: 0, patches: 0 }, patches = patchesFor(source, MAX_HTML, budget);
  // WHY：用文档解析容纳 head/body 片段及 SVG 命名空间；只拿位置，不输出隐式 html/head/body 包装。
  const tree = parseHtml(source, { sourceCodeLocationInfo: true, scriptingEnabled: true });
  /** @type {HtmlNode[]} */ const stack = [tree];
  while (stack.length) {
    const node = stack.pop(); if (!node) throw new Error("MOBI HTML节点缺失");
    countNode(budget);
    if ("tagName" in node) {
      if (node.tagName === "script") continue;
      for (const attr of node.attrs) {
        const name = attr.prefix ? attr.prefix + ":" + attr.name : attr.name;
        if (!ATTRIBUTES.has(name) && name !== "style") continue;
        // parse5已执行一次HTML实体解码；不可再手动解码，也不可重序列化未修改属性。
        const value = name === "style" ? rewriteCss(attr.value, replace, true, budget) : replaced(attr.value, replace);
        if (value === attr.value) continue;
        const location = node.sourceCodeLocation?.attrs?.[name];
        if (!location) throw new Error("MOBI HTML属性源码位置缺失");
        const originalName = /^[^\s=/>]+/u.exec(source.slice(location.startOffset, location.endOffset))?.[0];
        if (!originalName) throw new Error("MOBI HTML属性名缺失");
        patches.add(location.startOffset, location.endOffset, originalName + '="' + attributeValue(value) + '"');
      }
      if (node.tagName === "style") {
        const type = node.attrs.find(attr => attr.name === "type")?.value;
        if (type && type.toLowerCase() !== "text/css") continue;
        const location = node.sourceCodeLocation;
        if (!location?.startTag) throw new Error("MOBI style源码位置缺失");
        const start = location.startTag.endOffset, end = location.endTag?.startOffset ?? location.endOffset;
        if (end > start) patches.add(start, end, rewriteCss(source.slice(start, end), replace, false, budget));
        continue;
      }
    }
    if ("content" in node) stack.push(node.content);
    if ("childNodes" in node) {
      if (stack.length + node.childNodes.length > MAX_NODES) throw new Error("MOBI资源改写节点超限");
      for (let index = node.childNodes.length - 1; index >= 0; index--) stack.push(node.childNodes[index]);
    }
  }
  return patches.finish();
}
/**
 * MOBI6旧属性的语义投影；只处理真实HTML元素，注释/脚本/模板内字面内容保持原样。
 * WHY：定位与实际布局必须使用同一明确转换，不能忽略所有属性后把不同图片/同文节点视为同一来源。
 * @param {string} source @param {(index: number) => string | undefined} load
 */
export function rewriteMobiLegacyMarkup(source, load) {
  validate(source, load, MAX_HTML);
  const budget = {nodes:0,patches:0}, patches=patchesFor(source,MAX_HTML,budget);
  const tree=parseHtml(source,{sourceCodeLocationInfo:true,scriptingEnabled:true});
  /** @type {HtmlNode[]} */ const stack=[tree];
  while(stack.length){
    const node=stack.pop();if(!node)throw new Error('MOBI旧属性节点缺失');countNode(budget);
    if('tagName' in node){
      if(['script','template','noscript'].includes(node.tagName))continue;
      if(node.namespaceURI==='http://www.w3.org/1999/xhtml')for(const attr of node.attrs){
        const destination=attr.name==='filepos'&&node.tagName==='a'?'href':attr.name==='recindex'&&node.tagName==='img'?'src':attr.name==='mediarecindex'&&['video','audio'].includes(node.tagName)?'src':attr.name==='recindex'&&['video','audio'].includes(node.tagName)?'poster':null;
        if(!destination)continue;
        if(/^\d+$/u.exec(attr.value)?.[0]!==attr.value||attr.value.length>16||!Number.isSafeInteger(Number(attr.value)))throw new Error('MOBI旧属性整数无效');
        const number=Number(attr.value);if(attr.name!=='filepos'&&(number<1||number>0xffffffff))throw new Error('MOBI资源索引无效');
        if(node.attrs.some(other=>other.name===destination))throw new Error('MOBI新旧属性冲突');
        const value=attr.name==='filepos'?'filepos:'+attr.value:load(number);
        if(value===undefined)continue;
        if(typeof value!=='string'||!value||value.length>4096)throw new Error('MOBI旧属性输出无效');
        const location=node.sourceCodeLocation?.attrs?.[attr.name];if(!location)throw new Error('MOBI旧属性源码位置缺失');
        patches.add(location.startOffset,location.endOffset,destination+'="'+attributeValue(value)+'"');
      }
    }
    if('childNodes' in node)for(let i=node.childNodes.length-1;i>=0;i--)stack.push(node.childNodes[i]);
  }
  return patches.finish();
}
