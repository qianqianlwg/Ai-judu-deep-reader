import { createHash, webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as publication from './mobi-publication-server';
import * as storage from './data-storage';
import * as database from './db';
import { prepareMobiLayoutMarkup } from './mobi-layout-preparation.mjs';
import { createMobiFoliateBook } from './mobi-render';
import { readMobiPublication, type MobiPublication } from './mobi-publication-model';
import { loadMobiPublication } from './mobi-loader';
import { makeMobiFixture } from './mobi-fixture';
import type { MobiLayoutSnapshot } from './mobi-layout-snapshot';
import type { FoliateBook } from './foliate-types';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const token = (name: string) => `mobi-resource-v1/${name}`;
const raw = (): MobiLayoutSnapshot => ({
  schema: 'mobi-layout-untrusted-v3', kind: 'mobi', sourceHash: 'a'.repeat(64), title: 'audit', authors: [], cover: null,
  chapters: [{ id: '0', title: 'chapter', html: '<p>正文</p>', head: '', css: [], paragraphs: ['正文'] }],
  resources: [], toc: [], links: [],
});
const publish = async (snapshot: MobiLayoutSnapshot) => publication.publishMobiLayout(await prepareMobiLayoutMarkup(snapshot));
let dom: JSDOM;
let books: FoliateBook[];
let allocated: Map<string, Blob>;
let revoked: Set<string>;
beforeEach(() => {
  // WHY：只提供脱离页面的 DOMParser/XMLSerializer，不开启浏览器、HTTP 或外部资源加载。
  dom = new JSDOM(''); books = []; allocated = new Map(); revoked = new Set();
  vi.stubGlobal('DOMParser', dom.window.DOMParser); vi.stubGlobal('XMLSerializer', dom.window.XMLSerializer);
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('audit forbids network'); }));
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    if (!(blob instanceof Blob)) throw new Error('audit expected Blob, not MediaSource');
    const url = `blob:audit-${allocated.size}`; allocated.set(url, blob); return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => { revoked.add(url); });
});
afterEach(() => {
  for (const book of books) book.destroy?.();
  dom.window.close(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function render(model: MobiPublication) {
  const book = await createMobiFoliateBook(model); books.push(book); return book;
}

describe('MOBI publication 跨层独立攻击/回归 probe', () => {
  it('合法 CSS 字面双引号经过准备与发布两次净化仍应可读', async () => {
    const snapshot = raw(); snapshot.chapters[0].head = `<link rel="stylesheet" href="${token('book.css')}">`;
    snapshot.resources = [{ id: token('book.css'), mediaType: 'text/css', bytes: Buffer.from(`p::before{content:'He said "hello"'}`) }];
    const prepared = await prepareMobiLayoutMarkup(snapshot);
    expect(Buffer.from(prepared.snapshot.resources[0].bytes).toString()).toContain('\\"hello\\"');
    const model = await publication.publishMobiLayout(prepared);
    expect(model.resources.some(resource => resource.id === token('book.css'))).toBe(true);
  });

  it('head 中惰性同名字符串不能冒充实际 stylesheet link', async () => {
    const snapshot = raw(); snapshot.chapters[0].head = `<style>p::before{content:"${token('book.css')}"}</style>`;
    snapshot.chapters[0].css = [token('book.css')];
    snapshot.resources = [{ id: token('book.css'), mediaType: 'text/css', bytes: Buffer.from('p{color:red}') }];
    const model = await publish(snapshot);
    const book = await render(model); const doc = await book.sections[0].createDocument();
    expect(doc.querySelector('link[rel="stylesheet"]')).not.toBeNull();
    expect(model.resources.some(resource => resource.id === token('book.css'))).toBe(true);
  });

  it('真实图像边界：可达截断PNG拒绝，不能由发布层绕过', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
    const snapshot = raw(); snapshot.chapters[0].html += `<img src="${token('a.png')}">`;
    snapshot.resources = [{ id: token('a.png'), mediaType: 'image/png', bytes: png.subarray(0, -1) }];
    await expect(publish(snapshot)).rejects.toThrow(/MOBI.*截断/u);
    expect(allocated.size).toBe(0);
  });

  it('PNG伪装SVG与外部引用不能进入二进制发布', async () => {
    const snapshot = raw(); snapshot.chapters[0].html += `<img src="${token('a.png')}">`;
    snapshot.resources = [{ id: token('a.png'), mediaType: 'image/png', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.invalid/x"/></svg>') }];
    await expect(publish(snapshot)).rejects.toThrow(/MOBI图片/u);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('HTML/CSS/SVG运输保持内部依赖，脚本/外链/事件不发布；CSP只做结构断言', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
    const snapshot = raw();
    snapshot.chapters[0].head = `<link rel="stylesheet" href="${token('root.css')}">`;
    snapshot.chapters[0].html += `<img src="${token('art.svg')}" onerror="evil()"><script>evil()</script>`;
    snapshot.resources = [
      { id: token('root.css'), mediaType: 'text/css', bytes: Buffer.from('@import "child.css" layer(theme) supports(display:grid) print; p{background:url(https://evil.invalid/a)}') },
      { id: token('child.css'), mediaType: 'text/css', bytes: Buffer.from('p{color:blue}') },
      { id: token('art.svg'), mediaType: 'image/svg+xml', bytes: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" onload="evil()"><script>evil()</script><image href="${token('a.png')}"/></svg>`) },
      { id: token('a.png'), mediaType: 'image/png', bytes: png },
    ];
    const model = await publish(snapshot), book = await render(model), doc = await book.sections[0].createDocument();
    expect(doc.querySelector('script,[onerror],[onload]')).toBeNull();
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'))
      .toContain("script-src 'none'; connect-src 'none'");
    const contents = await Promise.all([...allocated.values()].filter(blob => ['text/css', 'image/svg+xml'].includes(blob.type)).map(blob => blob.text()));
    expect(contents.join('')).not.toMatch(/evil\(|https:\/\/evil|mobi-resource-v1\//u);
    expect(contents.join('')).toMatch(/@import.*blob:.*layer\(theme\).*supports\(display:grid\).*print/u);
    expect(contents.some(text => text.includes('<image') && text.includes('blob:audit-'))).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('真实filepos第二段/UTF16偏移在发布、运输、reparse后保持exact DOM点', async () => {
    let html = '<html><body><p>重复😀末尾</p><p>重复😀末尾</p><a filepos="0000000000">注</a></body></html>';
    const offset = Buffer.byteLength(html.slice(0, html.lastIndexOf('末尾')));
    html = html.replace('0000000000', String(offset).padStart(10, '0'));
    const model = await publication.publishMobiFile(makeMobiFixture({ text: html }));
    const book = await render(model), doc = await book.sections[0].createDocument();
    const href = doc.querySelector('a')!.getAttribute('href')!;
    const target = book.resolveHref!(href)!.anchor(doc) as Range;
    expect(target.startContainer.parentElement).toBe(doc.querySelectorAll('p')[1]);
    expect(target.startOffset).toBe('重复😀'.length);
    expect(doc.getElementById(model.navigation[0].href.slice(1))).toBeNull();
  }, 20000);

  it('错版本在loader处拒绝，正文或资源hash不一致不泄漏已建blob', async () => {
    const snapshot = raw(); snapshot.chapters[0].head = `<style>p{background:url(${token('a.png')})}</style>`;
    snapshot.resources = [{ id: token('a.png'), mediaType: 'image/png', bytes: await sharp({ create: { width: 1, height: 1, channels: 3, background: 'red' } }).png().toBuffer() }];
    const model = await publish(snapshot);
    expect(() => readMobiPublication(model, 'f'.repeat(64))).toThrow(/来源/u);
    await expect(loadMobiPublication(Response.json(model), 'f'.repeat(64))).rejects.toThrow(/来源/u);
    expect(allocated.size).toBe(0);
    const altered = structuredClone(model); altered.chapters.push({ ...altered.chapters[0], id: 'mobi-v1/mobi/1', htmlHash: hash('wrong') });
    await expect(createMobiFoliateBook(altered)).rejects.toThrow(/章节校验/u);
    expect(allocated.size).toBeGreaterThan(0); expect(revoked).toEqual(new Set(allocated.keys()));
  });

  it('destroy幂等且禁用后续load/resolve；unload/reload不遗留章节blob', async () => {
    const book = await render(await publish(raw()));
    const first = await book.sections[0].load(); book.sections[0].unload?.();
    expect(revoked.has(first!)).toBe(true);
    const next = await book.sections[0].load(); expect(next).not.toBe(first);
    book.destroy?.(); book.destroy?.();
    expect(revoked).toEqual(new Set(allocated.keys()));
    await expect(book.sections[0].load()).rejects.toThrow(/关闭/u);
    expect(() => book.resolveHref?.(book.sections[0].id)).toThrow(/关闭/u);
  });

  it('API单任务限流必须在读取大原件前生效，而非只限制解析worker', async () => {
    const { GET } = await import('../app/api/books/[bookId]/mobi-layout/route');
    const model = await publish(raw());
    // WHY：仅模拟数据库/原件IO的可控等待，不实际分配六份100MiB或触碰正式数据。
    const fakeDb = { prepare: () => ({ get: (_bookId: string, id: string) => ({ id, fileType: '.mobi', relativePath: storage.originalRelativePath(id, '.mobi'), size: 100 * 1024 * 1024, originalHash: 'a'.repeat(64) }) }) };
    vi.spyOn(database, 'getDb').mockReturnValue(fakeDb as unknown as ReturnType<typeof database.getDb>);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let active = 0, peak = 0;
    const reads = vi.spyOn(storage, 'readStoredOriginalFile').mockImplementation(async () => { peak = Math.max(peak, ++active); await gate; active--; return Buffer.from('mock'); });
    const publishes = vi.spyOn(publication, 'publishMobiFile').mockResolvedValue(model);
    const requests = Array.from({ length: 6 }, (_, index) => GET(new Request(`http://audit.invalid/api/books/book-a/mobi-layout?editionId=edition-${index}`), { params: Promise.resolve({ bookId: 'book-a' }) }));
    try { await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(1)); }
    finally { release(); }
    const responses = await Promise.all(requests);
    console.info('AUDIT API admission evidence', { peakOriginalReads: peak, publishCalls: publishes.mock.calls.length, statuses: responses.map(response => response.status) });
    expect(peak).toBeLessThanOrEqual(1);
  });
});
