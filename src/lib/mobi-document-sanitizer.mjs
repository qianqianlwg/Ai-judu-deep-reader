// @ts-check
import { defaultTreeAdapter, serialize } from 'parse5';
import {parseMobiSanitizerTree, captureMobiPoints, rebaseMobiPoints} from './mobi-sanitizer-tree.mjs';
import { sanitizeMobiCss } from './mobi-css-sanitizer.mjs';
import {
  DOCUMENT_NAMESPACES,
  isAllowedDocumentAttribute,
  isAllowedDocumentElement,
  isUrlPresentationAttribute,
} from './reader-document-policy.mjs';

const { HTML, SVG, MATH, XML, XLINK, EPUB, XMLNS } = DOCUMENT_NAMESPACES;
const RESOURCE_TOKEN = /^mobi-resource-v1\/[A-Za-z0-9_-]+\.[a-z0-9]+(?:#[A-Za-z0-9._~:%-]+)?$/u;
const FRAGMENT = /^#[A-Za-z0-9._:%~-]+$/u;
const SAFE_NAMESPACES = /** @type {Set<string>} */ (new Set([HTML, SVG, MATH, XML, XLINK, EPUB, XMLNS]));
const RESOURCE_ATTRIBUTES = new Set(['href', 'src', 'poster']);
const DANGEROUS_ELEMENTS = new Set(['script', 'iframe', 'object', 'embed', 'form']);
// WHY：MOBI6常用font包裹实际正文；它是惰性格式元素，删除整棵子树会丢字。属性仍走同一严格净化。
const MOBI_LEGACY_ELEMENTS = new Set(['font']);

/** @typedef {'image'|'style'|'media'|'css'|'navigation'} MobiResourceRole */
/** @typedef {(value: string, role: MobiResourceRole) => string|null|Promise<string|null>} MobiResourceResolver */
/** @typedef {(token: string, role: MobiResourceRole) => boolean|Promise<boolean>} MobiResourceValidator */
/** @typedef {'element'|'attribute'|'resource'|'css'|'comment'} MobiDiagnosticKind */
/** @typedef {{kind: MobiDiagnosticKind, action: 'removed'|'rewritten', name: string, reason: string}} MobiDiagnostic */
/** @typedef {{resolve: MobiResourceResolver, validate: MobiResourceValidator, mode?:'body'|'head'|'document', points?:readonly import('./mobi-layout-snapshot').MobiLayoutPoint[]}} MobiDocumentSanitizerOptions */
/** @typedef {{html: string, head: string, diagnostics: MobiDiagnostic[], points:(import('./mobi-layout-snapshot').MobiLayoutPoint|null)[]}} SanitizedMobiDocument */
/** @typedef {import('parse5').DefaultTreeAdapterTypes.Node} MobiNode */
/** @typedef {import('parse5').DefaultTreeAdapterTypes.Element} MobiElement */
/** @typedef {import('parse5').Token.Attribute} MobiAttribute */
/** @typedef {import('parse5').DefaultTreeAdapterTypes.ParentNode} MobiContainer */

// WHY：这些上限在解析前、遍历中和序列化后分别检查，避免恶意章节用任一阶段耗尽内存。
export const MOBI_DOCUMENT_SANITIZER_LIMITS = Object.freeze({
  inputCharacters: 4 * 1024 * 1024,
  outputCharacters: 8 * 1024 * 1024,
  nodes: 100_000,
  characters: 8 * 1024 * 1024,
  diagnostics: 4_096,
});

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {MobiNode} node @returns {node is MobiElement} */
function isElement(node) {
  return defaultTreeAdapter.isElementNode(node);
}

/** @param {MobiElement} element @returns {string} */
function tagName(element) {
  return element.tagName.toLowerCase();
}

/** @param {MobiAttribute} attribute @returns {string} */
function attributeName(attribute) {
  return attribute.name.toLowerCase();
}

/** @param {MobiAttribute} attribute @returns {string|null} */
function attributeNamespace(attribute) {
  return attribute.namespace ?? null;
}

/** @param {string} value @returns {boolean} */
function isSafeFragment(value) {
  return value.length <= 1024 && FRAGMENT.exec(value)?.[0] === value;
}

/** @param {string} value @returns {boolean} */
function isUnsafeInputUrl(value) {
  const normalized = value.trim().toLowerCase();
  return value.length > 4096
    || /[\u0000-\u0020\u007f\\]/u.test(value)
    || normalized.startsWith('//')
    || /^[a-z][a-z0-9+.-]*:/u.test(normalized);
}

/** @param {unknown} value @returns {value is string} */
function isSafeResolvedUrl(value) {
  return typeof value === 'string' && value.length <= 4096 && (RESOURCE_TOKEN.exec(value)?.[0] === value || isSafeFragment(value));
}

/** @param {string} token @param {MobiResourceRole} role @param {MobiResourceValidator} validate @returns {Promise<boolean>} */
async function validateResolvedToken(token, role, validate) {
  const accepted = await validate(token, role);
  if (typeof accepted !== 'boolean') throw new Error('MOBI资源角色校验器返回类型无效');
  return accepted;
}

/** @param {MobiDiagnostic[]} diagnostics @param {MobiDiagnostic} diagnostic */
function addDiagnostic(diagnostics, diagnostic) {
  if (diagnostics.length >= MOBI_DOCUMENT_SANITIZER_LIMITS.diagnostics) {
    throw new Error('MOBI章节净化诊断超限');
  }
  diagnostics.push(diagnostic);
}

/** @param {{nodes: number, characters: number}} budget @param {number} amount */
function countCharacters(budget, amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('MOBI章节字符计数无效');
  budget.characters += amount;
  if (budget.characters > MOBI_DOCUMENT_SANITIZER_LIMITS.characters) {
    throw new Error('MOBI章节字符预算超限');
  }
}

/** @param {{nodes: number, characters: number}} budget */
function countNode(budget) {
  budget.nodes += 1;
  if (budget.nodes > MOBI_DOCUMENT_SANITIZER_LIMITS.nodes) {
    throw new Error('MOBI章节节点预算超限');
  }
}

/** @param {import('parse5').DefaultTreeAdapterTypes.ChildNode} node */
function detach(node) {
  defaultTreeAdapter.detachNode(node);
}

/** @param {MobiElement} element @param {string} css */
function appendStyleDeclaration(element, css) {
  const existing = element.attrs.find((attribute) => attribute.namespace == null && attribute.name === 'style');
  if (existing) {
    // WHY：SVG presentation 属性是低优先级提示，不能覆盖原有内联style。
    existing.value = existing.value ? `${css};${existing.value}` : css;
    return;
  }
  element.attrs.push({ name: 'style', value: css });
}

/** @param {MobiElement} element @returns {string|null} */
function parentTag(element) {
  const parent = element.parentNode;
  return isRecord(parent) && typeof parent.tagName === 'string' ? parent.tagName.toLowerCase() : null;
}

/** @param {MobiElement} element @param {string} name @returns {MobiResourceRole|null} */
function resourceRole(element, name) {
  const tag = tagName(element);
  const namespace = element.namespaceURI ?? HTML;
  if (name === 'href' && tag === 'a') return 'navigation';
  if (name === 'href' && tag === 'link') {
    const rel = element.attrs.find((attribute) => attribute.name === 'rel')?.value ?? '';
    return rel.split(/\s+/u).some((part) => part.toLowerCase() === 'stylesheet') ? 'style' : null;
  }
  if (name === 'src' && tag === 'img') return 'image';
  if (name === 'poster' && tag === 'video') return 'image';
  if (name === 'src' && (tag === 'audio' || tag === 'video')) return 'media';
  if (name === 'src' && tag === 'source') return parentTag(element) === 'picture' ? 'image' : 'media';
  if (name === 'href' && namespace === SVG && ['image', 'use', 'textpath'].includes(tag)) return 'image';
  if (name === 'href' && namespace === SVG && tag === 'a') return 'navigation';
  // WHY：未列入协议的 href/src/poster 不交给 resolver，防止新标签或错误命名空间意外获得网络能力。
  return null;
}

/** @param {MobiElement} element @param {string} name @param {string} value @param {MobiResourceResolver} resolve @param {MobiResourceValidator} validate @param {MobiDiagnostic[]} diagnostics @returns {Promise<string|null>} */
async function resolveUrl(element, name, value, resolve, validate, diagnostics) {
  const role = resourceRole(element, name);
  if (!role) return null;
  if (role === 'navigation' && isSafeFragment(value)) return value;
  const mobiNavigation = role === 'navigation' && /^(?:filepos:[0-9]+|kindle:pos:fid:[0-9a-v]+:off:[0-9a-v]+)$/iu.exec(value)?.[0] === value;
  if (!mobiNavigation && isUnsafeInputUrl(value)) {
    addDiagnostic(diagnostics, { kind: 'resource', action: 'removed', name, reason: 'unsafe-input-url' });
    return null;
  }
  const resolved = await resolve(value, role);
  if (resolved !== null && typeof resolved !== 'string') {
    throw new Error(`MOBI资源resolver返回类型无效：${name}`);
  }
  if (resolved === null || !isSafeResolvedUrl(resolved) || (resolved.startsWith('mobi-resource-v1/') && !(await validateResolvedToken(resolved, role, validate)))) {
    addDiagnostic(diagnostics, { kind: 'resource', action: 'removed', name, reason: 'unverified-resolver-result' });
    return null;
  }
  return resolved;
}

/** @param {string} source @param {MobiResourceResolver} resolve @param {MobiResourceValidator} validate @param {boolean} inline @returns {Promise<string>} */
async function sanitizeCssValue(source, resolve, validate, inline) {
  return sanitizeMobiCss(source, async (value, role) => {
    if (isUnsafeInputUrl(value)) return null;
    const resolved = await resolve(value, role);
    if (resolved !== null && typeof resolved !== 'string') {
      throw new Error('MOBI CSS resolver返回类型无效');
    }
    return resolved !== null && isSafeResolvedUrl(resolved) && (!resolved.startsWith('mobi-resource-v1/') || await validateResolvedToken(resolved, role, validate)) ? resolved : null;
  }, inline);
}

/** @param {MobiAttribute} attribute @returns {boolean} */
function isNamespaceDeclaration(attribute) {
  return attributeNamespace(attribute) === XMLNS;
}

/** @param {MobiAttribute} attribute @returns {boolean} */
function isAllowedNamespaceDeclaration(attribute) {
  return isNamespaceDeclaration(attribute) && SAFE_NAMESPACES.has(attribute.value);
}

/** @param {MobiElement} element @param {MobiAttribute} attribute @param {MobiResourceResolver} resolve @param {MobiResourceValidator} validate @param {MobiDiagnostic[]} diagnostics @returns {Promise<{keep: boolean, attribute?: MobiAttribute, presentation?: string}>} */
async function sanitizeAttribute(element, attribute, resolve, validate, diagnostics) {
  const name = attributeName(attribute);
  const namespace = attributeNamespace(attribute);
  if (name.startsWith('on')) return { keep: false };
  if (namespace !== null && !SAFE_NAMESPACES.has(namespace)) return { keep: false };
  if (namespace === XMLNS) return { keep: isAllowedNamespaceDeclaration(attribute), attribute };
  if (name === 'style' && namespace === null) {
    const value = await sanitizeCssValue(attribute.value, resolve, validate, true);
    return value ? { keep: true, attribute: { ...attribute, name: 'style', value } } : { keep: false };
  }
  if (RESOURCE_ATTRIBUTES.has(name) && (namespace === null || namespace === XLINK)) {
    const value = await resolveUrl(element, name, attribute.value, resolve, validate, diagnostics);
    return value ? { keep: true, attribute: { ...attribute, value } } : { keep: false };
  }
  if (namespace === null && isUrlPresentationAttribute(name)) {
    const value = await sanitizeCssValue(`${name}:${attribute.value}`, resolve, validate, true);
    return value ? { keep: false, presentation: value } : { keep: false };
  }
  // WHY：隐藏语义和可访问性属性需保留，否则净化会把索引排除的隐藏正文显示出来。
  if (namespace === null && (isAllowedDocumentAttribute(name) || ['hidden','inert'].includes(name) || /^aria-[a-z-]+$/u.test(name))) return { keep: true, attribute };
  if (namespace === XML && ['lang', 'space'].includes(name)) return { keep: true, attribute };
  if (namespace === EPUB && name === 'type') return { keep: true, attribute };
  return { keep: false };
}

/** @param {MobiElement} element @param {MobiResourceResolver} resolve @param {MobiResourceValidator} validate @param {MobiDiagnostic[]} diagnostics @param {{nodes: number, characters: number}} budget @returns {Promise<void>} */
async function sanitizeAttributes(element, resolve, validate, diagnostics, budget) {
  /** @type {MobiAttribute[]} */
  const kept = [];
  /** @type {string[]} */
  const presentations = [];
  for (const attribute of [...element.attrs]) {
    const name = attributeName(attribute);
    const result = await sanitizeAttribute(element, attribute, resolve, validate, diagnostics);
    if (result.keep && result.attribute) {
      countCharacters(budget, result.attribute.name.length + result.attribute.value.length);
      kept.push(result.attribute);
    }
    if (result.presentation) presentations.push(result.presentation);
    if (!result.keep && !result.presentation) {
      addDiagnostic(diagnostics, { kind: 'attribute', action: 'removed', name, reason: name.startsWith('on') ? 'event-handler' : 'not-allowed' });
    } else if (result.presentation) {
      addDiagnostic(diagnostics, { kind: 'attribute', action: 'rewritten', name, reason: 'presentation-to-style' });
    }
  }
  element.attrs = kept;
  if (presentations.length) {
    const css = presentations.join(';');
    countCharacters(budget, css.length);
    appendStyleDeclaration(element, css);
  }
}

/** @param {MobiElement} element @param {MobiResourceResolver} resolve @param {MobiResourceValidator} validate @param {MobiDiagnostic[]} diagnostics @param {{nodes: number, characters: number}} budget @returns {Promise<void>} */
async function sanitizeStyleElement(element, resolve, validate, diagnostics, budget) {
  const source = element.childNodes.map((child) => defaultTreeAdapter.isTextNode(child) ? child.value : '').join('');
  const value = await sanitizeCssValue(source, resolve, validate, false);
  countCharacters(budget, value.length);
  element.childNodes = [];
  if (value) defaultTreeAdapter.appendChild(element, defaultTreeAdapter.createTextNode(value));
  else addDiagnostic(diagnostics, { kind: 'css', action: 'removed', name: 'style', reason: 'empty-after-sanitize' });
}

/** @param {MobiContainer} root @param {MobiResourceResolver} resolve @param {MobiResourceValidator} validate @returns {Promise<MobiDiagnostic[]>} */
async function sanitizeTree(root, resolve, validate) {
  const diagnostics = /** @type {MobiDiagnostic[]} */ ([]);
  const budget = { nodes: 0, characters: 0 };
  /** @type {import('parse5').DefaultTreeAdapterTypes.ChildNode[]} */
  const stack = [...root.childNodes].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    countNode(budget);
    if (defaultTreeAdapter.isTextNode(node)) {
      countCharacters(budget, node.value.length);
      continue;
    }
    if (!isElement(node)) {
      detach(node);
      addDiagnostic(diagnostics, { kind: 'comment', action: 'removed', name: node.nodeName, reason: 'non-element-node' });
      continue;
    }
    const tag = tagName(node);
    const namespace = node.namespaceURI ?? '';
    if (!SAFE_NAMESPACES.has(namespace) || !(isAllowedDocumentElement(namespace, tag) || (namespace === HTML && MOBI_LEGACY_ELEMENTS.has(tag)))) {
      countCharacters(budget, tag.length);
      for (const attribute of node.attrs) countCharacters(budget, attribute.name.length + attribute.value.length);
      detach(node);
      addDiagnostic(diagnostics, { kind: 'element', action: 'removed', name: tag, reason: DANGEROUS_ELEMENTS.has(tag) ? 'dangerous-element' : 'not-allowed' });
      continue;
    }
    countCharacters(budget, tag.length);
    for (const attribute of node.attrs) countCharacters(budget, attribute.name.length + attribute.value.length);
    await sanitizeAttributes(node, resolve, validate, diagnostics, budget);
    if (tag === 'style') await sanitizeStyleElement(node, resolve, validate, diagnostics, budget);
    for (let index = node.childNodes.length - 1; index >= 0; index -= 1) stack.push(node.childNodes[index]);
  }
  return diagnostics;
}

/** @param {MobiContainer} root @returns {MobiElement|null} */
function findHead(root) {
  const stack = [...root.childNodes].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (isElement(node) && (node.namespaceURI ?? '') === HTML && tagName(node) === 'head') return node;
    if (isElement(node)) for (let index = node.childNodes.length - 1; index >= 0; index -= 1) stack.push(node.childNodes[index]);
  }
  return null;
}

/**
 * 净化一个 MOBI 章节 HTML/XHTML 片段。
 * mode显式指定body/head片段或document；head是内部内容，不包含head外壳。
 * points只重投影调用方已绑定的DOM点，不替代原始字节证明；资源字节与MIME由组合根校验。
 * @param {string} source
 * @param {MobiDocumentSanitizerOptions} options
 * @returns {Promise<SanitizedMobiDocument>}
 */
export async function sanitizeMobiDocument(source, options) {
  if (typeof source !== 'string' || source.length > MOBI_DOCUMENT_SANITIZER_LIMITS.inputCharacters) {
    throw new Error('MOBI章节输入字符超限或类型无效');
  }
  if (!isRecord(options) || typeof options.resolve !== 'function' || typeof options.validate !== 'function') {
    throw new Error('MOBI章节净化需要显式resolver和资源角色校验器');
  }
  const mode = options.mode ?? 'body';
  const root = parseMobiSanitizerTree(source, mode);
  const captured = captureMobiPoints(root, options.points ?? []);
  const diagnostics = await sanitizeTree(root, options.resolve, options.validate);
  const html = serialize(root);
  const headNode = findHead(root);
  const head = headNode ? serialize(headNode) : '';
  if (html.length > MOBI_DOCUMENT_SANITIZER_LIMITS.outputCharacters || head.length > MOBI_DOCUMENT_SANITIZER_LIMITS.outputCharacters) {
    throw new Error('MOBI章节净化输出字符超限');
  }
  // WHY：序列化可合并被删除节点两侧的文本；再解析并比对真实树后才能发出新路径。
  const reparsed = parseMobiSanitizerTree(html, mode, true);
  const points = rebaseMobiPoints(root, reparsed, captured);
  return { html, head, diagnostics, points };
}

export const sanitizeMobiChapter = sanitizeMobiDocument;
