// @ts-check
import { generate, lexer, parse, walk } from '../../public/vendor/foliate/vendor/csstree.esm.js';
import { sanitizeCss } from '../../public/vendor/foliate/security-css.js';

/** @typedef {'style'|'css'} MobiCssRole */
/** @typedef {(value: string, role: MobiCssRole) => Promise<string|null>} MobiCssResolver */
/** @typedef {Record<string, unknown> & {type: string}} CssNode */
const MAX_INPUT = 2 * 1024 * 1024;
const MAX_OUTPUT = 8 * 1024 * 1024;
const TOKEN = /^mobi-resource-v1\/[A-Za-z0-9_-]+\.[a-z0-9]+$/u;
const FRAGMENT = /^#[A-Za-z0-9._~:%-]+$/u;
const CONTROLS = /[\u0000-\u0020\u007f\\]/u;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** @param {unknown} value @returns {value is CssNode} */
function isNode(value) {
  return record(value) && typeof value.type === 'string';
}
/** @param {unknown} value @returns {CssNode} */
function node(value) {
  if (!isNode(value)) throw new Error('MOBI CSS: invalid parser node');
  return value;
}
/** @param {CssNode} value @returns {CssNode[]} */
function children(value) {
  const list = value.children;
  if (!record(list) || typeof list.toArray !== 'function') {
    throw new Error('MOBI CSS: invalid parser list');
  }
  const entries = /** @type {unknown} */ (list.toArray());
  if (!Array.isArray(entries)) throw new Error('MOBI CSS: invalid parser children');
  return entries.map(node);
}
/** @param {CssNode} ast @param {(value: CssNode) => void} visit */
function visitNodes(ast, visit) {
  walk(ast, (/** @type {unknown} */ value) => visit(node(value)));
}
/** @param {CssNode} ast @returns {string} */
function print(ast) {
  const result = /** @type {unknown} */ (generate(ast));
  if (typeof result !== 'string') throw new Error('MOBI CSS: invalid parser output');
  return result;
}
/** @param {CssNode} ast */
function name(ast) {
  return typeof ast.name === 'string' ? ast.name.toLowerCase() : '';
}
/** @param {string} value @returns {string|null} */
function decode(value) {
  try { return decodeURIComponent(value); }
  catch (cause) { if (cause instanceof URIError) return null; throw cause; }
}
/** @param {string} value */
function localReference(value) {
  if (!value || value.length > 4096 || CONTROLS.test(value)) return false;
  const decoded = decode(value);
  return decoded !== null && !CONTROLS.test(decoded) && !decoded.includes('%')
    && !decoded.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/iu.test(decoded);
}
/** @param {unknown} value @returns {value is string} */
function safeResult(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || CONTROLS.test(value)) return false;
  const split = value.indexOf('#');
  const path = split < 0 ? value : value.slice(0, split);
  const fragment = split < 0 ? '' : value.slice(split);
  if (path && (path.length > 512 || TOKEN.exec(path)?.[0] !== path)) return false;
  if (!path && !fragment) return false;
  if (fragment) {
    if (FRAGMENT.exec(fragment)?.[0] !== fragment) return false;
    const decoded = decode(fragment.slice(1));
    if (decoded === null || decoded.length > 1024 || /[\u0000-\u001f\u007f\\]/u.test(decoded)) return false;
  }
  return true;
}
/** @param {CssNode} rule */
function matchesPrelude(rule) {
  const fixedLexer = /** @type {unknown} */ (lexer);
  if (!record(fixedLexer) || typeof fixedLexer.matchAtrulePrelude !== 'function') {
    throw new Error('MOBI CSS: pinned lexer unavailable');
  }
  const result = /** @type {unknown} */ (fixedLexer.matchAtrulePrelude(name(rule), rule.prelude));
  return record(result) && Boolean(result.matched) && !result.error;
}
/** @param {CssNode} rule */
function layerStatement(rule) {
  if (rule.type !== 'Atrule' || name(rule) !== 'layer' || rule.block !== null || !matchesPrelude(rule)) return false;
  if (!isNode(rule.prelude) || rule.prelude.type !== 'AtrulePrelude') return false;
  const parts = children(rule.prelude);
  return parts.length === 1 && parts[0].type === 'LayerList' && children(parts[0]).length > 0;
}

/** @param {CssNode} ast @param {string} source */
function original(ast, source) {
  const loc = ast.loc;
  if (!record(loc) || !record(loc.start) || !record(loc.end)
    || typeof loc.start.offset !== 'number' || typeof loc.end.offset !== 'number'
    || !Number.isSafeInteger(loc.start.offset) || !Number.isSafeInteger(loc.end.offset)
    || loc.start.offset < 0 || loc.end.offset < loc.start.offset || loc.end.offset > source.length) {
    throw new Error('MOBI CSS: invalid source location');
  }
  return source.slice(loc.start.offset, loc.end.offset);
}
/** @param {CssNode} rule @param {string} source @returns {Promise<CssNode>} */
async function validateImport(rule, source) {
  if (rule.block !== null || !isNode(rule.prelude) || rule.prelude.type !== 'AtrulePrelude' || !matchesPrelude(rule)) {
    throw new Error('MOBI CSS: invalid @import prelude/block');
  }
  const [target, ...conditions] = children(rule.prelude);
  if (!target || !['String', 'Url'].includes(target.type) || typeof target.value !== 'string') {
    throw new Error('MOBI CSS: @import requires a string/url target');
  }
  /** @type {Map<string, string>} */
  const checks = new Map();
  for (const condition of conditions) {
    if (condition.type === 'Function') {
      const parts = children(condition);
      const kind = name(condition);
      if (parts.length !== 1 || (kind === 'layer' ? parts[0].type !== 'Layer'
        : kind !== 'supports' || !['Declaration', 'Condition'].includes(parts[0].type))) {
        throw new Error('MOBI CSS: invalid/empty @import condition');
      }
    } else if (!(condition.type === 'Identifier' && name(condition) === 'layer')
      && condition.type !== 'MediaQueryList') {
      throw new Error('MOBI CSS: unknown @import condition');
    }
    visitNodes(condition, part => {
      if (['Raw', 'GeneralEnclosed', 'Url'].includes(part.type)) {
        throw new Error('MOBI CSS: unsupported @import condition (Raw/unknown/URL)');
      }
      if (part.type === 'Declaration') checks.set(original(part, source), print(part));
      if (part.type === 'Function' && part !== condition) checks.set(`x:${original(part, source)}`, `x:${print(part)}`);
    });
  }
  // WHY：条件不能被“净化成另一种条件”后继续导入；借用固定净化器验证声明/函数，变化即拒绝整个样式表。
  for (const [check, expected] of checks) {
    if (await sanitizeCss(check, async () => null, true) !== expected) {
      throw new Error('MOBI CSS: unsafe @import condition rejected by pinned sanitizer');
    }
  }
  return target;
}

/**
 * WHY：固定净化器的序列化会把惰性字符串里的引号输出为\\"，再次净化不能误拒绝自己的输出。
 * 仅content/quotes/font-family的直接String节点临时替换成惰性哨兵；URL、函数、标识符转义仍拒绝。
 * @param {string} source @param {MobiCssResolver} resolve @param {boolean} inline
 */
async function sanitizeQuotedStrings(source,resolve,inline){
  const ast=node(parse(source,{context:inline?'declarationList':'stylesheet',positions:true}));
  /** @type {{start:number,end:number,key:string,value:string}[]} */const replacements=[];
  let prefix='judu-safe-literal-';while(source.includes(prefix))prefix+='x';
  visitNodes(ast,part=>{
    if(part.type!=='Declaration'||typeof part.property!=='string'||!['content','quotes','font-family'].includes(part.property.toLowerCase())||!isNode(part.value))return;
    for(const candidate of children(part.value)){
      if(candidate.type!=='String'||typeof candidate.value!=='string')continue;
      const raw=original(candidate,source);if(!raw.includes('\\'))continue;
      // WHY：只接受被序列化器插入的引号转义，不接纳十六进制、换行、URL或标识符转义。
      if(/\\(?!["'])/u.test(raw))throw new Error('MOBI CSS: escapes/control characters unsupported by pinned sanitizer');
      const loc=candidate.loc;
      if(!record(loc)||!record(loc.start)||!record(loc.end)||typeof loc.start.offset!=='number'||typeof loc.end.offset!=='number')throw new Error('MOBI CSS: invalid literal location');
      replacements.push({start:loc.start.offset,end:loc.end.offset,key:prefix+replacements.length,value:candidate.value});
    }
  });
  let masked=source;for(const replacement of [...replacements].sort((a,b)=>b.start-a.start))masked=masked.slice(0,replacement.start)+'"'+replacement.key+'"'+masked.slice(replacement.end);
  if(masked.includes('\\')||!replacements.length)throw new Error('MOBI CSS: escapes/control characters unsupported by pinned sanitizer');
  const safe=await sanitizeMobiCss(masked,resolve,inline),result=node(parse(safe,{context:inline?'declarationList':'stylesheet'}));
  const values=new Map(replacements.map(r=>[r.key,r.value]));
  visitNodes(result,part=>{if(part.type==='String'&&typeof part.value==='string'&&values.has(part.value))part.value=values.get(part.value);});
  const output=print(result);if(output.length>MAX_OUTPUT)throw new Error('MOBI CSS: output exceeds 8 MiB characters');return output;
}

/**
 * 固定 Foliate CSS 净化器的包内 import 包装层，返回 CSS 字符串（不是资源安全证明）。
 * 非本地地址/null 被删除；非法位置、import Raw、未知条件或畸形 resolver 结果抛出具名错误。
 * 资源存在性、MIME/角色、递归/循环/深度及最终 token 运输由调用者的资源图负责。
 * @param {string} source
 * @param {MobiCssResolver} resolve
 * @param {boolean} [inline]
 * @returns {Promise<string>}
 */
export async function sanitizeMobiCss(source, resolve, inline = false) {
  if (typeof source !== 'string' || typeof resolve !== 'function' || typeof inline !== 'boolean') {
    throw new TypeError('MOBI CSS: invalid arguments');
  }
  if (source.length > MAX_INPUT) throw new Error('MOBI CSS: input exceeds 2 MiB characters');
  // WHY：控制字符不接受；仅在AST确认属于惰性字面引号时恢复序列化的安全字符串。
  if (/[\u0000-\u0008\u000b\u000e-\u001f]/u.test(source)) {
    throw new Error('MOBI CSS: escapes/control characters unsupported by pinned sanitizer');
  }
  if(source.includes('\\'))return sanitizeQuotedStrings(source,resolve,inline);
  let ast;
  try { ast = node(parse(source, { context: inline ? 'declarationList' : 'stylesheet', positions: true })); }
  catch (cause) { throw new Error('MOBI CSS: parse failed', { cause }); }
  const roots = children(ast);
  const rootSet = new Set(roots);
  visitNodes(ast, part => {
    if (part.type === 'Atrule' && name(part) === 'import' && (inline || !rootSet.has(part))) {
      throw new Error('MOBI CSS: @import is forbidden inline/nested');
    }
  });
  /** @type {Map<CssNode, CssNode>} */
  const imports = new Map();
  let allowed = true;
  let lastImport = -1;
  // WHY：必须按原始 AST 判位置，不能先删除未知规则再把原本无效的晚到 import 激活。
  for (const [index, rule] of roots.entries()) {
    if (rule.type === 'Atrule' && name(rule) === 'import') {
      if (!allowed) throw new Error('MOBI CSS: @import position is after a rule/non-prefix at-rule');
      imports.set(rule, await validateImport(rule, source));
      lastImport = index;
    } else if (rule.type !== 'Comment' && !layerStatement(rule)
      && !(index === 0 && rule.type === 'Atrule' && name(rule) === 'charset'
        && rule.block === null && matchesPrelude(rule))) {
      allowed = false;
    }
  }
  /** @param {string} value @param {MobiCssRole} role @returns {Promise<string|null>} */
  const checkedResolve = async (value, role) => {
    if (!localReference(value)) return null;
    const result = /** @type {unknown} */ (await resolve(value, role));
    if (result === null) return null;
    if (!safeResult(result)) throw new Error(`MOBI CSS: invalid resolver result (${role})`);
    return result;
  };
  const cssResolve = (/** @type {string} */ value) => checkedResolve(value, 'css');
  /** @type {string[]} */
  const output = [];
  // WHY：只分离合法 import 前缀，不展开导入，不移动 layer、不去重；级联次序保持源文件顺序。
  for (const rule of roots.slice(0, lastImport + 1)) {
    const target = imports.get(rule);
    if (target) {
      if (typeof target.value !== 'string') throw new Error('MOBI CSS: invalid import target');
      const resolved = await checkedResolve(target.value, 'style');
      if (resolved !== null) { target.value = resolved; output.push(print(rule)); }
    } else {
      output.push(await sanitizeCss(original(rule, source), cssResolve));
    }
  }
  // WHY：普通规则传原始切片，不能先 generate；序列化会把惰性引号转成转义字符，误触固定净化器的拒绝门禁。
  const rest = lastImport < 0 ? source : roots.slice(lastImport + 1).map(rule => original(rule, source)).join('');
  output.push(await sanitizeCss(rest, cssResolve, inline));
  const result = output.join('');
  if (result.length > MAX_OUTPUT) throw new Error('MOBI CSS: output exceeds 8 MiB characters');
  return result;
}
