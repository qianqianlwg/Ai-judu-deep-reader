// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { describe, it, expect, vi } from 'vitest';
import { prepareEpubResources } from './epub-security-resources';
import { sanitizeCss } from '../../public/vendor/foliate/security-css.js';
import type { EpubArchive } from './foliate-types';

function archive(opf: string, extras: Record<string, string> = {}): EpubArchive {
  const sources = { mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'EPUB/book.opf': opf,
    'EPUB/ch.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><p>safe</p></body></html>', ...extras };
  return { entries: Object.entries(sources).map(([filename, source]) => {
    const bytes = new TextEncoder().encode(source);
    return { filename, directory: false, encrypted: false, compressedSize: bytes.length, uncompressedSize: bytes.length, read: async () => bytes };
  }), close: async () => {} };
}
const packageXml = (href = 'ch.xhtml', type = 'application/xhtml+xml') => `<package xmlns="http://www.idpf.org/2007/opf"><metadata/><manifest><item id="ch" href="${href}" media-type="${type}"/></manifest><spine><itemref idref="ch"/></spine></package>`;
describe('EPUB package gate and sanitized resources', () => {
  it.each(['/api/private', 'https://evil.test/x', '../missing.xhtml', 'blob:bad', 'data:text/html,x'])('rejects non-package manifest references %s', async href => {
    await expect(prepareEpubResources(archive(packageXml(href)), sanitizeCss)).rejects.toThrow('manifest');
  });
  it('validates mimetype, container, duplicate manifest IDs and unsupported spine content', async () => {
    await expect(prepareEpubResources(archive(packageXml(), { mimetype: 'application/zip' }), sanitizeCss)).rejects.toThrow('mimetype');
    await expect(prepareEpubResources(archive(packageXml(), { 'META-INF/container.xml': '<container/>' }), sanitizeCss)).rejects.toThrow('container');
    await expect(prepareEpubResources(archive(packageXml().replace('</manifest>', '<item id="ch" href="ch.xhtml" media-type="application/xhtml+xml"/></manifest>')), sanitizeCss)).rejects.toThrow('manifest');
    await expect(prepareEpubResources(archive(packageXml('ch.xhtml', 'application/javascript')), sanitizeCss)).rejects.toThrow('spine');
  });
  it('rejects encryption instead of serving unsafe/garbled data', async () => {
    await expect(prepareEpubResources(archive(packageXml(), { 'META-INF/encryption.xml': '<encryption/>' }), sanitizeCss)).rejects.toThrow('混淆');
  });
  it('wraps an SVG spine in CSP-protected XHTML and denies unmanifested blobs/text', async () => {
    vi.stubGlobal('Blob', NodeBlob);
    const safe = await prepareEpubResources(archive(packageXml('figure.svg', 'image/svg+xml'), {
      'EPUB/figure.svg': '<svg xmlns="http://www.w3.org/2000/svg"><text>x</text><script>evil()</script></svg>',
    }), sanitizeCss);
    expect(await safe.loadText('EPUB/figure.svg')).toContain('Content-Security-Policy');
    expect(await safe.loadText('EPUB/figure.svg')).not.toContain('<script');
    expect(await safe.loadText('EPUB/book.opf')).toContain('application/xhtml+xml');
    expect(await safe.loadText('/api/private')).toBeNull();
    expect(await safe.loadBlob('unknown')).toBeNull();
    safe.destroy(); vi.unstubAllGlobals();
  });
});


describe('lazy EPUB decompression still enforces security',()=>{
  const withImage=()=>archive(packageXml().replace('</manifest>','<item id="image" href="figure.jpg" media-type="image/jpeg"/></manifest>'),{'EPUB/figure.jpg':'image bytes'});
  it('does not read unused images until background prefetch; concurrent requests share one read',async()=>{
    const source=withImage(),image=source.entries.find(entry=>entry.filename==='EPUB/figure.jpg')!;
    const read=vi.spyOn(image,'read');const safe=await prepareEpubResources(source,sanitizeCss,{lazy:true});
    expect(read).not.toHaveBeenCalled();expect(await safe.loadText('EPUB/ch.xhtml')).toContain('Content-Security-Policy');expect(read).not.toHaveBeenCalled();
    await Promise.all([safe.prefetch(),safe.loadBlob('EPUB/figure.jpg'),safe.loadBlob('EPUB/figure.jpg')]);
    expect(read).toHaveBeenCalledOnce();safe.destroy();await safe.drained();
  });
  it('rejects actual size mismatches in deferred resources and on-demand reads',async()=>{
    const source=withImage(),image=source.entries.find(entry=>entry.filename==='EPUB/figure.jpg')!;
    image.read=async()=>new Uint8Array([1]);const safe=await prepareEpubResources(source,sanitizeCss,{lazy:true});
    await expect(safe.prefetch()).rejects.toThrow('实际大小');await expect(safe.loadBlob('EPUB/figure.jpg')).rejects.toThrow('实际大小');safe.destroy();await safe.drained();
  });
  it('keeps manifest validation eager and never exposes raw delayed chapters',async()=>{
    await expect(prepareEpubResources(archive(packageXml('https://evil.test/x')),sanitizeCss,{lazy:true})).rejects.toThrow('manifest');
    const source=archive(packageXml(),{'EPUB/ch.xhtml':'<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><script>evil()</script><p onclick="evil()">safe</p></body></html>'});
    const safe=await prepareEpubResources(source,sanitizeCss,{lazy:true});const output=await safe.loadText('EPUB/ch.xhtml');
    expect(output).toContain('Content-Security-Policy');expect(output).not.toMatch(/<script|onclick|evil/);safe.destroy();
  });
});
