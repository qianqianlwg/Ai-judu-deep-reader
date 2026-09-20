// @ts-check
import { generate, parse, walk } from '../../public/vendor/foliate/vendor/csstree.esm.js';

/** @typedef {(value: string) => Promise<string>} MobiCssUrlResolver */
/** @typedef {Record<string, unknown> & {type: string}} CssNode */
const MAX_CSS = 8 * 1024 * 1024;
const MAX_URLS = 20_000;
const TOKEN = /^mobi-resource-v1\/[A-Za-z0-9_-]+\.[a-z0-9]+(?:#[A-Za-z0-9._~:%-]+)?$/u;
const CONTROLS = /[\u0000-\u0020\u007f\\]/u;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** @param {unknown} value @returns {CssNode} */
function node(value) {
  if (!record(value) || typeof value.type !== 'string') throw new Error('MOBI CSS URL: invalid parser node');
  return /** @type {CssNode} */ (value);
}
/** @param {CssNode} value @returns {CssNode[]} */
function children(value) {
  const list = value.children;
  if (!record(list) || typeof list.toArray !== 'function') throw new Error('MOBI CSS URL: invalid parser list');
  const entries = /** @type {unknown} */ (list.toArray());
  if (!Array.isArray(entries)) throw new Error('MOBI CSS URL: invalid parser children');
  return entries.map(node);
}
/** @param {string} value @returns {boolean} */
function isToken(value) {
  if (!value.startsWith('mobi-resource-v1/')) return false;
  if (value.length > 4096 || TOKEN.exec(value)?.[0] !== value || value.split('#', 1)[0].length > 512) {
    throw new Error('MOBI CSS URL: invalid resource token');
  }
  const fragment = value.indexOf('#');
  if (fragment >= 0) {
    /** @type {string} */
    let decoded;
    try { decoded = decodeURIComponent(value.slice(fragment + 1)); }
    catch (cause) { throw new Error('MOBI CSS URL: invalid token fragment', { cause }); }
    if (decoded.length > 1024 || /[\u0000-\u001f\u007f\\]/u.test(decoded)) {
      throw new Error('MOBI CSS URL: invalid token fragment');
    }
  }
  return true;
}
/** @param {unknown} value @returns {value is string} */
function transportResult(value) {
  return typeof value === 'string' && value.length <= 4096 && !CONTROLS.test(value)
    && ((value.startsWith('blob:') && value.length > 5) || (value.startsWith('#') && value.length > 1));
}

/**
 * 已净化 CSS 的最终运输层：只将受控资源 token 改写为调用方管理的 blob URL/本地片段。
 * 不是初次净化器，不验证资源归属或创建 URL；调用方必须保证输入已净化及返回 URL 的可信归属。
 * @param {string} source
 * @param {MobiCssUrlResolver} resolve
 * @param {boolean} [inline]
 * @returns {Promise<string>}
 */
export async function rewriteMobiCssUrls(source, resolve, inline = false) {
  if (typeof source !== 'string' || typeof resolve !== 'function' || typeof inline !== 'boolean') {
    throw new TypeError('MOBI CSS URL: invalid arguments');
  }
  if (source.length > MAX_CSS) throw new Error('MOBI CSS URL: input exceeds 8 MiB characters');
  /** @type {CssNode} */
  let ast;
  try {
    ast = node(parse(source, {
      context: inline ? 'declarationList' : 'stylesheet',
      // WHY：supports 解析会尝试不同语法分支；以最终 AST 的 Raw/异常判失败，不能在分支回退时提前抛出。
    }));
  } catch (cause) { throw new Error('MOBI CSS URL: parse failed', { cause }); }

  /** @type {Set<CssNode>} */
  const targets = new Set();
  walk(ast, (/** @type {unknown} */ value) => {
    const part = node(value);
    if (part.type === 'Raw') throw new Error('MOBI CSS URL: unparsed CSS; sanitized input required');
    if (part.type === 'Url') targets.add(part);
    if (part.type === 'Atrule' && typeof part.name === 'string' && part.name.toLowerCase() === 'import') {
      const prelude = node(part.prelude);
      if (prelude.type !== 'AtrulePrelude') throw new Error('MOBI CSS URL: invalid import prelude');
      const first = children(prelude)[0];
      if (!first || !['String', 'Url'].includes(first.type)) throw new Error('MOBI CSS URL: invalid import target');
      // WHY：只登记 import 首目标，不动后续条件；Set 按节点身份防止 Url 目标被 walk 重复登记。
      targets.add(first);
    }
    if (targets.size > MAX_URLS) throw new Error('MOBI CSS URL: URL count exceeds limit');
  });

  let budget = source.length;
  for (const target of targets) {
    if (typeof target.value !== 'string') throw new Error('MOBI CSS URL: invalid URL value');
    const original = target.value;
    if (!isToken(original)) continue;
    // WHY：顺序解析且不去重资源出现位置，保留 import/layer/supports/media 的级联与调用次序。
    const result = /** @type {unknown} */ (await resolve(original));
    if (!transportResult(result)) throw new Error('MOBI CSS URL: invalid resolver result (expected blob URL/local fragment)');
    budget += Math.max(0, result.length - original.length);
    if (budget > MAX_CSS) throw new Error('MOBI CSS URL: output exceeds 8 MiB characters');
    target.value = result;
  }
  // WHY：只修改已定位 AST 节点，不全文替换、不重跑 sanitizeCss；否则会改掉惰性字符串或丢失 import。
  const output = /** @type {unknown} */ (generate(ast));
  if (typeof output !== 'string') throw new Error('MOBI CSS URL: invalid parser output');
  if (output.length > MAX_CSS) throw new Error('MOBI CSS URL: output exceeds 8 MiB characters');
  return output;
}
