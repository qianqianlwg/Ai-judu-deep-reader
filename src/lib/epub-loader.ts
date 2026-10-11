import type { FoliateBook, FoliateBridge, FoliateView } from './foliate-types';
import { inspectZip, validateArchive } from './epub-security-zip';
import { prepareEpubResources, type SafeEpubResources } from './epub-security-resources';
import { initialEpubSection, nearbyEpubSections, prepareEpubSections, prepareRemainingEpubSections, type EpubPreparationPosition } from './epub-preparation';

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

export type LoadEpubOptions = EpubPreparationPosition & { progressive?: boolean; signal?: AbortSignal };

export async function loadEpub(original: Blob, options: LoadEpubOptions = {}): Promise<FoliateBook> {
  if (typeof window === 'undefined') throw new Error('EPUB 只能在浏览器中加载');
  options.signal?.throwIfAborted();
  const records = await inspectZip(original);
  const bridge = await initializeFoliate();
  options.signal?.throwIfAborted();
  const archive = await bridge.openArchive(original);
  let resources: SafeEpubResources | undefined, book: FoliateBook | undefined;
  const lifetime = new AbortController();
  let closing: Promise<void> | undefined;
  const closeArchive = () => closing ??= (async () => { await resources?.drained(); await archive.close(); })();
  const abort = () => { lifetime.abort(); resources?.destroy(); book?.destroy?.(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    options.signal?.throwIfAborted();
    validateArchive(archive, records);
    resources = await prepareEpubResources(archive, bridge.sanitizeCss, { lazy: options.progressive });
    const safe = resources;
    options.signal?.throwIfAborted();
    book = await bridge.createBook(original, safe);
    const loaded = book, destroy = loaded.destroy?.bind(loaded);
    let destroyed = false;
    loaded.destroy = () => {
      if (destroyed) return;
      destroyed = true; lifetime.abort(); options.signal?.removeEventListener('abort', abort);
      try { destroy?.(); } finally {
        safe.destroy();
        // WHY：渐进加载返回时 ZIP 仍供后台解压使用；必须等活动解压排空再关，不能沿用 eager 的 finally 关闭。
        void closeArchive().catch(cause => console.error('关闭 EPUB 归档失败', cause));
      }
    };
    const indices = options.progressive
      ? nearbyEpubSections(loaded.sections.length, initialEpubSection(loaded, options))
      : loaded.sections.map((_, index) => index);
    await prepareEpubSections(loaded, indices, lifetime.signal);
    options.signal?.throwIfAborted();
    if (options.progressive) {
      let background: Promise<void> | undefined;
      loaded.preparation = { start: () => background ??= (async () => {
        try {
          lifetime.signal.throwIfAborted();
          await Promise.all([safe.prefetch(), prepareRemainingEpubSections(loaded, new Set(indices), lifetime.signal)]);
        } catch (cause: unknown) { loaded.destroy?.(); throw cause; }
        finally { await closeArchive(); }
      })() };
    } else await closeArchive();
    return loaded;
  } catch (cause: unknown) {
    lifetime.abort(); options.signal?.removeEventListener('abort', abort);
    try { book?.destroy?.(); } finally { resources?.destroy(); }
    try { await closeArchive(); }
    catch (closeError: unknown) { throw new AggregateError([cause, closeError], 'EPUB 准备与归档关闭失败'); }
    throw cause;
  }
}
