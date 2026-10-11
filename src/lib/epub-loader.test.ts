// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { Blob as NodeBlob } from 'node:buffer';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { loadEpub, createFoliateView } from './epub-loader';
import type { FoliateBridge } from './foliate-types';
import JSZip from 'jszip';
import { makeEpub } from '../app/api/import/fixtures';

let bridge: FoliateBridge;
const blobs = new Map<string, Blob>();
beforeAll(async () => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  URL.createObjectURL = vi.fn((blob: Blob) => { const url = `blob:owned-${blobs.size}`; blobs.set(url, blob); return url; });
  URL.revokeObjectURL = vi.fn();
  const path = '../../public/vendor/foliate/bridge.js';
  bridge = await import(path) as FoliateBridge;
});
afterAll(() => vi.unstubAllGlobals());
async function fixture() { return new Blob([await readFile('public/vendor/foliate/fixtures/security.epub')]); }

describe('browser EPUB loader with the actual pinned EPUB/ZIP modules', () => {
  it('loads the fixture through the secure bridge and preserves canonical section IDs, TOC, CFI, formulas and notes', async () => {
    const book = await loadEpub(await fixture());
    expect(book.sections).toHaveLength(1);
    expect(book.sections[0].id).toBe('EPUB/text/chapter.xhtml');
    expect(book.toc?.[0].href).toBe('EPUB/text/chapter.xhtml#p1');
    const doc = await book.sections[0].createDocument();
    expect(doc.querySelector('math mi')?.textContent).toBe('x');
    expect(doc.querySelector('aside')?.id).toBe('note');
    expect(doc.querySelector('a')?.getAttribute('href')).toBe('#note');
    expect(doc.querySelectorAll('script,[onerror]')).toHaveLength(0);
    expect(doc.querySelector('img')?.getAttribute('src')).toMatch(/^blob:owned-/);
    const view = await createFoliateView();
    expect(view.tagName).toBe('FOLIATE-VIEW');
    // The view's CFI APIs operate on the sanitized source DOM without layout or a server.
    Object.assign(view, { book });
    const range = doc.createRange(); range.selectNodeContents(doc.querySelector('#p1')!.firstChild!);
    const cfi = view.getCFI(0, range), resolved = view.resolveCFI(cfi);
    expect(resolved.index).toBe(0);
    const anchor = resolved.anchor(doc);
    expect(anchor).toBeInstanceOf(Range);
    expect((anchor as Range).toString()).toBe(range.toString());
    const url = await book.sections[0].load();
    expect(url).toMatch(/^blob:owned-/);
    const output = await blobs.get(url!)!.text();
    expect(output).toContain('Content-Security-Policy');
    expect(output).not.toMatch(/\/api\/|evil\(\)|onerror|<script/);
    for (const blob of blobs.values()) if (['text/css', 'image/svg+xml'].includes(blob.type))
      expect(await blob.text()).not.toMatch(/\/api\/|evil\.test|<script/);
    book.destroy?.(); book.destroy?.();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    await expect(book.sections[0].createDocument()).rejects.toThrow('已销毁');
  });
  it('loads a genuine 2-byte DEFLATE empty-directory EPUB through the actual ZIP and book bridge', async () => {
    const book = await loadEpub(new Blob([new Uint8Array(makeEpub(false, true, true))]));
    expect(book.sections).toHaveLength(1);
    expect((await book.sections[0].createDocument()).body.textContent).toContain('第二段');
    book.destroy?.();
  });
  it('loads XHTML 1.1 named character entities through the full reader without raw HTML fallback', async () => {
    const archive = await JSZip.loadAsync(makeEpub(false, false, true));
    const source = archive.file('OPS/Text/chapter-one.xhtml')!;
    archive.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    archive.file(source.name, '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">'
      + (await source.async('string')).replace('First&nbsp;paragraph', '&ldquo;First&rdquo;&nbsp;paragraph'));
    const book = await loadEpub(new Blob([new Uint8Array(await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))]));
    const doc = await book.sections[0].createDocument();
    expect(doc.body.textContent).toContain('“First”');
    expect(doc.querySelectorAll('parsererror')).toHaveLength(0);
    expect(doc.querySelector('head meta')?.getAttribute('content')).toContain("script-src 'none'");
    book.destroy?.();
  });
  it('does not expose an unsafe raw-book fallback', async () => {
    await expect(bridge.createBook(await fixture(), undefined as never)).rejects.toThrow('sanitized');
  });
  it('limits actual decompressed output independently of declared ZIP sizes', async () => {
    const archive = await bridge.openArchive(await fixture());
    await expect(archive.entries[0].read(1)).rejects.toThrow('limit');
    await archive.close();
  });
});

describe('browser-only shared initialization', () => {
  it('deduplicates the trusted module script and retries after a visible load failure', async () => {
    vi.resetModules();
    const actualWindow = window;
    const fakeWindow = { setTimeout: actualWindow.setTimeout.bind(actualWindow), clearTimeout: actualWindow.clearTimeout.bind(actualWindow), __juduFoliate: undefined as FoliateBridge | undefined };
    vi.stubGlobal('window', fakeWindow);
    try {
      const loader = await import('./epub-loader');
      const first = loader.createFoliateView(), second = loader.createFoliateView();
      const failures = Promise.all([expect(first).rejects.toThrow('加载失败'), expect(second).rejects.toThrow('加载失败')]);
      const scripts = document.querySelectorAll<HTMLScriptElement>('script[data-judu-foliate]');
      expect(scripts).toHaveLength(1);
      expect(scripts[0].type).toBe('module');
      expect(scripts[0].getAttribute('src')).toBe('/vendor/foliate/bridge.js');
      scripts[0].dispatchEvent(new Event('error'));
      await failures;
      expect(document.querySelectorAll('script[data-judu-foliate]')).toHaveLength(0);
      const retried = loader.createFoliateView();
      fakeWindow.__juduFoliate = bridge;
      const script = document.querySelector('script[data-judu-foliate]')!;
      script.dispatchEvent(new Event('load'));
      expect((await retried).tagName).toBe('FOLIATE-VIEW');
      script.remove();
    } finally { vi.stubGlobal('window', actualWindow); }
  });
  it('imports on the server without bootstrapping and rejects runtime calls clearly', async () => {
    vi.resetModules();
    const actualWindow = window;
    vi.stubGlobal('window', undefined);
    try {
      const loader = await import('./epub-loader');
      await expect(loader.createFoliateView()).rejects.toThrow('浏览器');
      await expect(loader.loadEpub(new Blob())).rejects.toThrow('浏览器');
    } finally { vi.stubGlobal('window', actualWindow); }
  });
});



async function progressiveFixture(brokenLast = false) {
  const zip=new JSZip();zip.file('mimetype','application/epub+zip',{compression:'STORE'});
  zip.file('META-INF/container.xml','<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const manifest=Array.from({length:20},(_,i)=>'<item id="s'+i+'" href="ch'+i+'.xhtml" media-type="application/xhtml+xml"/>').join('');
  const spine=Array.from({length:20},(_,i)=>'<itemref idref="s'+i+'"/>').join('');
  zip.file('OPS/book.opf','<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">test</dc:identifier><dc:title>test</dc:title><dc:language>zh</dc:language></metadata><manifest>'+manifest+'<item id="image" href="unused.jpg" media-type="image/jpeg"/></manifest><spine>'+spine+'</spine></package>');
  for(let i=0;i<20;i++)zip.file('OPS/ch'+i+'.xhtml',brokenLast&&i===19?'broken xml':'<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><p>Chapter '+i+'</p></body></html>');
  zip.file('OPS/unused.jpg','unused image');return new Blob([new Uint8Array(await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}))]);
}
async function trackedProgressiveLoader() {
  vi.resetModules();const actualWindow=window;const reads:string[]=[],close=vi.fn();
  const tracked={...bridge,openArchive:async(blob:Blob)=>{
    const source=await bridge.openArchive(blob);return {...source,entries:source.entries.map(entry=>({...entry,read:async(limit:number)=>{reads.push(entry.filename);return entry.read(limit);}})),close:async()=>{close();await source.close();}};
  }};
  vi.stubGlobal('window',{__juduFoliate:tracked});
  const loader=await import('./epub-loader');
  try { await loader.initializeFoliate(); } finally { vi.stubGlobal('window',actualWindow); }
  return {loader,reads,close};
}
describe('progressive EPUB uses the actual pinned ZIP and sanitizer',()=>{
  it('prepares ten nearby chapters without reading distant images and keeps ZIP alive until background completion',async()=>{
    const {loader,reads,close}=await trackedProgressiveLoader();const book=await loader.loadEpub(await progressiveFixture(),{progressive:true,initialHref:'OPS/ch16.xhtml'});
    expect(reads).toContain('OPS/ch16.xhtml');expect(reads).not.toContain('OPS/ch0.xhtml');expect(reads).not.toContain('OPS/unused.jpg');expect(close).not.toHaveBeenCalled();
    // WHY：后台尚未启动时的目录跳转也必须经过同一安全入口，不依赖预热命中。
    const output=await book.sections[0].createDocument();expect(output.querySelector('meta[http-equiv="Content-Security-Policy"]')).not.toBeNull();
    const first=book.preparation!.start();expect(book.preparation!.start()).toBe(first);await first;
    expect(reads).toContain('OPS/unused.jpg');expect(close).toHaveBeenCalledOnce();expect(new Set(reads).size).toBe(reads.length);
    expect((await book.sections[19].createDocument()).body.textContent).toContain('Chapter 19');book.destroy?.();
  });
  it('surfaces an invalid distant chapter during background preparation and releases the archive',async()=>{
    const {loader,close}=await trackedProgressiveLoader();const book=await loader.loadEpub(await progressiveFixture(true),{progressive:true});
    await expect(book.preparation!.start()).rejects.toThrow('XML');expect(close).toHaveBeenCalledOnce();
    await expect(book.sections[0].createDocument()).rejects.toThrow('已销毁');
  });
  it('closes an unstarted background archive on destroy and rejects subsequent startup',async()=>{
    const {loader,close}=await trackedProgressiveLoader();const book=await loader.loadEpub(await progressiveFixture(),{progressive:true});
    book.destroy?.();await vi.waitFor(()=>expect(close).toHaveBeenCalledOnce());await expect(book.preparation!.start()).rejects.toThrow();
  });
  it('aborting a loaded book cancels background work and releases the archive',async()=>{
    const {loader,close}=await trackedProgressiveLoader(),controller=new AbortController();
    const book=await loader.loadEpub(await progressiveFixture(),{progressive:true,signal:controller.signal});
    controller.abort();await vi.waitFor(()=>expect(close).toHaveBeenCalledOnce());await expect(book.sections[0].createDocument()).rejects.toThrow('已销毁');
  });
});
