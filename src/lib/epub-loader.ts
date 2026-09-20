import type { FoliateBook, FoliateBridge, FoliateView } from './foliate-types';
import { inspectZip, validateArchive } from './epub-security-zip';
import { prepareEpubResources, type SafeEpubResources } from './epub-security-resources';

const REVISION = '78914aef4466eb960965702401634c2cb348e9b1';
let initialization: Promise<FoliateBridge> | undefined;
function getBridge(): FoliateBridge | undefined {
  const value: unknown = (window as unknown as { __juduFoliate?: unknown }).__juduFoliate;
  if (!value || typeof value !== 'object') return undefined;
  if (!('revision' in value) || value.revision !== REVISION) throw new Error('EPUB 渲染器版本不匹配，请刷新页面');
  for (const name of ['openArchive', 'createBook', 'createView', 'sanitizeCss']) {
    if (!(name in value) || typeof Reflect.get(value, name) !== 'function') throw new Error('EPUB 渲染器接口无效');
  }
  return value as FoliateBridge;
}
export function initializeFoliate(): Promise<FoliateBridge> {
  if (typeof window === 'undefined' || typeof document === 'undefined')
    return Promise.reject(new Error('EPUB 只能在浏览器中加载'));
  if (!initialization) initialization = new Promise<FoliateBridge>((resolve, reject) => {
    const ready = getBridge();
    if (ready) { resolve(ready); return; }
    // WHY：固定同源 module script，避免 SSR 执行 vendor，也避免打包器改写运行时 import。
    const script = document.createElement('script');
    script.type = 'module'; script.src = '/vendor/foliate/bridge.js';
    script.dataset.juduFoliate = REVISION;
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      script.onload = null; script.onerror = null;
      if (error) { script.remove(); reject(error); return; }
      try {
        const bridge = getBridge();
        if (!bridge) throw new Error('EPUB 渲染器未完成初始化');
        resolve(bridge);
      } catch (failure) { script.remove(); reject(failure); }
    };
    const timeout = window.setTimeout(() => finish(new Error('EPUB 渲染器加载超时，请重试')), 15000);
    script.onload = () => finish();
    script.onerror = () => finish(new Error('EPUB 渲染器加载失败，请重试'));
    document.head.append(script);
  }).catch(error => { initialization = undefined; throw error; });
  return initialization;
}

export async function createFoliateView(): Promise<FoliateView> {
  return (await initializeFoliate()).createView();
}

export async function loadEpub(original: Blob): Promise<FoliateBook> {
  if (typeof window === 'undefined') throw new Error('EPUB 只能在浏览器中加载');
  const records = await inspectZip(original);
  const bridge = await initializeFoliate();
  const archive = await bridge.openArchive(original);
  let resources: SafeEpubResources | undefined, book: FoliateBook | undefined;
  try {
    validateArchive(archive, records);
    resources = await prepareEpubResources(archive, bridge.sanitizeCss);
    const safe = resources;
    book = await bridge.createBook(original, safe);
    // WHY：所有可能成为 iframe 文档的章节提前净化，失败不能等到用户翻页后才出现。
    for (const section of book.sections) await section.createDocument();
    const destroy = book.destroy?.bind(book);
    let destroyed = false;
    book.destroy = () => { if (destroyed) return; destroyed = true; try { destroy?.(); } finally { safe.destroy(); } };
    return book;
  } catch (error) {
    book?.destroy?.(); resources?.destroy(); throw error;
  } finally {
    try { await archive.close(); } catch (error) { book?.destroy?.(); resources?.destroy(); throw error; }
  }
}
