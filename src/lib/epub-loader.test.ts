// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { Blob as NodeBlob } from 'node:buffer';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { loadEpub, createFoliateView } from './epub-loader';
import type { FoliateBridge } from './foliate-types';

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

