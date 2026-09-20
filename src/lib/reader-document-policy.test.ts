import {describe, expect, it} from 'vitest';
import {
  DOCUMENT_NAMESPACES,
  isAllowedDocumentAttribute,
  isAllowedDocumentElement,
  isUrlPresentationAttribute,
} from './reader-document-policy.mjs';

describe('reader document policy', () => {
  it('exposes the seven fixed namespaces without allowing callers to replace them', () => {
    expect(DOCUMENT_NAMESPACES).toEqual({
      HTML: 'http://www.w3.org/1999/xhtml',
      SVG: 'http://www.w3.org/2000/svg',
      MATH: 'http://www.w3.org/1998/Math/MathML',
      XML: 'http://www.w3.org/XML/1998/namespace',
      XLINK: 'http://www.w3.org/1999/xlink',
      EPUB: 'http://www.idpf.org/2007/ops',
      XMLNS: 'http://www.w3.org/2000/xmlns/',
    });
    expect(Object.isFrozen(DOCUMENT_NAMESPACES)).toBe(true);
    expect(Reflect.set(DOCUMENT_NAMESPACES, 'HTML', 'https://evil.test/')).toBe(false);
    expect(DOCUMENT_NAMESPACES.HTML).toBe('http://www.w3.org/1999/xhtml');
  });

  it.each([
    [DOCUMENT_NAMESPACES.HTML, 'html'],
    [DOCUMENT_NAMESPACES.HTML, 'article'],
    [DOCUMENT_NAMESPACES.SVG, 'path'],
    [DOCUMENT_NAMESPACES.MATH, 'mfrac'],
  ])('allows a known lower-case element: %s:%s', (namespace, tag) => {
    expect(isAllowedDocumentElement(namespace, tag)).toBe(true);
  });

  it.each([
    ['', 'script'],
    [DOCUMENT_NAMESPACES.HTML, 'script'],
    [DOCUMENT_NAMESPACES.HTML, 'P'],
    [DOCUMENT_NAMESPACES.SVG, 'foreignObject'],
    [DOCUMENT_NAMESPACES.MATH, 'annotation-xml'],
  ])('rejects an unknown, wrong-case, or wrong-namespace element: %s:%s', (namespace, tag) => {
    expect(isAllowedDocumentElement(namespace, tag)).toBe(false);
  });

  it.each(['id', 'class', 'title', 'viewbox', 'mathvariant', 'encoding'])
    ('allows a static document attribute: %s', (attribute) => {
      expect(isAllowedDocumentAttribute(attribute)).toBe(true);
    });

  it.each(['onclick', 'onload', 'aria-label', 'href', 'STYLE', 'data-source'])
    ('leaves contextual or executable attributes to the caller: %s', (attribute) => {
      expect(isAllowedDocumentAttribute(attribute)).toBe(false);
    });

  it.each([
    'fill',
    'stroke',
    'filter',
    'clip-path',
    'mask',
    'marker-start',
    'marker-mid',
    'marker-end',
  ])('recognizes a URL-bearing presentation attribute: %s', (attribute) => {
    expect(isUrlPresentationAttribute(attribute)).toBe(true);
  });

  it.each(['style', 'background', 'href', 'src', 'color'])
    ('does not classify a non-presentation attribute as URL-bearing: %s', (attribute) => {
      expect(isUrlPresentationAttribute(attribute)).toBe(false);
    });
});