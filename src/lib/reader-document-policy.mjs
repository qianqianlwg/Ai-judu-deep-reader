// @ts-check
// WHY：EPUB与候选转换净化共享同一静态清单；本模块不承担URL、aria、事件属性或命名空间上下文决策。
// 命名空间常量冻结，Set/Map保持模块私有；调用方只能查询，不能扩大允许范围。
export const DOCUMENT_NAMESPACES = Object.freeze({
  HTML: 'http://www.w3.org/1999/xhtml',
  SVG: 'http://www.w3.org/2000/svg',
  MATH: 'http://www.w3.org/1998/Math/MathML',
  XML: 'http://www.w3.org/XML/1998/namespace',
  XLINK: 'http://www.w3.org/1999/xlink',
  EPUB: 'http://www.idpf.org/2007/ops',
  XMLNS: 'http://www.w3.org/2000/xmlns/',
});
const { HTML, SVG, MATH } = DOCUMENT_NAMESPACES;
/** @type {Map<string, Set<string>>} */
const tags = new Map([
  [HTML, new Set(('html head title body style link a abbr address article aside b bdi bdo blockquote br caption cite code col colgroup dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup hr i img ins kbd li main mark nav ol p picture pre q rp rt ruby s samp section small source span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr audio video').split(' '))],
  [SVG, new Set(('svg g defs desc title symbol use image path rect circle ellipse line polyline polygon text tspan textPath marker pattern clipPath mask linearGradient radialGradient stop filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence style a').split(' ').map(x => x.toLowerCase()))],
  [MATH, new Set(('math semantics annotation mrow mi mn mo ms mtext mspace msqrt mroot mfrac msub msup msubsup munder mover munderover mmultiscripts mprescripts none mfenced menclose mstyle merror mpadded mphantom mtable mlabeledtr mtr mtd maligngroup malignmark').split(' '))],
]);
const attributes = new Set(('id class title lang dir role width height alt name type media rel colspan rowspan scope headers span start reversed value datetime cite open controls preload kind srclang label ' +
  'viewbox preserveaspectratio x y x1 x2 y1 y2 dx dy cx cy r rx ry d points transform opacity fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset ' +
  'clip-path clip-rule mask filter marker-start marker-mid marker-end color offset stop-color stop-opacity gradientunits gradienttransform spreadmethod patternunits patterncontentunits patterntransform ' +
  'text-anchor dominant-baseline font-family font-size font-style font-weight textlength lengthadjust rotate startoffset method spacing ' +
  'in in2 result stddeviation operator k1 k2 k3 k4 mode values tablevalues slope intercept amplitude exponent scale xchannelselector ychannelselector edgemode kernelmatrix order targetx targety divisor bias preservealpha ' +
  'display mathvariant mathsize mathcolor mathbackground scriptlevel displaystyle scriptsizemultiplier scriptminsize linethickness numalign denomalign bevelled notation fence separator stretchy symmetric maxsize minsize largeop movablelimits accent accentunder lspace rspace columnalign rowalign columnspacing rowspacing columnlines rowlines frame equalrows equalcolumns encoding').split(' '));
const urlPresentation = new Set(['fill', 'stroke', 'filter', 'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end']);

/**
 * WHY：按既有清单精确查询，不擅自lowercase或补默认命名空间；SVG清单仍沿用原来的小写映射。
 * @param {string} namespace @param {string} lowercaseTag @returns {boolean}
 */
export function isAllowedDocumentElement(namespace, lowercaseTag) {
  return tags.get(namespace)?.has(lowercaseTag) ?? false;
}
/** @param {string} lowercaseName @returns {boolean} */
export function isAllowedDocumentAttribute(lowercaseName) {
  return attributes.has(lowercaseName);
}
/** @param {string} lowercaseName @returns {boolean} */
export function isUrlPresentationAttribute(lowercaseName) {
  return urlPresentation.has(lowercaseName);
}
