// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeCss } from '../../public/vendor/foliate/security-css.js';
import { sanitizeDocument, EPUB_CSP } from './epub-security-document';

const wrap = (body: string) => `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>书</title></head><body>${body}</body></html>`;
const policy = {
  css: sanitizeCss,
  async resource(value: string) { return value === 'images/p.png' ? 'blob:owned-image' : value === 'font.woff2' ? 'blob:owned-font' : value === '#shape' ? value : null; },
  navigation(value: string) { return value.startsWith('#') ? value : null; },
};
describe('EPUB inert document sanitation', () => {
  it('preserves text, package images, formulas, SVG and footnote anchors without changing their IDs', async () => {
    const result = await sanitizeDocument(wrap(`<p id="p1">Hello <em>world</em><a href="#note" xmlns:epub="http://www.idpf.org/2007/ops" epub:type="noteref">1</a></p>
      <img src="images/p.png" alt="图"/><aside id="note">脚注<a href="#p1">返回</a></aside>
      <math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>x</mi><mn>2</mn></mfrac></math>
      <svg xmlns="http://www.w3.org/2000/svg"><defs><path id="shape" d="M0 0L1 1"/></defs><use href="#shape"/></svg>`), policy);
    const doc = new DOMParser().parseFromString(result, 'application/xhtml+xml');
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('blob:owned-image');
    expect(doc.querySelector('mfrac mi')?.textContent).toBe('x');
    expect(doc.querySelector('#note')?.textContent).toContain('脚注');
    expect(doc.querySelector('a')?.getAttribute('href')).toBe('#note');
    expect(doc.querySelector('use')?.getAttribute('href')).toBe('#shape');
    expect(doc.querySelector('head')?.firstElementChild?.getAttribute('content')).toBe(EPUB_CSP);
  });
  it('removes executable elements, every authored meta, forms, event handlers and all network sinks before serialization', async () => {
    const attack = `<?xml-stylesheet href="/api/delete"?><script src="/api/delete">parent.pwned=1</script>
      <base href="https://evil.test/"/><meta http-equiv="refresh" content="0;url=/api/delete"/>
      <iframe src="/api/delete"/><object data="/api/delete"/><embed src="/api/delete"/>
      <form action="/api/delete"><input name="delete"/></form>
      <img src="/api/delete" srcset="https://evil.test/a 2x" onerror="parent.pwned=1"/>
      <a href="javascript:alert(1)" ping="/api/delete" target="_top">bad</a>
      <a href="data:text/html,evil">data</a><a href="blob:attacker">blob</a>
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><script>evil()</script>
        <image xlink:href="//evil.test/a" onload="evil()"/><animate attributeName="href" to="/api/delete"/>
        <foreignObject><iframe xmlns="http://www.w3.org/1999/xhtml" src="/api/delete"/></foreignObject></svg>`;
    const result = await sanitizeDocument(wrap(attack), policy);
    const doc = new DOMParser().parseFromString(result, 'application/xhtml+xml');
    expect(doc.querySelectorAll('script,iframe,object,embed,base,form,animate,foreignObject')).toHaveLength(0);
    expect(doc.querySelectorAll('[srcset],[onerror],[onload],[ping],[target],[href]')).toHaveLength(0);
    expect(doc.querySelectorAll('meta')).toHaveLength(1);
    expect(result).not.toMatch(/evil\.test|\/api\/delete|xml-stylesheet/);
  });
  it('sanitizes CSS and SVG presentation URLs before creating renderable documents', async () => {
    const result = await sanitizeDocument(wrap(`<style>@import '/api/a'; p{color:red;background:url(/api/b)} @font-face{font-family:Book;src:url(font.woff2)}</style>
      <p style="background-image:image-set('/api/c' 1x);font-weight:bold">safe</p>
      <svg xmlns="http://www.w3.org/2000/svg"><path fill="url(https://evil.test/p)"/></svg>`), policy);
    expect(result).not.toMatch(/\/api\/|evil\.test|image-set|@import/);
    expect(result).toContain('blob:owned-font');
    expect(result).toContain('font-weight:bold');
    expect(result).toContain('color:red');
  });
  it('rejects entity expansion and malformed XML instead of falling back to active HTML parsing', async () => {
    await expect(sanitizeDocument('<!DOCTYPE html [<!ENTITY x "abc">]>' + wrap('&x;'), policy)).rejects.toThrow('DTD');
    await expect(sanitizeDocument(wrap('<img>'), policy)).rejects.toThrow('XML');
  });
});
