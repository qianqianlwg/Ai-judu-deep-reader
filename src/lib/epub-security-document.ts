import type { FoliateBridge } from './foliate-types';
import { EPUB_LIMITS } from './epub-security-zip';

export const EPUB_CSP = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src blob: data:; media-src blob: data:; font-src blob: data:; style-src 'unsafe-inline' blob:; frame-src 'none'; child-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
const HTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';
const MATH = 'http://www.w3.org/1998/Math/MathML';
const XML = 'http://www.w3.org/XML/1998/namespace';
const XLINK = 'http://www.w3.org/1999/xlink';
const EPUB = 'http://www.idpf.org/2007/ops';
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
export type ResourceKind = 'image' | 'style' | 'media' | 'css';
export interface DocumentPolicy {
  resource(value: string, kind: ResourceKind): Promise<string | null>;
  navigation(value: string): string | null;
  css: FoliateBridge['sanitizeCss'];
}

export function parseEpubXml(source: string): Document {
  if (source.length > EPUB_LIMITS.text) throw new Error('EPUB XML 文本超过 2 MiB 限制');
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(source)) throw new Error('EPUB 不允许 DTD 实体');
  // WHY：XML 解析是惰性的；不使用可能预取图片/iframe 的 text/html 解析器。
  const doc = new DOMParser().parseFromString(source.replace(/<!DOCTYPE[^>]*>/gi, ''), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || !doc.documentElement)
    throw new Error('EPUB XML 无效或编码不受支持');
  return doc;
}

export async function sanitizeDocument(source: string, policy: DocumentPolicy): Promise<string> {
  const doc = parseEpubXml(source);
  if (!((doc.documentElement.namespaceURI === HTML && doc.documentElement.localName === 'html')
      || (doc.documentElement.namespaceURI === SVG && doc.documentElement.localName === 'svg')))
    throw new Error('EPUB 章节必须是命名空间正确的 XHTML 或 SVG');
  // Processing instructions can load XML stylesheets. Remove them at every depth.
  const walker = doc.createTreeWalker(doc, 64 | 128); // PI + comments
  const remove: Node[] = [];
  while (walker.nextNode()) remove.push(walker.currentNode);
  remove.forEach(node => node.parentNode?.removeChild(node));
  for (const element of Array.from(doc.getElementsByTagName('*'))) {
    if (!doc.documentElement.contains(element)) continue;
    const tag = element.localName.toLowerCase(), ns = element.namespaceURI ?? '';
    if (!tags.get(ns)?.has(tag)) { element.remove(); continue; }
    for (const attr of Array.from(element.attributes)) {
      const name = attr.localName.toLowerCase();
      if (name === 'style' && !attr.namespaceURI) {
        element.setAttribute('style', await policy.css(attr.value, value => policy.resource(value, 'css'), true));
      } else if (['href', 'src', 'poster'].includes(name) && (!attr.namespaceURI || attr.namespaceURI === XLINK)) {
        let value: string | null = null;
        if (name === 'href' && tag === 'a') value = policy.navigation(attr.value);
        else if (name === 'href' && ns === HTML && tag === 'link' && element.getAttribute('rel')?.toLowerCase() === 'stylesheet')
          value = await policy.resource(attr.value, 'style');
        else if ((name === 'src' && tag === 'img') || (name === 'poster' && tag === 'video')
            || (name === 'href' && ns === SVG && ['image', 'use', 'textpath'].includes(tag)))
          value = await policy.resource(attr.value, 'image');
        else if (name === 'src' && ['audio', 'video', 'source'].includes(tag)) value = await policy.resource(attr.value, 'media');
        if (value) element.setAttributeNS(attr.namespaceURI, attr.name, value);
        else element.removeAttributeNode(attr);
      } else if (urlPresentation.has(name) && !attr.namespaceURI) {
        const css = await policy.css(`${name}:${attr.value}`, value => policy.resource(value, 'image'), true);
        element.removeAttributeNode(attr);
        if (css) element.setAttribute('style', `${element.getAttribute('style') ?? ''};${css}`);
      } else if ((attr.namespaceURI === XML && ['lang', 'space'].includes(name))
          || (attr.namespaceURI === EPUB && name === 'type') || attr.namespaceURI === 'http://www.w3.org/2000/xmlns/') {
        // Namespace declarations and semantic EPUB/MathML markup are not network capabilities.
      } else if (attr.namespaceURI || (!attributes.has(name) && !name.startsWith('aria-')) || name.startsWith('on')) {
        element.removeAttributeNode(attr);
      }
    }
    if (tag === 'style') element.textContent = await policy.css(element.textContent ?? '', value => policy.resource(value, 'css'));
    if (tag === 'link' && !element.hasAttribute('href')) element.remove();
    if (ns === MATH && tag === 'annotation') element.textContent = element.textContent; // no embedded foreign markup
  }
  if (doc.documentElement.namespaceURI === HTML) {
    let head = Array.from(doc.documentElement.children).find(el => el.localName === 'head');
    if (!head) { head = doc.createElementNS(HTML, 'head'); doc.documentElement.prepend(head); }
    else doc.documentElement.prepend(head);
    const meta = doc.createElementNS(HTML, 'meta');
    meta.setAttribute('http-equiv', 'Content-Security-Policy');
    meta.setAttribute('content', EPUB_CSP);
    head.prepend(meta);
  }
  return new XMLSerializer().serializeToString(doc);
}
